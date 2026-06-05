mod app_updates;
mod commands;
mod db;
mod error;
mod excel;
mod menu;
mod patterns;
mod window_mgr;

use app_updates::*;
use commands::*;
use db::DbState;
use menu::MenuState;
use patterns::PatternState;
use std::time::Duration;
use tauri::{Manager, RunEvent};
use window_mgr::{
    filter_supported, spawn_window, spawn_windows_for_files, take_pending_files, PendingFiles,
};

fn args_to_files(argv: &[String]) -> Vec<String> {
    // First arg is the app path itself; subsequent args may be files.
    let candidates: Vec<&str> = argv.iter().skip(1).map(|s| s.as_str()).collect();
    filter_supported(candidates)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let cli_files = args_to_files(&std::env::args().collect::<Vec<_>>());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            log::info!("second-instance argv: {:?}", argv);
            let files = args_to_files(&argv);
            if files.is_empty() {
                // No file args — just focus the main window.
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_focus();
                }
                return;
            }
            if let Err(e) = spawn_windows_for_files(app, files) {
                log::warn!("spawn_windows_for_files failed: {e}");
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(DbState::default())
        .manage(UpdateState::default())
        .manage(PatternState::default())
        .manage(PendingFiles::default())
        .manage(MenuState::default())
        .invoke_handler(tauri::generate_handler![
            load_file,
            query,
            exec,
            describe,
            tables,
            export_file,
            export_excel_multi,
            get_excel_sheets,
            free_memory,
            get_regex_patterns,
            save_user_pattern,
            delete_user_pattern,
            export_user_patterns,
            import_user_patterns,
            write_json_file,
            read_json_file,
            file_exists,
            open_new_window,
            close_db,
            take_pending_files,
            get_app_version,
            check_for_update,
            claim_update_notice,
            release_update_notice,
            install_update,
            restart_app,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let menu = menu::build_menu(&handle)?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, ev| {
                menu::handle_menu_event(app, ev.id().0.as_str());
            });

            let initial = cli_files.clone();
            if cfg!(target_os = "macos") && initial.is_empty() {
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(750));
                    if handle.webview_windows().is_empty() {
                        match spawn_window(&handle, None) {
                            Ok(label) => log::info!("delayed initial window spawned: {label}"),
                            Err(e) => log::warn!("delayed initial window spawn failed: {e}"),
                        }
                    }
                });
            } else {
                let initial_labels = if initial.is_empty() {
                    vec![spawn_window(&handle, None)?]
                } else {
                    spawn_windows_for_files(&handle, initial)?
                };
                log::info!("initial window(s) spawned: {:?}", initial_labels);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri app");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = event {
            handle_opened_urls(app_handle, urls);
        }

        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, event);
    });
}

#[cfg(target_os = "macos")]
fn handle_opened_urls(app_handle: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    // macOS "Open With" / drag-to-dock — each url is a file:// path.
    let paths: Vec<String> = urls
        .into_iter()
        .filter_map(|u| u.to_file_path().ok())
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    let supported = filter_supported(paths);
    if supported.is_empty() {
        return;
    }
    if let Err(e) = spawn_windows_for_files(app_handle, supported) {
        log::warn!("spawn_windows_for_files from open-file failed: {e}");
    }
}
