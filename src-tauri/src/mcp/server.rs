/**
 * MCP Server subprocess manager
 *
 * Manages the lifecycle of the MCP filesystem server process,
 * communicating via stdio using JSON-RPC 2.0 protocol.
 */

use super::{MCPConfig, MCPError, MCPResult};
use std::process::{Child, ChildStdin, ChildStdout, ChildStderr, Command, Stdio};
use std::sync::Arc;
use tokio::sync::Mutex;
use log::{debug, error, info, warn};

/// MCP Server process manager with separate stdio handles
pub struct MCPServer {
    process: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    stdout: Arc<Mutex<Option<ChildStdout>>>,
    stderr: Arc<Mutex<Option<ChildStderr>>>,
    config: MCPConfig,
}

impl MCPServer {
    /// Create a new MCP server instance
    pub fn new(config: MCPConfig) -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            stdout: Arc::new(Mutex::new(None)),
            stderr: Arc::new(Mutex::new(None)),
            config,
        }
    }

    /// Start the MCP filesystem server process
    pub async fn start(&self) -> MCPResult<()> {
        let mut process_guard = self.process.lock().await;

        if process_guard.is_some() {
            warn!("MCP server is already running");
            return Ok(());
        }

        info!("Starting MCP filesystem server...");

        // Validate configuration
        if self.config.allowed_directories.is_empty() {
            return Err(MCPError {
                code: -32001,
                message: "At least one allowed directory must be configured".to_string(),
                data: None,
            });
        }

        // Build command to start MCP server via npx
        // On Windows, we need to use cmd /c to properly resolve npx.cmd
        #[cfg(target_os = "windows")]
        let mut cmd = {
            let mut c = Command::new("cmd");
            c.arg("/c");
            c.arg("npx");
            c.arg("@modelcontextprotocol/server-filesystem");
            c
        };

        #[cfg(not(target_os = "windows"))]
        let mut cmd = {
            let mut c = Command::new("npx");
            c.arg("@modelcontextprotocol/server-filesystem");
            c
        };

        // Add allowed directories as arguments
        for dir in &self.config.allowed_directories {
            cmd.arg(dir);
        }

        // Configure stdio for JSON-RPC communication
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Spawn the process
        let mut child = cmd.spawn().map_err(|e| {
            error!("Failed to spawn MCP server: {}", e);
            MCPError {
                code: -32002,
                message: format!("Failed to start MCP server: {}", e),
                data: None,
            }
        })?;

        info!("MCP server started successfully with PID: {:?}", child.id());

        // Extract stdio handles before storing the process
        let stdin = child.stdin.take().ok_or_else(|| MCPError {
            code: -32004,
            message: "Failed to get stdin handle".to_string(),
            data: None,
        })?;

        let stdout = child.stdout.take().ok_or_else(|| MCPError {
            code: -32006,
            message: "Failed to get stdout handle".to_string(),
            data: None,
        })?;

        let stderr = child.stderr.take().ok_or_else(|| MCPError {
            code: -32007,
            message: "Failed to get stderr handle".to_string(),
            data: None,
        })?;

        // Store handles
        *self.stdin.lock().await = Some(stdin);
        *self.stdout.lock().await = Some(stdout);
        *self.stderr.lock().await = Some(stderr);
        *process_guard = Some(child);

        Ok(())
    }

    /// Stop the MCP server process
    pub async fn stop(&self) -> MCPResult<()> {
        let mut process_guard = self.process.lock().await;

        if let Some(mut child) = process_guard.take() {
            info!("Stopping MCP server...");

            // Clear stdio handles
            *self.stdin.lock().await = None;
            *self.stdout.lock().await = None;
            *self.stderr.lock().await = None;

            // Try graceful shutdown first
            match child.kill() {
                Ok(_) => {
                    info!("MCP server stopped");
                    Ok(())
                }
                Err(e) => {
                    error!("Failed to stop MCP server: {}", e);
                    Err(MCPError {
                        code: -32003,
                        message: format!("Failed to stop MCP server: {}", e),
                        data: None,
                    })
                }
            }
        } else {
            debug!("MCP server is not running");
            Ok(())
        }
    }

    /// Check if the MCP server is running
    pub async fn is_running(&self) -> bool {
        let process_guard = self.process.lock().await;
        process_guard.is_some()
    }

    /// Get the configuration
    pub fn config(&self) -> &MCPConfig {
        &self.config
    }

    /// Get Arc reference to stdin mutex
    pub fn get_stdin(&self) -> Arc<Mutex<Option<ChildStdin>>> {
        Arc::clone(&self.stdin)
    }

    /// Get Arc reference to stdout mutex
    pub fn get_stdout(&self) -> Arc<Mutex<Option<ChildStdout>>> {
        Arc::clone(&self.stdout)
    }

    /// Get Arc reference to stderr mutex
    pub fn get_stderr(&self) -> Arc<Mutex<Option<ChildStderr>>> {
        Arc::clone(&self.stderr)
    }
}

impl Drop for MCPServer {
    fn drop(&mut self) {
        // Best effort cleanup - try to kill the process if it's still running
        if let Ok(mut process_guard) = self.process.try_lock() {
            if let Some(mut child) = process_guard.take() {
                let _ = child.kill();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_server_lifecycle() {
        let config = MCPConfig {
            allowed_directories: vec!["/tmp".to_string()],
            confirm_destructive: true,
            max_file_size: Some(1024 * 1024),
        };

        let server = MCPServer::new(config);

        // Initially not running
        assert!(!server.is_running().await);

        // Start server
        let result = server.start().await;
        assert!(result.is_ok());
        assert!(server.is_running().await);

        // Stop server
        let result = server.stop().await;
        assert!(result.is_ok());
        assert!(!server.is_running().await);
    }
}
