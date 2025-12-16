use tauri::{command, AppHandle, Emitter};
use crate::scanner::{scan_directory, FileNode, ScanStats};
use crate::cleaner::{self, JunkCategory};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, Duration};
use lazy_static::lazy_static;
use std::path::Path;
use sysinfo::Disks;

struct CacheEntry {
    node: FileNode,
    timestamp: SystemTime,
}

// Global state to manage cancellation
struct ScanState {
    cancel_token: Arc<AtomicBool>,
}

lazy_static! {
    static ref SCAN_CACHE: Mutex<HashMap<String, CacheEntry>> = Mutex::new(HashMap::new());
    static ref SCAN_STATE: RwLock<ScanState> = RwLock::new(ScanState { 
        cancel_token: Arc::new(AtomicBool::new(false)) 
    });
}

const CACHE_TTL: u64 = 60 * 60; 

fn normalize_path(path: &str) -> String {
    let mut s = path.to_string();
    if s.len() > 1 && (s.ends_with('/') || s.ends_with('\\')) {
         let is_root = s.len() == 3 && s.chars().nth(1) == Some(':');
         if !is_root && s != "/" {
             s.pop();
         }
    }
    s
}

#[derive(Clone, serde::Serialize)]
struct ScanProgress {
    path: String, // Just the root path being scanned
    count: u64,
    size: u64,
    errors: u64,
}

#[command]
pub async fn scan_dir(app: AppHandle, path: String) -> Result<FileNode, String> {
    scan_dir_internal(app, path, false).await
}

#[command]
pub async fn refresh_scan(app: AppHandle, path: String) -> Result<FileNode, String> {
    scan_dir_internal(app, path, true).await
}

#[command]
pub fn cancel_scan() {
    if let Ok(state) = SCAN_STATE.read() {
        state.cancel_token.store(true, Ordering::Relaxed);
    }
}

async fn scan_dir_internal(app: AppHandle, path: String, force_refresh: bool) -> Result<FileNode, String> {
    let key = normalize_path(&path);

    // Check cache
    if !force_refresh {
        let cache = SCAN_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some(entry) = cache.get(&key) {
            if let Ok(elapsed) = entry.timestamp.elapsed() {
                if elapsed.as_secs() < CACHE_TTL {
                    return Ok(entry.node.clone());
                }
            }
        }
    }

    // Reset cancellation
    let cancel_token = Arc::new(AtomicBool::new(false));
    if let Ok(mut state) = SCAN_STATE.write() {
        state.cancel_token = cancel_token.clone();
    }

    // Stats for progress
    let stats = Arc::new(ScanStats {
        scanned_files: AtomicU64::new(0),
        total_size: AtomicU64::new(0),
        errors: AtomicU64::new(0),
    });

    let is_done = Arc::new(AtomicBool::new(false));

    // Spawn progress emitter
    let stats_clone = stats.clone();
    let app_handle = app.clone();
    let path_report = path.clone();
    let cancel_clone = cancel_token.clone();
    let is_done_clone = is_done.clone();
    
    tauri::async_runtime::spawn(async move {
        // Emit every 100ms
        loop {
            // Check BEFORE sleeping to avoid emitting after done
            if cancel_clone.load(Ordering::Relaxed) || is_done_clone.load(Ordering::Relaxed) {
                break;
            }

            let count = stats_clone.scanned_files.load(Ordering::Relaxed);
            let size = stats_clone.total_size.load(Ordering::Relaxed);
            let errors = stats_clone.errors.load(Ordering::Relaxed);

            let payload = ScanProgress {
                 path: path_report.clone(),
                 count,
                 size,
                 errors
            };
            let _ = app_handle.emit("scan-progress", payload);

            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    });

    let path_clone = path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        scan_directory(&path_clone, Some(stats), Some(cancel_token))
    }).await.map_err(|e| e.to_string())??;

    is_done.store(true, Ordering::Relaxed);
    
    // Update cache
    let mut cache = SCAN_CACHE.lock().map_err(|e| e.to_string())?;
    let now = SystemTime::now();
    
    cache.insert(key.clone(), CacheEntry {
        node: result.clone(),
        timestamp: now,
    });
    
    if let Some(children) = &result.children {
        for child in children {
            let child_key = normalize_path(&child.path);
            cache.insert(child_key, CacheEntry {
                node: child.clone(),
                timestamp: now,
            });
        }
    }

    Ok(result)
}

#[command]
pub fn clear_cache() {
    if let Ok(mut cache) = SCAN_CACHE.lock() {
        cache.clear();
    }
}

#[command]
pub fn reveal_in_explorer(path: String) {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .unwrap();
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .unwrap();
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        // Try to select if possible, otherwise just open parent
        // dbus-send or specific file manager calls would be improved here.
        // For now, let's just open the parent folder.
        let p = std::path::Path::new(&path);
        if let Some(parent) = p.parent() {
             Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .unwrap();
        }
    }
}

#[command]
pub fn open_file(path: String) {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .unwrap();
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(&path)
            .spawn()
            .unwrap();
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .unwrap();
    }
}

#[command]
pub fn delete_item(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Path does not exist".to_string());
    }

    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    
    // Invalidate cache for parent or just clear all for safety?
    // Let's clear for now to be safe as size calc up the tree changes.
    clear_cache();
    
    Ok(())
}

#[command]
pub fn get_drives() -> Vec<FileNode> {
    let mut drives = Vec::new();
    let disks = Disks::new_with_refreshed_list();

    for disk in &disks {
        let name = disk.name().to_string_lossy().to_string();
        let mount_point = disk.mount_point().to_string_lossy().to_string();
        let total = disk.total_space();
        let available = disk.available_space();
        let used = total.saturating_sub(available);

        let height_name = if name.is_empty() {
             if mount_point == "/" { 
                 "System Root".to_string() 
             } else { 
                 mount_point.clone() 
             }
        } else {
             name.clone()
        };
        
        // On Windows, if the name doesn't have the drive letter, we might ideally want it,
        // but the user explicitly requested no parens/extra info.
        // Assuming sysinfo provides "Local Disk (C:)" style defaults often, or user is fine with just Label.
        let final_name = height_name;

        // Try to get actual modification time of the mount point
        let last_modified = std::fs::metadata(&mount_point)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|t| t.as_secs())
            .unwrap_or(0);

        drives.push(FileNode {
            name: final_name,
            path: mount_point,
            size: used,
            is_dir: true,
            children: None,
            last_modified,
            file_count: 0,
        });
    }
    drives
}

#[command]
pub async fn scan_junk() -> Result<Vec<JunkCategory>, String> {
    // This could also be spawned blocking if it takes time
    let result = tauri::async_runtime::spawn_blocking(move || {
        cleaner::scan_junk_items()
    }).await.map_err(|e| e.to_string())?;
    
    Ok(result)
}

#[command]
pub async fn clean_junk(paths: Vec<String>) -> Result<(), String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        cleaner::delete_junk_items(paths)
    }).await.map_err(|e| e.to_string())??;
    
    // Invalidate main scan cache just in case we deleted something overlapping
    clear_cache();
    
    Ok(())
}

