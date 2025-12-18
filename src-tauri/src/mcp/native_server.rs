/**
 * Native Rust MCP Server Implementation
 *
 * Provides filesystem tools using the official Rust MCP SDK (rmcp).
 * This replaces the subprocess-based Node.js implementation.
 */

use super::{MCPConfig, MCPError, MCPResult};
use log::{debug, error, info, warn};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Native MCP Server with filesystem tools
pub struct NativeMCPServer {
    config: Arc<RwLock<MCPConfig>>,
    initialized: Arc<RwLock<bool>>,
}

impl NativeMCPServer {
    /// Create a new native MCP server
    pub fn new(config: MCPConfig) -> Self {
        Self {
            config: Arc::new(RwLock::new(config)),
            initialized: Arc::new(RwLock::new(false)),
        }
    }

    /// Initialize the server
    pub async fn initialize(&self) -> MCPResult<ServerInfo> {
        let mut init_guard = self.initialized.write().await;

        if *init_guard {
            return Err(MCPError {
                code: -32008,
                message: "Server already initialized".to_string(),
                data: None,
            });
        }

        info!("Initializing native Rust MCP server...");

        *init_guard = true;

        Ok(ServerInfo {
            name: "helium-mcp-fs".to_string(),
            version: "0.2.0".to_string(),
            protocol_version: "2024-11-05".to_string(),
        })
    }

    /// Check if path is allowed
    async fn is_path_allowed(&self, path: &Path) -> bool {
        let config = self.config.read().await;
        let abs_path = match path.canonicalize() {
            Ok(p) => p,
            Err(_) => return false,
        };

        config.allowed_directories.iter().any(|allowed| {
            let allowed_path = match PathBuf::from(allowed).canonicalize() {
                Ok(p) => p,
                Err(_) => return false,
            };
            abs_path.starts_with(&allowed_path)
        })
    }

    /// Read file contents
    pub async fn read_file(&self, path: String) -> MCPResult<String> {
        let path = PathBuf::from(&path);

        if !self.is_path_allowed(&path).await {
            return Err(MCPError {
                code: -32001,
                message: format!("Access denied: {} is not in allowed directories", path.display()),
                data: None,
            });
        }

        // Check file size limit
        let metadata = fs::metadata(&path)?;
        let config = self.config.read().await;

        if let Some(max_size) = config.max_file_size {
            if metadata.len() > max_size {
                return Err(MCPError {
                    code: -32002,
                    message: format!(
                        "File too large: {} bytes (max: {} bytes)",
                        metadata.len(),
                        max_size
                    ),
                    data: None,
                });
            }
        }

        debug!("Reading file: {}", path.display());
        let content = fs::read_to_string(&path)?;
        Ok(content)
    }

    /// Write file contents
    pub async fn write_file(&self, path: String, content: String) -> MCPResult<()> {
        let path = PathBuf::from(&path);

        if !self.is_path_allowed(&path).await {
            return Err(MCPError {
                code: -32001,
                message: format!("Access denied: {} is not in allowed directories", path.display()),
                data: None,
            });
        }

        debug!("Writing file: {}", path.display());
        fs::write(&path, content)?;
        Ok(())
    }

    /// List directory contents
    pub async fn list_directory(&self, path: String) -> MCPResult<Vec<FileInfo>> {
        let path = PathBuf::from(&path);

        if !self.is_path_allowed(&path).await {
            return Err(MCPError {
                code: -32001,
                message: format!("Access denied: {} is not in allowed directories", path.display()),
                data: None,
            });
        }

        debug!("Listing directory: {}", path.display());
        let entries = fs::read_dir(&path)?;
        let mut files = Vec::new();

        for entry in entries {
            let entry = entry?;
            let metadata = entry.metadata()?;
            let path = entry.path();

            files.push(FileInfo {
                name: entry.file_name().to_string_lossy().to_string(),
                path: path.to_string_lossy().to_string(),
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                modified: metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs()),
            });
        }

