/**
 * MCP (Model Context Protocol) Integration Module
 *
 * This module provides integration with the MCP filesystem server,
 * enabling AI agents to perform file system operations through
 * standardized tool calls.
 */

pub mod server;
pub mod types;
pub mod client;

pub use server::MCPServer;
pub use types::*;
pub use client::MCPClient;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Configuration for MCP server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPConfig {
    /// Directories allowed for file operations
    pub allowed_directories: Vec<String>,
    /// Whether to require confirmation for destructive operations
    pub confirm_destructive: bool,
    /// Maximum file size for read operations (in bytes)
    pub max_file_size: Option<u64>,
}

impl Default for MCPConfig {
    fn default() -> Self {
        Self {
            allowed_directories: vec![],
            confirm_destructive: true,
            max_file_size: Some(10 * 1024 * 1024), // 10MB default
        }
    }
}

/// Result type for MCP operations
pub type MCPResult<T> = Result<T, MCPError>;

/// Errors that can occur during MCP operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPError {
    pub code: i32,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

impl std::fmt::Display for MCPError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "MCP Error {}: {}", self.code, self.message)
    }
}

impl std::error::Error for MCPError {}

impl From<std::io::Error> for MCPError {
    fn from(err: std::io::Error) -> Self {
        MCPError {
            code: -32000,
            message: format!("IO Error: {}", err),
            data: None,
        }
    }
}

impl From<serde_json::Error> for MCPError {
    fn from(err: serde_json::Error) -> Self {
        MCPError {
            code: -32700,
            message: format!("Parse Error: {}", err),
            data: None,
        }
    }
}
