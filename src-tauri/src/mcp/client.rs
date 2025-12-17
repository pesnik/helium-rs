/**
 * MCP Client - JSON-RPC 2.0 client for communicating with MCP server
 *
 * Handles initialization, tool discovery, and tool execution via stdio.
 */

use super::server::MCPServer;
use super::types::*;
use super::{MCPError, MCPResult};
use log::{debug, error, info, warn};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

/// MCP Client for JSON-RPC communication
pub struct MCPClient {
    server: Arc<MCPServer>,
    request_id: Arc<AtomicU64>,
    tools: Arc<Mutex<Vec<MCPToolDefinition>>>,
    initialized: Arc<Mutex<bool>>,
}

impl MCPClient {
    /// Create a new MCP client
    pub fn new(server: MCPServer) -> Self {
        Self {
            server: Arc::new(server),
            request_id: Arc::new(AtomicU64::new(1)),
            tools: Arc::new(Mutex::new(Vec::new())),
            initialized: Arc::new(Mutex::new(false)),
        }
    }

    /// Initialize the MCP connection
    pub async fn initialize(&self) -> MCPResult<InitializeResponse> {
        let mut initialized_guard = self.initialized.lock().await;

        if *initialized_guard {
            warn!("MCP client already initialized");
            return Err(MCPError {
                code: -32008,
                message: "Client already initialized".to_string(),
                data: None,
            });
        }

        info!("Initializing MCP client...");

        // Start the server if not running
        if !self.server.is_running().await {
            self.server.start().await?;
        }

        // Send initialize request
        let init_request = InitializeRequest {
            protocol_version: "2024-11-05".to_string(),
            capabilities: ClientCapabilities {
                roots: Some(RootsCapability {
                    list_changed: true,
                }),
            },
            client_info: ClientInfo {
                name: "helium-ai".to_string(),
                version: "0.2.0".to_string(),
            },
        };

        let response = self
            .send_request("initialize", Some(json!(init_request)))
            .await?;

        let init_response: InitializeResponse = serde_json::from_value(response)
            .map_err(|e| MCPError {
                code: -32700,
                message: format!("Failed to parse initialize response: {}", e),
                data: None,
            })?;

        info!(
            "MCP initialized: {} v{}",
            init_response.server_info.name, init_response.server_info.version
        );

        // Send initialized notification
        self.send_notification("notifications/initialized", None)
            .await?;

        *initialized_guard = true;

        Ok(init_response)
    }

    /// List available tools from the MCP server
    pub async fn list_tools(&self) -> MCPResult<Vec<MCPToolDefinition>> {
        let initialized_guard = self.initialized.lock().await;

        if !*initialized_guard {
            return Err(MCPError {
                code: -32009,
                message: "Client not initialized. Call initialize() first.".to_string(),
                data: None,
            });
        }
        drop(initialized_guard);

        debug!("Listing available tools...");

        let response = self.send_request("tools/list", Some(json!({}))).await?;

        let list_response: ListToolsResponse =
            serde_json::from_value(response).map_err(|e| MCPError {
                code: -32700,
                message: format!("Failed to parse tools list response: {}", e),
                data: None,
            })?;

        info!("Found {} available tools", list_response.tools.len());

        // Cache the tools
        let mut tools_guard = self.tools.lock().await;
        *tools_guard = list_response.tools.clone();

        Ok(list_response.tools)
    }

    /// Get cached tools (without making a request)
    pub async fn get_cached_tools(&self) -> Vec<MCPToolDefinition> {
        let tools_guard = self.tools.lock().await;
        tools_guard.clone()
    }

    /// Execute a tool with the given arguments
    pub async fn execute_tool(
        &self,
        name: &str,
        arguments: HashMap<String, Value>,
    ) -> MCPResult<ToolExecutionResult> {
        let initialized_guard = self.initialized.lock().await;

        if !*initialized_guard {
            return Err(MCPError {
                code: -32009,
                message: "Client not initialized. Call initialize() first.".to_string(),
                data: None,
            });
        }
        drop(initialized_guard);

        debug!("Executing tool: {} with arguments: {:?}", name, arguments);

        let params = json!({
            "name": name,
            "arguments": arguments
        });

        let response = self.send_request("tools/call", Some(params)).await?;

        let result: ToolExecutionResult =
            serde_json::from_value(response).map_err(|e| MCPError {
                code: -32700,
                message: format!("Failed to parse tool execution result: {}", e),
                data: None,
            })?;

        if result.is_error.unwrap_or(false) {
            warn!("Tool execution returned error: {:?}", result);
        } else {
            debug!("Tool execution successful");
        }

        Ok(result)
    }

