use jwalk::WalkDir;
use serde::{Deserialize, Serialize};
use std::time::SystemTime;
use rayon::prelude::*;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
    pub last_modified: u64,
    pub file_count: u64,
}

pub fn scan_directory(path: &str) -> Result<FileNode, String> {
    let root_path = std::path::Path::new(path);
    if !root_path.exists() {
        return Err("Directory does not exist".to_string());
    }

    // 1. List immediate children of the requested path
    let read_dir = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    let entries: Vec<_> = read_dir.filter_map(|e| e.ok()).collect();
    
    // Partition
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    
    for entry in entries {
        if let Ok(metadata) = entry.metadata() {
            if metadata.is_dir() {
                dirs.push(entry);
            } else {
                files.push((entry, metadata));
            }
        }
    }
    
    let mut total_size = 0;
    let mut file_count = 0;
    
    // Files in root
    for (_entry, meta) in &files {
        total_size += meta.len();
        file_count += 1;
    }
    
    // 2. Process subdirectories in parallel (Lookahead scan)
    // We want to return a node for each directory that INCLUDES its own children list
    // This allows the caller to cache these nodes effectively.
    let dir_results: Vec<FileNode> = dirs.par_iter().map(|entry| {
        let path = entry.path();
        let path_str = path.to_string_lossy().to_string();
        let name = entry.file_name().to_string_lossy().to_string();
        
        let metadata = entry.metadata().unwrap();
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH)
            .duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_secs();

        // LOOKAHEAD: Scan the children of this subdirectory 
        // to populate its `children` field and calculate exact size.
        let (size, count, children) = scan_subdir_details(&path);

        FileNode {
            name,
            path: path_str,
            size,
            is_dir: true,
            children: Some(children), // We now populate this!
            last_modified: modified,
            file_count: count,
        }
    }).collect();
    
    // Aggregate totals
    for dir in &dir_results {
        total_size += dir.size;
        file_count += dir.file_count;
    }
    
    let mut children_nodes = dir_results;
    children_nodes.sort_by(|a, b| b.size.cmp(&a.size));
    
    Ok(FileNode {
        name: root_path.file_name().unwrap_or_default().to_string_lossy().to_string(),
        path: path.to_string(), // Keep original path string for consistency
        size: total_size,
        is_dir: true,
        children: Some(children_nodes),
        last_modified: 0,
        file_count,
    })
}

// Scans a subdirectory: Lists ITS children, and calculates their sizes (deep)
fn scan_subdir_details(path: &std::path::Path) -> (u64, u64, Vec<FileNode>) {
    // List children of this subdirectory
    // We do this synchronously per-thread (since we are already in a parallel closure)
    // OR we could use parallel iterator here too if rayon detects we are in thread pool? 
    // Rayon handles nested parallelism fine.
    
    let mut total_size = 0;
    let mut total_count = 0;
    let mut children_nodes = Vec::new();

    if let Ok(read_dir) = std::fs::read_dir(path) {
        let entries: Vec<_> = read_dir.filter_map(|e| e.ok()).collect();
        
        // Split into files/dirs
        let mut sub_files_size = 0;
        let mut sub_files_count = 0;
        let mut sub_dirs = Vec::new();
        
        for entry in entries {
             if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    sub_dirs.push(entry);
                } else {
                    sub_files_size += meta.len();
                    sub_files_count += 1;
                }
             }
        }
        
        total_size += sub_files_size;
        total_count += sub_files_count;
        
        // Process these subdirectories (Deep scan for size)
        // Since we are already inside a parallel task, doing this sequentially might be better 
        // to avoid task explosion, OR use par_iter if the tree is wide.
        // Let's use par_iter but with caution? Rayon work-stealing is good.
        let sub_dir_nodes: Vec<FileNode> = sub_dirs.par_iter().map(|entry| {
             let p = entry.path();
             let name = entry.file_name().to_string_lossy().to_string();
             let p_str = p.to_string_lossy().to_string();
             
             // Get stats using jwalk (Deep scan)
             let (s, c) = get_deep_stats(&p);
             
             let m = entry.metadata().ok().and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs()).unwrap_or(0);
                
             FileNode {
                 name,
                 path: p_str,
                 size: s,
                 is_dir: true,
                 children: None, // We stop lookahead at 1 level deep to avoid recursion explosion
                 last_modified: m,
                 file_count: c,
             }
        }).collect();
        
        for node in &sub_dir_nodes {
            total_size += node.size;
            total_count += node.file_count;
        }
        
        children_nodes = sub_dir_nodes;
        children_nodes.sort_by(|a, b| b.size.cmp(&a.size));
    }
    
    (total_size, total_count, children_nodes)
}

fn get_deep_stats(path: &std::path::Path) -> (u64, u64) {
    let mut size = 0;
    let mut count = 0;
    
    // Use synchronous walkdir for consistency
    for entry in walkdir::WalkDir::new(path).min_depth(1).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            size += entry.metadata().map(|m| m.len()).unwrap_or(0);
            count += 1;
        }
    }
    
    (size, count)
}
