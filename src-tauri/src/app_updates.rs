use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Manager, State, Window};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct UpdateState {
    inner: Mutex<UpdateCoordinator>,
}

#[derive(Default)]
struct UpdateCoordinator {
    pending: Option<Update>,
    claimed: Option<ClaimedNotice>,
    installing: bool,
}

#[derive(Clone)]
struct ClaimedNotice {
    version: String,
    window_label: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum UpdateDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

impl UpdateInfo {
    fn from_update(update: &Update) -> Self {
        Self {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            date: update.date.map(|date| date.to_string()),
            body: update.body.clone(),
        }
    }
}

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> AppResult<String> {
    Ok(app.package_info().version.to_string())
}

#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> AppResult<Option<UpdateInfo>> {
    let update = app.updater()?.check().await?;
    let info = update.as_ref().map(UpdateInfo::from_update);

    let mut inner = state.inner.lock();
    match update {
        Some(update) => {
            if inner
                .claimed
                .as_ref()
                .is_some_and(|claimed| claimed.version != update.version)
            {
                inner.claimed = None;
            }
            inner.pending = Some(update);
        }
        None => {
            inner.pending = None;
            inner.claimed = None;
        }
    }

    Ok(info)
}

#[tauri::command]
pub fn claim_update_notice(
    app: AppHandle,
    window: Window,
    state: State<'_, UpdateState>,
    version: String,
) -> AppResult<bool> {
    let mut inner = state.inner.lock();
    let Some(pending) = inner.pending.as_ref() else {
        return Ok(false);
    };
    if pending.version != version {
        return Ok(false);
    }

    if let Some(claimed) = inner.claimed.as_ref() {
        if app.get_webview_window(&claimed.window_label).is_none() {
            inner.claimed = None;
        }
    }

    match inner.claimed.as_ref() {
        Some(claimed) if claimed.version == version && claimed.window_label == window.label() => {
            Ok(true)
        }
        Some(claimed) if claimed.version == version => Ok(false),
        _ => {
            inner.claimed = Some(ClaimedNotice {
                version,
                window_label: window.label().to_string(),
            });
            Ok(true)
        }
    }
}

#[tauri::command]
pub fn release_update_notice(
    window: Window,
    state: State<'_, UpdateState>,
    version: String,
) -> AppResult<bool> {
    let mut inner = state.inner.lock();
    let should_release = inner
        .claimed
        .as_ref()
        .is_some_and(|claimed| claimed.version == version && claimed.window_label == window.label());

    if should_release {
        inner.claimed = None;
    }

    Ok(should_release)
}

#[tauri::command]
pub async fn install_update(
    state: State<'_, UpdateState>,
    on_event: Channel<UpdateDownloadEvent>,
) -> AppResult<()> {
    let update = {
        let mut inner = state.inner.lock();
        if inner.installing {
            return Err(AppError::msg("update installation is already in progress"));
        }
        let update = inner
            .pending
            .clone()
            .ok_or_else(|| AppError::msg("there is no pending update"))?;
        inner.installing = true;
        update
    };

    let mut first_chunk = true;
    let result = update
        .download_and_install(
            |chunk_length, content_length| {
                if first_chunk {
                    first_chunk = false;
                    let _ = on_event.send(UpdateDownloadEvent::Started { content_length });
                }
                let _ = on_event.send(UpdateDownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(UpdateDownloadEvent::Finished);
            },
        )
        .await;

    let mut inner = state.inner.lock();
    inner.installing = false;
    match result {
        Ok(()) => {
            inner.pending = None;
            inner.claimed = None;
            Ok(())
        }
        Err(err) => Err(err.into()),
    }
}

#[tauri::command]
pub fn restart_app(app: AppHandle) -> AppResult<()> {
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}
