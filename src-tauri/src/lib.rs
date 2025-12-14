mod scanner;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        commands::scan_dir,
        commands::refresh_scan,
        commands::clear_cache,
        commands::reveal_in_explorer,
        commands::open_file,
        commands::delete_item,
        commands::get_drives,
        commands::cancel_scan
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

