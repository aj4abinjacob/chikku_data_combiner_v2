use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Msg(String),

    #[error("no database for window {0}")]
    NoDb(String),

    #[error(transparent)]
    DuckDb(#[from] duckdb::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Xlsx(#[from] rust_xlsxwriter::XlsxError),

    #[error(transparent)]
    Calamine(#[from] calamine::Error),

    #[error(transparent)]
    CalamineXlsx(#[from] calamine::XlsxError),

    #[error(transparent)]
    Tauri(#[from] tauri::Error),

    #[error(transparent)]
    Updater(#[from] tauri_plugin_updater::Error),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