        files.sort_by(|a, b| {
            // Directories first, then alphabetically
            match (a.is_dir, b.is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.cmp(&b.name),
            }
        });

        Ok(files)
    }

    /// Search for files matching a pattern
    pub async fn search_files(&self, directory: String, pattern: String) -> MCPResult<Vec<String>> {
        let dir_path = PathBuf::from(&directory);

        if !self.is_path_allowed(&dir_path).await {
            return Err(MCPError {
                code: -32001,
                message: format!("Access denied: {} is not in allowed directories", dir_path.display()),
                data: None,
            });
        }

        debug!("Searching for '{}' in {}", pattern, dir_path.display());

        let mut results = Vec::new();
        let pattern_lower = pattern.to_lowercase();

        fn search_recursive(
            path: &Path,
            pattern: &str,
            results: &mut Vec<String>,
            max_depth: usize,
            current_depth: usize,
        ) -> std::io::Result<()> {
            if current_depth > max_depth {
                return Ok(());
            }

            for entry in fs::read_dir(path)? {
                let entry = entry?;
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_lowercase();

                if name.contains(pattern) {
                    results.push(path.to_string_lossy().to_string());
                }

                if path.is_dir() && current_depth < max_depth {
                    let _ = search_recursive(&path, pattern, results, max_depth, current_depth + 1);
                }
            }
            Ok(())
        }

        search_recursive(&dir_path, &pattern_lower, &mut results, 3, 0)?;
        Ok(results)
    }

    /// Get file metadata
    pub async fn get_file_info(&self, path: String) -> MCPResult<FileInfo> {
        let path = PathBuf::from(&path);

        if !self.is_path_allowed(&path).await {
            return Err(MCPError {
                code: -32001,
                message: format!("Access denied: {} is not in allowed directories", path.display()),
                data: None,
            });
        }

        let metadata = fs::metadata(&path)?;

        Ok(FileInfo {
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            path: path.to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified: metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs()),
        })
    }

    /// Move/rename a file or directory
    pub async fn move_file(&self, from: String, to: String) -> MCPResult<()> {
        let from_path = PathBuf::from(&from);
        let to_path = PathBuf::from(&to);

        if !self.is_path_allowed(&from_path).await || !self.is_path_allowed(&to_path).await {
            return Err(MCPError {
                code: -32001,
                message: "Access denied: paths are not in allowed directories".to_string(),
                data: None,
            });
        }

        debug!("Moving {} to {}", from_path.display(), to_path.display());
        fs::rename(&from_path, &to_path)?;
        Ok(())
    }

    /// Create a directory
    pub async fn create_directory(&self, path: String) -> MCPResult<()> {
        let path = PathBuf::from(&path);

        if !self.is_path_allowed(&path).await {
            return Err(MCPError {
                code: -32001,
                message: format!("Access denied: {} is not in allowed directories", path.display()),
                data: None,
            });
        }

        debug!("Creating directory: {}", path.display());
        fs::create_dir_all(&path)?;
        Ok(())
    }

    /// Get recursive size of a directory
    pub async fn get_directory_size(&self, path: String) -> MCPResult<DirectorySizeInfo> {
        let path = PathBuf::from(&path);

        if !self.is_path_allowed(&path).await {
            return Err(MCPError {
                code: -32001,
                message: format!("Access denied: {} is not in allowed directories", path.display()),
                data: None,
            });
        }

        debug!("Calculating directory size: {}", path.display());

        fn calculate_size(path: &Path) -> std::io::Result<(u64, usize, usize)> {
            let mut total_size: u64 = 0;
            let mut file_count: usize = 0;
            let mut dir_count: usize = 0;

            if path.is_file() {
                let metadata = fs::metadata(path)?;
                return Ok((metadata.len(), 1, 0));
            }

            for entry in fs::read_dir(path)? {
                let entry = entry?;
                let entry_path = entry.path();

                if entry_path.is_dir() {
                    dir_count += 1;
                    let (size, files, dirs) = calculate_size(&entry_path)?;
                    total_size += size;
                    file_count += files;
                    dir_count += dirs;
                } else {
                    let metadata = entry.metadata()?;
                    total_size += metadata.len();
                    file_count += 1;
                }
            }

            Ok((total_size, file_count, dir_count))
        }

        let (total_bytes, file_count, dir_count) = calculate_size(&path)?;

        Ok(DirectorySizeInfo {
            path: path.to_string_lossy().to_string(),
            total_bytes,
            file_count,
            dir_count,
            human_readable: format_bytes(total_bytes),
        })
    }

    /// Get recursive directory tree structure
    pub async fn directory_tree(&self, path: String, max_depth: Option<usize>) -> MCPResult<DirectoryTreeNode> {
        let path = PathBuf::from(&path);

        if !self.is_path_allowed(&path).await {
            return Err(MCPError {
                code: -32001,
                message: format!("Access denied: {} is not in allowed directories", path.display()),
                data: None,
            });
        }

        debug!("Building directory tree: {}", path.display());

        fn build_tree(path: &Path, current_depth: usize, max_depth: usize) -> std::io::Result<DirectoryTreeNode> {
            let metadata = fs::metadata(path)?;
            let name = path.file_name()
                .unwrap_or_else(|| path.as_os_str())
                .to_string_lossy()
                .to_string();

            let is_dir = metadata.is_dir();
            let size = if is_dir { None } else { Some(metadata.len()) };

            let children = if is_dir && current_depth < max_depth {
                let mut child_nodes = Vec::new();

                for entry in fs::read_dir(path)? {
                    let entry = entry?;
                    let child_path = entry.path();

                    match build_tree(&child_path, current_depth + 1, max_depth) {
                        Ok(child) => child_nodes.push(child),
                        Err(_) => continue, // Skip entries we can't read
                    }
                }

                child_nodes.sort_by(|a, b| {
                    // Directories first, then alphabetically
                    match (a.is_dir, b.is_dir) {
                        (true, false) => std::cmp::Ordering::Less,
                        (false, true) => std::cmp::Ordering::Greater,
                        _ => a.name.cmp(&b.name),
                    }
                });

                Some(child_nodes)
            } else {
                None
            };

            Ok(DirectoryTreeNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir,
                size,
                children,
            })
        }

        let max_depth = max_depth.unwrap_or(5); // Default to 5 levels deep
        let tree = build_tree(&path, 0, max_depth)?;
        Ok(tree)
    }

    /// Read multiple files at once
    pub async fn read_multiple_files(&self, paths: Vec<String>) -> MCPResult<Vec<MultiFileResult>> {
        debug!("Reading {} files", paths.len());

        let mut results = Vec::new();

        for path_str in paths {
            let path = PathBuf::from(&path_str);

            if !self.is_path_allowed(&path).await {
                results.push(MultiFileResult {
                    path: path_str.clone(),
                    content: None,
                    error: Some(format!("Access denied: {} is not in allowed directories", path.display())),
                });
                continue;
            }

            // Check file size limit
            match fs::metadata(&path) {
                Ok(metadata) => {
                    let config = self.config.read().await;
                    if let Some(max_size) = config.max_file_size {
                        if metadata.len() > max_size {
                            results.push(MultiFileResult {
                                path: path_str.clone(),
                                content: None,
                                error: Some(format!("File too large: {} bytes (max: {} bytes)", metadata.len(), max_size)),
                            });
                            continue;
                        }
                    }
                }
                Err(e) => {
                    results.push(MultiFileResult {
                        path: path_str.clone(),
                        content: None,
                        error: Some(format!("Failed to get metadata: {}", e)),
                    });
                    continue;
                }
            }

            // Try to read the file
            match fs::read_to_string(&path) {
                Ok(content) => {
                    results.push(MultiFileResult {
                        path: path_str.clone(),
                        content: Some(content),
                        error: None,
                    });
                }
                Err(e) => {
                    results.push(MultiFileResult {
                        path: path_str.clone(),
                        content: None,
                        error: Some(format!("Failed to read file: {}", e)),
                    });
                }
            }
        }

        Ok(results)
    }

    /// Edit file with pattern matching and replacement
    pub async fn edit_file(
        &self,
        path: String,
        old_text: String,
        new_text: String,
        dry_run: Option<bool>,
    ) -> MCPResult<EditFileResult> {
        let path = PathBuf::from(&path);

        if !self.is_path_allowed(&path).await {
            return Err(MCPError {
                code: -32001,
                message: format!("Access denied: {} is not in allowed directories", path.display()),
                data: None,
            });
        }

        debug!("Editing file: {}", path.display());

        // Read current content
        let content = fs::read_to_string(&path)?;

        // Perform replacement
        let new_content = content.replace(&old_text, &new_text);
        let changes_made = content.matches(&old_text).count();

        if changes_made == 0 {
            return Ok(EditFileResult {
                success: false,
                changes_made: 0,
                diff: None,
                error: Some("Pattern not found in file".to_string()),
            });
        }

        // Generate simple diff
        let diff = format!(
            "--- Original\n+++ Modified\n@@ Changes: {} occurrences replaced @@\n- {}\n+ {}",
            changes_made,
            old_text.lines().take(3).collect::<Vec<_>>().join("\n- "),
            new_text.lines().take(3).collect::<Vec<_>>().join("\n+ ")
        );

        // If dry run, don't actually write
        if dry_run.unwrap_or(false) {
            return Ok(EditFileResult {
                success: true,
                changes_made,
                diff: Some(diff),
                error: None,
            });
        }

        // Write the new content
        fs::write(&path, new_content)?;

        Ok(EditFileResult {
            success: true,
            changes_made,
            diff: Some(diff),
            error: None,
        })
    }

    /// List allowed directories
    pub async fn list_allowed_directories(&self) -> MCPResult<Vec<String>> {
        let config = self.config.read().await;
        Ok(config.allowed_directories.clone())
    }

    /// Get list of available tools
    pub fn get_tools() -> Vec<ToolDefinition> {
        vec![
            ToolDefinition {
                name: "read_file".to_string(),
                description: "Read the complete contents of a file from the file system. Use this when you need to examine file contents.".to_string(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the file to read"
                        }
                    },
                    "required": ["path"]
                }),
            },
            ToolDefinition {
                name: "write_file".to_string(),
                description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.".to_string(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the file to write"
                        },
                        "content": {
                            "type": "string",
                            "description": "Content to write to the file"
                        }
                    },
                    "required": ["path", "content"]
                }),
            },
            ToolDefinition {
                name: "list_directory".to_string(),
                description: "Get a detailed listing of all files and directories in a specified path. Returns file metadata including names, sizes, types, and modification times. For files, 'size' is the file size in bytes. For directories, 'size' is only the directory metadata size, NOT the total size of contents. To find which folder uses most space, you'll need to recursively list subdirectories and sum file sizes, or inform the user that recursive directory size calculation is not available in the current tool.".to_string(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the directory to list"
                        }
                    },
                    "required": ["path"]
                }),
            },
            ToolDefinition {
                name: "search_files".to_string(),
                description: "Recursively search for files and directories matching a pattern within a directory (up to 3 levels deep).".to_string(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "directory": {
                            "type": "string",
                            "description": "Absolute path to search in"
                        },
                        "pattern": {
                            "type": "string",
                            "description": "Search pattern (case-insensitive substring match)"
                        }
                    },
                    "required": ["directory", "pattern"]
                }),
            },
            ToolDefinition {
                name: "get_file_info".to_string(),
                description: "Retrieve detailed metadata about a file or directory, including size, type, and modification time.".to_string(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the file or directory"
                        }
                    },
                    "required": ["path"]
                }),
            },
            ToolDefinition {
                name: "move_file".to_string(),
                description: "Move or rename a file or directory to a new location.".to_string(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "from": {
                            "type": "string",
                            "description": "Current absolute path"
                        },
                        "to": {
                            "type": "string",
                            "description": "New absolute path"
                        }
                    },
                    "required": ["from", "to"]
                }),
            },
            ToolDefinition {
                name: "create_directory".to_string(),
                description: "Create a new directory or ensure a directory exists. Creates parent directories if needed.".to_string(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the directory to create"
                        }
                    },
                    "required": ["path"]
                }),
            },
            ToolDefinition {
                name: "get_directory_size".to_string(),
                description: "Calculate the total size of a directory recursively. Returns the total size in bytes and human-readable format, along with file and directory counts. Use this when the user asks which folder is using the most space or wants to compare directory sizes.".to_string(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the directory to analyze"
                        }
                    },
                    "required": ["path"]
                }),
            },
            ToolDefinition {
                name: "directory_tree".to_string(),
                description: "Get a recursive JSON tree structure of a directory and its contents. Returns a hierarchical tree with file names, paths, sizes, and nested children. Useful for understanding project structure and exploring codebases.".to_string(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the directory"
                        },
                        "max_depth": {
                            "type": "integer",
                            "description": "Maximum depth to traverse (default: 5)",
                            "minimum": 1,
                            "maximum": 10
                        }
                    },
                    "required": ["path"]
                }),
            },
            ToolDefinition {
                name: "read_multiple_files".to_string(),
                description: "Read multiple files simultaneously. Returns an array of results with content or error for each file. Gracefully handles errors for individual files without failing the entire operation.".to_string(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "paths": {
                            "type": "array",
                            "items": {
                                "type": "string"
                            },
                            "description": "Array of absolute file paths to read"
                        }
                    },
                    "required": ["paths"]
                }),
            },
            ToolDefinition {
                name: "edit_file".to_string(),
                description: "Edit a file by replacing exact text matches. Supports dry-run mode to preview changes with diff output before applying. More precise than overwriting the entire file.".to_string(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the file to edit"
                        },
                        "old_text": {
                            "type": "string",
                            "description": "Text to find and replace"
                        },
                        "new_text": {
                            "type": "string",
                            "description": "Text to replace with"
                        },
                        "dry_run": {
                            "type": "boolean",
                            "description": "If true, show diff without making changes (default: false)"
                        }
                    },
                    "required": ["path", "old_text", "new_text"]
                }),
            },
            ToolDefinition {
                name: "list_allowed_directories".to_string(),
                description: "List all directories that this MCP server is allowed to access. Useful for understanding the scope of file system access.".to_string(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {},
                    "required": []
                }),
            },
        ]
    }
}

/// Server information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
    pub protocol_version: String,
}

/// File information
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

/// Directory size information
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DirectorySizeInfo {
    pub path: String,
    pub total_bytes: u64,
    pub file_count: usize,
    pub dir_count: usize,
    pub human_readable: String,
}

/// Directory tree node
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct DirectoryTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub children: Option<Vec<DirectoryTreeNode>>,
}

/// Multiple file read result
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MultiFileResult {
    pub path: String,
    pub content: Option<String>,
    pub error: Option<String>,
}

/// Edit file operation
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EditFileResult {
    pub success: bool,
    pub changes_made: usize,
    pub diff: Option<String>,
    pub error: Option<String>,
}

/// Format bytes into human-readable string
fn format_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut unit_index = 0;

    while size >= 1024.0 && unit_index < UNITS.len() - 1 {
        size /= 1024.0;
        unit_index += 1;
    }

    if unit_index == 0 {
        format!("{} {}", bytes, UNITS[unit_index])
    } else {
        format!("{:.2} {}", size, UNITS[unit_index])
    }
}

/// Tool definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}
