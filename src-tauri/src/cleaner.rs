use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;
use std::time::SystemTime;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JunkItem {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub description: String, // Reason why it is junk
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JunkCategory {
    pub id: String,
    pub name: String,
    pub description: String,
    pub items: Vec<JunkItem>,
    pub total_size: u64,
    pub icon: String, // Helper for frontend icon mapping
}

#[cfg(target_os = "macos")]
fn get_potential_junk_paths() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        // (Category ID, Path (Environment variable expanded manually), Description)
        ("system_cache", "~/Library/Caches", "Application Caches"),
        ("system_logs", "~/Library/Logs", "Application Logs"),
        ("trash", "~/.Trashes", "Trash Bin"), // Note: Trashes handling might be tricky with permissions
        ("temp", "/tmp", "Temporary Files"), 
        // More safe paths
    ]
}

#[cfg(target_os = "linux")]
fn get_potential_junk_paths() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        ("system_cache", "~/.cache", "Application Caches"),
        ("temp", "/tmp", "Temporary Files"),
        ("logs", "/var/log", "System Logs"), // Often restricted, need to handle gracefully
    ]
}

#[cfg(target_os = "windows")]
fn get_potential_junk_paths() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        ("temp", "%TEMP%", "Temporary Files"),
        ("windows_temp", "C:\\Windows\\Temp", "Windows Temporary Files"),
        ("prefetch", "C:\\Windows\\Prefetch", "Prefetch Files"),
    ]
}

fn expand_path(path: &str) -> Option<PathBuf> {
    if path.starts_with('~') {
        if let Some(home_dir) = dirs::home_dir() {
            if path == "~" {
                return Some(home_dir);
            }
            return Some(home_dir.join(&path[2..]));
        }
    }
    
    #[cfg(target_os = "windows")]
    {
        use std::env;
        // Simple simplistic env var expansion for %TEMP%
        if path.contains('%') {
            // This is a naive expansion, real world usage might need regex or specific crate
            // For now handling specific known ones
            if path.contains("%TEMP%") {
                let val = env::var("TEMP").or_else(|_| env::var("TMP")).unwrap_or_default();
                return Some(PathBuf::from(path.replace("%TEMP%", &val)));
            }
            if path.contains("%LOCALAPPDATA%") {
                let val = env::var("LOCALAPPDATA").unwrap_or_default();
                return Some(PathBuf::from(path.replace("%LOCALAPPDATA%", &val)));
            }
        }
    }
    
    let p = PathBuf::from(path);
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

pub fn scan_junk_items() -> Vec<JunkCategory> {
    let mut categories: Vec<JunkCategory> = Vec::new();
    let paths = get_potential_junk_paths();

    // Grouping by ID
    for (id, path_str, desc) in paths {
        if let Some(path) = expand_path(path_str) {
            let mut items = Vec::new();
            let mut total_size = 0;
            
            // Shallow scan for caching folders? Or File level? 
            // For Caches, often deleting the whole subfolder is what's wanted, 
            // but we might want to list top-level folders inside Cache.
            
            if let Ok(read_dir) = fs::read_dir(&path) {
                for entry in read_dir.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        let size = if meta.is_dir() {
                            // Deep size calc is expensive, maybe just use 0 or do a quick walk?
                            // For UI responsiveness we might skip deep size here or do it async.
                            // Let's implement a quick depth-1 size estimation or just 0 for now
                            // To be accurate, we should probably do a walk. 
                            match fs_extra::dir::get_size(entry.path()) {
                                Ok(s) => s,
                                Err(_) => 0,
                            }
                        } else {
                            meta.len()
                        };

                        total_size += size;
                        
                        items.push(JunkItem {
                            path: entry.path().to_string_lossy().to_string(),
                            name: entry.file_name().to_string_lossy().to_string(),
                            size,
                            description: format!("Item in {}", desc),
                        });
                    }
                }
            }

            if !items.is_empty() {
                // Check if category already exists (e.g. multiple temp paths)
                if let Some(cat) = categories.iter_mut().find(|c| c.id == id) {
                    cat.items.extend(items);
                    cat.total_size += total_size;
                } else {
                    categories.push(JunkCategory {
                        id: id.to_string(),
                        name: desc.to_string(),
                        description: format!("Files located in {}", path.to_string_lossy()),
                        items,
                        total_size,
                        icon: id.to_string(), // Frontend can map this
                    });
                }
            }
        }
    }
    categories
}

pub fn delete_junk_items(paths: Vec<String>) -> Result<(), String> {
    let mut errors = Vec::new();
    for path in paths {
        let p = Path::new(&path);
        if p.exists() {
            if p.is_file() {
                if let Err(e) = fs::remove_file(p) {
                    errors.push(format!("Failed to delete file {}: {}", path, e));
                }
            } else if p.is_dir() {
                if let Err(e) = fs::remove_dir_all(p) {
                    errors.push(format!("Failed to delete folder {}: {}", path, e));
                }
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}
