use crate::error::AppResult;
use parking_lot::Mutex;
use tauri::menu::{
    AboutMetadata, CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder,
    PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

const DATA_EXTS: &[&str] = &[
    "csv", "tsv", "json", "jsonl", "ndjson", "md", "markdown", "parquet", "xlsx", "xls",
];

pub struct MenuState {
    pub dark_mode: Mutex<bool>,
    pub link_previews_enabled: Mutex<bool>,
}

impl Default for MenuState {
    fn default() -> Self {
        Self {
            dark_mode: Mutex::new(false),
            link_previews_enabled: Mutex::new(true),
        }
    }
}

pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> AppResult<Menu<R>> {
    let open_item = MenuItemBuilder::new("Open File...")
        .id("file:open")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let add_item = MenuItemBuilder::new("Add File...")
        .id("file:add")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    let export_item = MenuItemBuilder::new("Export...")
        .id("file:export")
        .accelerator("CmdOrCtrl+E")
        .build(app)?;
    let check_updates_item = MenuItemBuilder::new("Check for Updates...")
        .id("app:check-updates")
        .build(app)?;
    let quit_item = PredefinedMenuItem::quit(app, None)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&open_item)
        .item(&add_item)
        .separator()
        .item(&export_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let dark_item = MenuItemBuilder::new("Toggle Dark Mode")
        .id("view:dark")
        .accelerator("CmdOrCtrl+Shift+D")
        .build(app)?;
    let link_previews_enabled = *app.state::<MenuState>().link_previews_enabled.lock();
    let link_previews_item = CheckMenuItemBuilder::new("Live Link Previews")
        .id("view:link-previews")
        .checked(link_previews_enabled)
        .build(app)?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&dark_item)
        .separator()
        .item(&link_previews_item)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    #[cfg(not(target_os = "macos"))]
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&check_updates_item)
        .build()?;

    let mut builder = MenuBuilder::new(app);

    #[cfg(target_os = "macos")]
    {
        let pkg_info = app.package_info();
        let config = app.config();
        let about_metadata = AboutMetadata {
            name: Some(
                config
                    .product_name
                    .clone()
                    .unwrap_or_else(|| pkg_info.name.clone()),
            ),
            version: Some(pkg_info.version.to_string()),
            copyright: config.bundle.copyright.clone(),
            authors: config.bundle.publisher.clone().map(|p| vec![p]),
            ..Default::default()
        };
        let app_menu = SubmenuBuilder::new(app, "Chikku Parser")
            .item(&PredefinedMenuItem::about(app, None, Some(about_metadata))?)
            .separator()
            .item(&check_updates_item)
            .separator()
            .item(&PredefinedMenuItem::services(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::hide(app, None)?)
            .item(&PredefinedMenuItem::hide_others(app, None)?)
            .item(&PredefinedMenuItem::show_all(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::quit(app, None)?)
            .build()?;
        builder = builder.item(&app_menu);
    }

    builder = builder.item(&file_menu).item(&edit_menu).item(&view_menu);

    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.item(&help_menu);
    }

    Ok(builder.build()?)
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "file:open" => pick_and_emit(app, "open-files"),
        "file:add" => pick_and_emit(app, "add-files"),
        "file:export" => emit_focused(app, "export-csv", ()),
        "app:check-updates" => emit_focused(app, "check-for-updates", ()),
        "view:dark" => {
            let state: tauri::State<'_, MenuState> = app.state();
            let next = {
                let mut g = state.dark_mode.lock();
                *g = !*g;
                *g
            };
            emit_focused(app, "set-dark-mode", next);
        }
        "view:link-previews" => {
            let state: tauri::State<'_, MenuState> = app.state();
            let next = {
                let mut enabled = state.link_previews_enabled.lock();
                *enabled = !*enabled;
                *enabled
            };
            if let Some(item) = link_previews_menu_item(app) {
                let _ = item.set_checked(next);
            }
            let _ = app.emit("set-link-previews-enabled", next);
        }
        _ => {}
    }
}

#[tauri::command]
pub fn sync_link_previews_enabled(
    app: AppHandle,
    state: State<'_, MenuState>,
    enabled: bool,
) -> AppResult<bool> {
    *state.link_previews_enabled.lock() = enabled;
    if let Some(item) = link_previews_menu_item(&app) {
        item.set_checked(enabled)?;
    }
    Ok(enabled)
}

fn link_previews_menu_item<R: Runtime>(app: &AppHandle<R>) -> Option<CheckMenuItem<R>> {
    app.menu()?
        .items()
        .ok()?
        .into_iter()
        .filter_map(|item| item.as_submenu().cloned())
        .find_map(|submenu| {
            submenu
                .get("view:link-previews")
                .and_then(|item| item.as_check_menuitem().cloned())
        })
}

fn pick_and_emit<R: Runtime>(app: &AppHandle<R>, event: &'static str) {
    let app_clone = app.clone();
    let dialog = app.dialog().clone();
    dialog
        .file()
        .add_filter("Data Files", DATA_EXTS)
        .add_filter("CSV / TSV", &["csv", "tsv"])
        .add_filter("JSON", &["json", "jsonl", "ndjson"])
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("Parquet", &["parquet"])
        .add_filter("Excel", &["xlsx", "xls"])
        .pick_files(move |paths| {
            let Some(paths) = paths else { return };
            let strs: Vec<String> = paths
                .into_iter()
                .filter_map(|p| {
                    p.into_path()
                        .ok()
                        .map(|pb| pb.to_string_lossy().to_string())
                })
                .collect();
            if strs.is_empty() {
                return;
            }
            emit_focused(&app_clone, event, strs);
        });
}

fn emit_focused<R: Runtime, T: serde::Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: T,
) {
    for (_label, w) in app.webview_windows() {
        if w.is_focused().unwrap_or(false) {
            let _ = w.emit(event, payload);
            return;
        }
    }
    let _ = app.emit(event, payload);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_link_previews_are_enabled_by_default() {
        assert!(*MenuState::default().link_previews_enabled.lock());
    }
}
