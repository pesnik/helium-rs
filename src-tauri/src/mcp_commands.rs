/**
 * Tauri commands for MCP (Model Context Protocol) integration
 *
 * These commands expose MCP functionality to the frontend,
 * allowing the AI assistant to use filesystem tools.
 */

use crate::mcp::{MCPClient, MCPConfig, MCPError, MCPServer, MCPToolDefinition};
use log::{debug, error, info};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

/// Global MCP client state
pub struct MCPState {
    client: Arc<Mutex<Option<MCPClient>>>,
}

impl MCPState {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
        }
    }
}

/// Response for MCP initialization
#[derive(Debug, Serialize, Deserialize)]
pub struct InitializeMCPResponse {
    pub success: bool,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub protocol_version: Option<String>,
    pub error: Option<String>,
}

/// Initialize the MCP client with configuration
#[tauri::command]
pub async fn initialize_mcp(
    allowed_directories: Vec<String>,
    confirm_destructive: Option<bool>,
    max_file_size: Option<u64>,
    state: State<'_, MCPState>,
) -> Result<InitializeMCPResponse, String> {
    info!("Initializing MCP with directories: {:?}", allowed_directories);

    let mut client_guard = state.client.lock().await;

    // Check if already initialized
    if client_guard.is_some() {
        return Ok(InitializeMCPResponse {
            success: false,
            server_name: None,
            server_version: None,
            protocol_version: None,
            error: Some("MCP already initialized".to_string()),
        });
    }

    // Validate configuration
    if allowed_directories.is_empty() {
        return Err("At least one allowed directory must be specified".to_string());
    }

    // Create configuration
    let config = MCPConfig {
        allowed_directories,
        confirm_destructive: confirm_destructive.unwrap_or(true),
        max_file_size,
    };

    // Create server and client
    let server = MCPServer::new(config);
    let client = MCPClient::new(server);

    // Initialize the client
    match client.initialize().await {
        Ok(init_response) => {
            info!("MCP initialized successfully");

            // Store client in state
            *client_guard = Some(client);

            Ok(InitializeMCPResponse {
                success: true,
                server_name: Some(init_response.server_info.name),
                server_version: Some(init_response.server_info.version),
                protocol_version: Some(init_response.protocol_version),
                error: None,
            })
        }
        Err(e) => {
            error!("Failed to initialize MCP: {}", e);
            Ok(InitializeMCPResponse {
                success: false,
                server_name: None,
                server_version: None,
                protocol_version: None,
                error: Some(e.message),
            })
        }
    }
}

/// Get list of available MCP tools
#[tauri::command]
pub async fn get_mcp_tools(state: State<'_, MCPState>) -> Result<Vec<MCPToolDefinition>, String> {
    debug!("Getting MCP tools");

    let client_guard = state.client.lock().await;

    match client_guard.as_ref() {
        Some(client) => {
            // Try to get cached tools first
            let cached_tools = client.get_cached_tools().await;
            if !cached_tools.is_empty() {
                return Ok(cached_tools);
            }

            // If no cached tools, fetch from server
            match client.list_tools().await {
                Ok(tools) => {
                    info!("Retrieved {} MCP tools", tools.len());
                    Ok(tools)
                }
                Err(e) => {
                    error!("Failed to list MCP tools: {}", e);
                    Err(e.message)
                }
            }
        }
        None => Err("MCP not initialized. Call initialize_mcp first.".to_string()),
    }
}

/// Execute request for tool execution
#[derive(Debug, Deserialize)]
pub struct ExecuteToolRequest {
    pub tool_name: String,
    pub arguments: HashMap<String, Value>,
}

/// Response from tool execution
#[derive(Debug, Serialize)]
pub struct ExecuteToolResponse {
    pub success: bool,
    pub content: Vec<ToolContentResponse>,
    pub is_error: bool,
    pub execution_time_ms: Option<u64>,
    pub error: Option<String>,
}

/// Tool content in response
#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum ToolContentResponse {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "resource")]
    Resource {
        uri: String,
        mime_type: Option<String>,
        text: Option<String>,
    },
}

/// Execute an MCP tool
#[tauri::command]
pub async fn execute_mcp_tool(
    request: ExecuteToolRequest,
    state: State<'_, MCPState>,
) -> Result<ExecuteToolResponse, String> {
    debug!(
        "Executing MCP tool: {} with args: {:?}",
        request.tool_name, request.arguments
    );

    let start_time = std::time::Instant::now();
    let client_guard = state.client.lock().await;

    match client_guard.as_ref() {
        Some(client) => {
            match client
                .execute_tool(&request.tool_name, request.arguments)
                .await
            {
                Ok(result) => {
                    let execution_time = start_time.elapsed().as_millis() as u64;

                    // Convert tool content to response format
                    let content = result
                        .content
                        .into_iter()
                        .map(|c| match c {
                            crate::mcp::types::ToolContent::Text { text } => {
                                ToolContentResponse::Text { text }
                            }
                            crate::mcp::types::ToolContent::Resource { resource } => {
                                ToolContentResponse::Resource {
                                    uri: resource.uri,
                                    mime_type: resource.mime_type,
                                    text: resource.text,
                                }
                            }
                        })
                        .collect();

                    info!(
                        "Tool {} executed in {}ms",
                        request.tool_name, execution_time
                    );

                    Ok(ExecuteToolResponse {
                        success: !result.is_error.unwrap_or(false),
                        content,
                        is_error: result.is_error.unwrap_or(false),
                        execution_time_ms: Some(execution_time),
                        error: None,
                    })
                }
                Err(e) => {
                    error!("Failed to execute tool {}: {}", request.tool_name, e);
                    Ok(ExecuteToolResponse {
                        success: false,
                        content: vec![],
                        is_error: true,
                        execution_time_ms: Some(start_time.elapsed().as_millis() as u64),
                        error: Some(e.message),
                    })
                }
            }
        }
        None => Err("MCP not initialized. Call initialize_mcp first.".to_string()),
    }
}

/// Shutdown the MCP client
#[tauri::command]
pub async fn shutdown_mcp(state: State<'_, MCPState>) -> Result<bool, String> {
    info!("Shutting down MCP");

    let mut client_guard = state.client.lock().await;

    match client_guard.take() {
        Some(client) => match client.shutdown().await {
            Ok(_) => {
                info!("MCP shutdown successfully");
                Ok(true)
            }
            Err(e) => {
                error!("Failed to shutdown MCP: {}", e);
                Err(e.message)
            }
        },
        None => {
            debug!("MCP was not initialized");
            Ok(false)
        }
    }
}

/// Check if MCP is initialized
#[tauri::command]
pub async fn is_mcp_initialized(state: State<'_, MCPState>) -> Result<bool, String> {
    let client_guard = state.client.lock().await;
    Ok(client_guard.is_some())
}