    /// Send a JSON-RPC request and wait for response
    async fn send_request(&self, method: &str, params: Option<Value>) -> MCPResult<Value> {
        let id = self.request_id.fetch_add(1, Ordering::SeqCst);
        let request = JsonRpcRequest::new(json!(id), method.to_string(), params);

        let request_json = serde_json::to_string(&request)?;
        debug!("Sending request: {}", request_json);

        // Get stdin and stdout Arc references
        let stdin_arc = self.server.get_stdin();
        let stdout_arc = self.server.get_stdout();

        // Write request
        {
            let mut stdin_guard = stdin_arc.lock().await;
            let stdin = stdin_guard.as_mut().ok_or_else(|| MCPError {
                code: -32004,
                message: "stdin handle not available".to_string(),
                data: None,
            })?;

            writeln!(stdin, "{}", request_json).map_err(|e| MCPError {
                code: -32000,
                message: format!("Failed to write request: {}", e),
                data: None,
            })?;

            stdin.flush().map_err(|e| MCPError {
                code: -32000,
                message: format!("Failed to flush stdin: {}", e),
                data: None,
            })?;
        }

        // Read response
        let mut response_line = String::new();
        {
            let mut stdout_guard = stdout_arc.lock().await;
            let stdout = stdout_guard.as_mut().ok_or_else(|| MCPError {
                code: -32006,
                message: "stdout handle not available".to_string(),
                data: None,
            })?;

            let mut reader = BufReader::new(stdout);
            reader.read_line(&mut response_line).map_err(|e| MCPError {
                code: -32000,
                message: format!("Failed to read response: {}", e),
                data: None,
            })?;
        }

        debug!("Received response: {}", response_line.trim());

        // Parse response
        let response: JsonRpcResponse = serde_json::from_str(&response_line)?;

        if let Some(error) = response.error {
            return Err(MCPError {
                code: error.code,
                message: error.message,
                data: error.data,
            });
        }

        response.result.ok_or_else(|| MCPError {
            code: -32001,
            message: "Response missing result field".to_string(),
            data: None,
        })
    }

    /// Send a JSON-RPC notification (no response expected)
    async fn send_notification(&self, method: &str, params: Option<Value>) -> MCPResult<()> {
        let notification = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: None,
            method: method.to_string(),
            params,
        };

        let notification_json = serde_json::to_string(&notification)?;
        debug!("Sending notification: {}", notification_json);

        // Get stdin Arc reference
        let stdin_arc = self.server.get_stdin();

        // Write notification
        {
            let mut stdin_guard = stdin_arc.lock().await;
            let stdin = stdin_guard.as_mut().ok_or_else(|| MCPError {
                code: -32004,
                message: "stdin handle not available".to_string(),
                data: None,
            })?;

            writeln!(stdin, "{}", notification_json).map_err(|e| MCPError {
                code: -32000,
                message: format!("Failed to write notification: {}", e),
                data: None,
            })?;

            stdin.flush().map_err(|e| MCPError {
                code: -32000,
                message: format!("Failed to flush stdin: {}", e),
                data: None,
            })?;
        }

        Ok(())
    }

    /// Shutdown the client and server
    pub async fn shutdown(&self) -> MCPResult<()> {
        info!("Shutting down MCP client...");

        let mut initialized_guard = self.initialized.lock().await;

        if *initialized_guard {
            // Send shutdown notification (best effort)
            let _ = self.send_notification("notifications/shutdown", None).await;
        }

        *initialized_guard = false;

        // Stop the server
        self.server.stop().await?;

        info!("MCP client shutdown complete");
        Ok(())
    }
}

impl Drop for MCPClient {
    fn drop(&mut self) {
        // Best effort cleanup
        debug!("MCPClient dropped");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::MCPConfig;

    #[tokio::test]
    #[ignore] // Requires Node.js and MCP server installed
    async fn test_client_lifecycle() {
        let config = MCPConfig {
            allowed_directories: vec!["/tmp".to_string()],
            confirm_destructive: true,
            max_file_size: Some(1024 * 1024),
        };

        let server = MCPServer::new(config);
        let client = MCPClient::new(server);

        // Initialize
        let init_result = client.initialize().await;
        assert!(init_result.is_ok());

        // List tools
        let tools_result = client.list_tools().await;
        assert!(tools_result.is_ok());
        let tools = tools_result.unwrap();
        assert!(!tools.is_empty());

        // Shutdown
        let shutdown_result = client.shutdown().await;
        assert!(shutdown_result.is_ok());
    }
}
