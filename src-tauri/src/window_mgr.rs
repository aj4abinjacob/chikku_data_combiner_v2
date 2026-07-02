use crate::db::DbState;
use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const SUPPORTED_EXTS: &[&str] = &[
    "csv", "tsv", "json", "jsonl", "ndjson", "parquet", "xlsx", "xls",
];

pub fn is_supported(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    SUPPORTED_EXTS.contains(&ext.as_str())
}

pub fn filter_supported<I, S>(paths: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    paths
        .into_iter()
        .filter(|p| is_supported(p.as_ref()))
        .map(|p| p.as_ref().to_string())
        .collect()
}

/// Per-window queue of files to open. Renderer drains via take_pending_files.
#[derive(Default)]
pub struct PendingFiles {
    by_window: Mutex<HashMap<String, Vec<String>>>,
}

impl PendingFiles {
    pub fn push(&self, label: &str, files: Vec<String>) {
        if files.is_empty() {
            return;
        }
        let mut map = self.by_window.lock();
        map.entry(label.to_string()).or_default().extend(files);
    }

    pub fn take(&self, label: &str) -> Vec<String> {
        let mut map = self.by_window.lock();
        map.remove(label).unwrap_or_default()
    }
}

static WINDOW_COUNTER: AtomicU64 = AtomicU64::new(1);

fn label_for(n: u64) -> String {
    if n == 1 {
        "main".to_string()
    } else {
        format!("win-{}", n)
    }
}

/// Create a new window. If `files` is non-empty, queue them for that window so the
/// renderer can pick them up via `take_pending_files` on mount.
pub fn spawn_window(app: &AppHandle, files: Option<Vec<String>>) -> AppResult<String> {
    let window_id = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = label_for(window_id);
    let cascade_offset = ((window_id - 1) % 8) as f64 * 36.0;
    let url = WebviewUrl::App("index.html".into());
    let builder = WebviewWindowBuilder::new(app, &label, url)
        .title("Chikku Parser")
        .inner_size(1400.0, 900.0)
        .min_inner_size(800.0, 600.0)
        .position(80.0 + cascade_offset, 80.0 + cascade_offset)
        .resizable(true);

    let window = builder
        .build()
        .map_err(|e| AppError::msg(format!("window build: {e}")))?;

    if let Some(files) = files {
        let supported = filter_supported(files);
        if !supported.is_empty() {
            let state: tauri::State<'_, PendingFiles> = app.state();
            state.push(&label, supported);
        }
    }

    // Wire window-close to free DB session
    let app_handle = app.clone();
    let lbl = label.clone();
    window.on_window_event(move |ev| {
        if let tauri::WindowEvent::Destroyed = ev {
            let dbs: tauri::State<'_, DbState> = app_handle.state();
            dbs.close_for(&lbl);
        }
    });

    Ok(label)
}

/// Open externally requested files as independent app sessions.
pub fn spawn_windows_for_files(app: &AppHandle, files: Vec<String>) -> AppResult<Vec<String>> {
    let supported = filter_supported(files);
    if supported.is_empty() {
        return Ok(Vec::new());
    }

    let mut labels = Vec::with_capacity(supported.len());
    for file in supported {
        labels.push(spawn_window(app, Some(vec![file]))?);
    }

    if let Some(label) = labels.last() {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }

    Ok(labels)
}

#[tauri::command]
pub fn take_pending_files(
    window: tauri::Window,
    state: tauri::State<'_, PendingFiles>,
) -> AppResult<Vec<String>> {
    Ok(state.take(window.label()))
}
