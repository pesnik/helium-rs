/**
 * Tauri commands for Native MCP Integration
 *
 * These commands expose the native Rust MCP filesystem server to the frontend.
 * This replaces the subprocess-based implementation with direct in-process calls.
 */

use crate::mcp::{MCPConfig, MCPError, NativeMCPServer, ServerInfo, FileInfo, DirectorySizeInfo, ToolDefinition};
use log::{debug, error, info};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

/// Global MCP server state
pub struct NativeMCPState {
    server: Arc<Mutex<Option<NativeMCPServer>>>,
}

impl NativeMCPState {
    pub fn new() -> Self {
        Self {
            server: Arc::new(Mutex::new(None)),
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

/// Initialize the native MCP server
#[tauri::command]
pub async fn initialize_mcp(
    allowed_directories: Vec<String>,
    confirm_destructive: Option<bool>,
    max_file_size: Option<u64>,
    state: State<'_, NativeMCPState>,
) -> Result<InitializeMCPResponse, String> {
    info!("Initializing native MCP server with directories: {:?}", allowed_directories);

    let mut server_guard = state.server.lock().await;

    // Shutdown existing server if present
    if server_guard.is_some() {
        info!("Shutting down existing MCP server before reinitializing");
        *server_guard = None;
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

    // Create native server
    let server = NativeMCPServer::new(config);

    // Initialize the server
    match server.initialize().await {
        Ok(server_info) => {
            info!("Native MCP server initialized successfully");

            // Store server in state
            *server_guard = Some(server);

            Ok(InitializeMCPResponse {
                success: true,
                server_name: Some(server_info.name),
                server_version: Some(server_info.version),
                protocol_version: Some(server_info.protocol_version),
                error: None,
            })
        }
        Err(e) => {
            error!("Failed to initialize native MCP server: {}", e);
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

/// Tool definition for frontend
#[derive(Debug, Serialize, Deserialize)]
pub struct MCPToolDefinition {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
    #[serde(rename = "isAvailable")]
    pub is_available: bool,
    pub annotations: Option<ToolAnnotations>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolAnnotations {
    #[serde(rename = "readOnlyHint")]
    pub read_only_hint: Option<bool>,
    #[serde(rename = "idempotentHint")]
    pub idempotent_hint: Option<bool>,
    #[serde(rename = "destructiveHint")]
    pub destructive_hint: Option<bool>,
}

/// Get list of available MCP tools
#[tauri::command]
pub async fn get_mcp_tools(state: State<'_, NativeMCPState>) -> Result<Vec<MCPToolDefinition>, String> {
    debug!("Getting native MCP tools");

    let server_guard = state.server.lock().await;

    if server_guard.is_none() {
        return Err("MCP not initialized. Call initialize_mcp first.".to_string());
    }

    // Get static tool definitions
    let tools = NativeMCPServer::get_tools();

    // Convert to frontend format
    let frontend_tools: Vec<MCPToolDefinition> = tools
        .into_iter()
        .map(|tool| {
            let annotations = match tool.name.as_str() {
                "read_file" | "list_directory" | "get_file_info" | "search_files" | "get_directory_size" => {
                    Some(ToolAnnotations {
                        read_only_hint: Some(true),
                        idempotent_hint: Some(true),
                        destructive_hint: Some(false),
                    })
                }
                "write_file" | "move_file" | "create_directory" => Some(ToolAnnotations {
                    read_only_hint: Some(false),
                    idempotent_hint: Some(false),
                    destructive_hint: Some(true),
                }),
                _ => None,
            };

            MCPToolDefinition {
                name: tool.name,
                description: tool.description,
                input_schema: tool.input_schema,
                is_available: true,
                annotations,
            }
        })
        .collect();

    info!("Retrieved {} native MCP tools", frontend_tools.len());
    Ok(frontend_tools)
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
}

/// Execute an MCP tool
#[tauri::command]
pub async fn execute_mcp_tool(
    request: ExecuteToolRequest,
    state: State<'_, NativeMCPState>,
) -> Result<ExecuteToolResponse, String> {
    debug!(
        "Executing native MCP tool: {} with args: {:?}",
        request.tool_name, request.arguments
    );

    let start_time = std::time::Instant::now();
    let server_guard = state.server.lock().await;

    match server_guard.as_ref() {
        Some(server) => {
            // Execute the tool based on name
            let result = match request.tool_name.as_str() {
                "read_file" => {
                    let path = request
                        .arguments
                        .get("path")
                        .and_then(|v| v.as_str())
                        .ok_or("Missing 'path' argument")?;

                    server.read_file(path.to_string()).await
                }
                "write_file" => {
                    let path = request
                        .arguments
                        .get("path")
                        .and_then(|v| v.as_str())
                        .ok_or("Missing 'path' argument")?;
                    let content = request
                        .arguments
                        .get("content")
                        .and_then(|v| v.as_str())
                        .ok_or("Missing 'content' argument")?;

                    server
                        .write_file(path.to_string(), content.to_string())
                        .await
                        .map(|_| "File written successfully".to_string())
                }
                "list_directory" => {
                    let path = request
                        .arguments
                        .get("path")
                        .and_then(|v| v.as_str())
                        .ok_or("Missing 'path' argument")?;

                    server
                        .list_directory(path.to_string())
                        .await
                        .and_then(|files| {
                            serde_json::to_string_pretty(&files).map_err(|e| MCPError {
                                code: -32700,
                                message: format!("Failed to serialize file list: {}", e),
                                data: None,
                            })
                        })
                }
                "search_files" => {
                    let directory = request
                        .arguments
                        .get("directory")
                        .and_then(|v| v.as_str())
                        .ok_or("Missing 'directory' argument")?;
                    let pattern = request
                        .arguments
                        .get("pattern")
                        .and_then(|v| v.as_str())
                        .ok_or("Missing 'pattern' argument")?;

                    server
                        .search_files(directory.to_string(), pattern.to_string())
                        .await
                        .and_then(|results| {
                            serde_json::to_string_pretty(&results).map_err(|e| MCPError {
                                code: -32700,
                                message: format!("Failed to serialize search results: {}", e),
                                data: None,
                            })
                        })
                }
                "get_file_info" => {
                    let path = request
                        .arguments
                        .get("path")
                        .and_then(|v| v.as_str())
                        .ok_or("Missing 'path' argument")?;

                    server
                        .get_file_info(path.to_string())
                        .await
                        .and_then(|info| {
                            serde_json::to_string_pretty(&info).map_err(|e| MCPError {
                                code: -32700,
                                message: format!("Failed to serialize file info: {}", e),
                                data: None,
                            })
                        })
                }
                "move_file" => {
                    let from = request
                        .arguments
                        .get("from")
                        .and_then(|v| v.as_str())
                        .ok_or("Missing 'from' argument")?;
                    let to = request
                        .arguments
                        .get("to")
                        .and_then(|v| v.as_str())
                        .ok_or("Missing 'to' argument")?;

                    server
                        .move_file(from.to_string(), to.to_string())
                        .await
                        .map(|_| "File moved successfully".to_string())
                }
                "create_directory" => {
                    let path = request
                        .arguments
                        .get("path")
                        .and_then(|v| v.as_str())
                        .ok_or("Missing 'path' argument")?;

                    server
                        .create_directory(path.to_string())
                        .await
                        .map(|_| "Directory created successfully".to_string())
                }
                "get_directory_size" => {
                    let path = request
                        .arguments
                        .get("path")
                        .and_then(|v| v.as_str())
                        .ok_or("Missing 'path' argument")?;

                    server
                        .get_directory_size(path.to_string())
                        .await
                        .and_then(|size_info| {
                            serde_json::to_string_pretty(&size_info).map_err(|e| MCPError {
                                code: -32700,
                                message: format!("Failed to serialize directory size info: {}", e),
                                data: None,
                            })
                        })
                }
                _ => {
                    return Ok(ExecuteToolResponse {
                        success: false,
                        content: vec![],
                        is_error: true,
                        execution_time_ms: Some(start_time.elapsed().as_millis() as u64),
                        error: Some(format!("Unknown tool: {}", request.tool_name)),
                    });
                }
            };

            let execution_time = start_time.elapsed().as_millis() as u64;

            match result {
                Ok(content) => {
                    info!(
                        "Tool {} executed successfully in {}ms",
                        request.tool_name, execution_time
                    );

                    Ok(ExecuteToolResponse {
                        success: true,
                        content: vec![ToolContentResponse::Text { text: content }],
                        is_error: false,
                        execution_time_ms: Some(execution_time),
                        error: None,
                    })
                }
                Err(e) => {
                    error!("Tool {} execution failed: {}", request.tool_name, e);

                    Ok(ExecuteToolResponse {
                        success: false,
                        content: vec![ToolContentResponse::Text {
                            text: e.message.clone(),
                        }],
                        is_error: true,
                        execution_time_ms: Some(execution_time),
                        error: Some(e.message),
                    })
                }
            }
        }
        None => Err("MCP not initialized. Call initialize_mcp first.".to_string()),
    }
}

/// Shutdown the MCP server
#[tauri::command]
pub async fn shutdown_mcp(state: State<'_, NativeMCPState>) -> Result<bool, String> {
    info!("Shutting down native MCP server");

    let mut server_guard = state.server.lock().await;

    if server_guard.take().is_some() {
        info!("Native MCP server shutdown successfully");
        Ok(true)
    } else {
        debug!("Native MCP server was not initialized");
        Ok(false)
    }
}

/// Check if MCP is initialized
#[tauri::command]
pub async fn is_mcp_initialized(state: State<'_, NativeMCPState>) -> Result<bool, String> {
    let server_guard = state.server.lock().await;
    Ok(server_guard.is_some())
}
