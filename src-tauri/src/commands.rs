use crate::db::{self, DbState};
use crate::error::AppResult;
use crate::excel::{self, SheetExport, SheetInfo};
use crate::patterns::{self, PatternState, RegexPattern};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use tauri::{State, Window};

fn safe_table_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' })
        .collect()
}

fn escape_sql_literal(s: &str) -> String {
    s.replace('\'', "''")
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LoadOptions {
    pub csv_delimiter: Option<String>,
    pub csv_ignore_errors: Option<bool>,
    pub excel_sheet: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum LoadResult {
    Ok {
        #[serde(rename = "tableName")]
        table_name: String,
        schema: Vec<Value>,
        #[serde(rename = "rowCount")]
        row_count: i64,
    },
    Err {
        error: String,
        #[serde(rename = "canRetry")]
        can_retry: bool,
    },
}

fn null_empty_strings(conn: &duckdb::Connection, table: &str) -> AppResult<Vec<Value>> {
    let schema = db::query(conn, &format!(r#"DESCRIBE "{}""#, table))?;
    let mut cols: Vec<String> = Vec::new();
    for row in &schema {
        let name = row.get("column_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let ty = row.get("column_type").and_then(|v| v.as_str()).unwrap_or("");
        let upper = ty.to_ascii_uppercase();
        if upper.starts_with("VARCHAR")
            || upper.starts_with("TEXT")
            || upper.starts_with("STRING")
            || upper.starts_with("CHAR")
        {
            cols.push(name);
        }
    }
    if cols.is_empty() {
        return Ok(schema);
    }
    let clauses: Vec<String> = cols
        .iter()
        .map(|c| format!(r#""{c}" = CASE WHEN TRIM("{c}") = '' THEN NULL ELSE "{c}" END"#))
        .collect();
    db::exec(
        conn,
        &format!(r#"UPDATE "{}" SET {}"#, table, clauses.join(", ")),
    )?;
    Ok(schema)
}

#[tauri::command]
pub fn load_file(
    window: Window,
    db_state: State<'_, DbState>,
    file_path: String,
    table_name: String,
    options: Option<LoadOptions>,
) -> AppResult<LoadResult> {
    let arc = db_state.open_for(window.label())?;
    let conn = arc.lock();
    let safe = safe_table_name(&table_name);
    let opts = options.unwrap_or_default();
    let ext = Path::new(&file_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let safe_path = escape_sql_literal(&file_path);

    let load_result: AppResult<Vec<Value>> = (|| {
        match ext.as_str() {
            "xlsx" | "xls" => {
                let tmp = std::env::temp_dir().join(format!(
                    "chikku_import_{}.csv",
                    uuid_like()
                ));
                excel::sheet_to_csv(&file_path, opts.excel_sheet.as_deref(), &tmp)?;
                let tmp_str = tmp.to_string_lossy().to_string();
                let escaped_tmp = escape_sql_literal(&tmp_str);
                let res = db::exec(
                    &conn,
                    &format!(
                        r#"CREATE OR REPLACE TABLE "{}" AS SELECT * FROM read_csv_auto('{}')"#,
                        safe, escaped_tmp
                    ),
                );
                let _ = std::fs::remove_file(&tmp);
                res?;
            }
            "json" | "jsonl" | "ndjson" => {
                db::exec(
                    &conn,
                    &format!(
                        r#"CREATE OR REPLACE TABLE "{}" AS SELECT * FROM read_json_auto('{}')"#,
                        safe, safe_path
                    ),
                )?;
            }
            "parquet" => {
                db::exec(
                    &conn,
                    &format!(
                        r#"CREATE OR REPLACE TABLE "{}" AS SELECT * FROM read_parquet('{}')"#,
                        safe, safe_path
                    ),
                )?;
            }
            _ => {
                let mut params: Vec<String> = Vec::new();
                if let Some(d) = &opts.csv_delimiter {
                    params.push(format!("delim = '{}'", escape_sql_literal(d)));
                }
                if opts.csv_ignore_errors.unwrap_or(false) {
                    params.push("ignore_errors = true".into());
                }
                let param_str = if params.is_empty() {
                    String::new()
                } else {
                    format!(", {}", params.join(", "))
                };
                db::exec(
                    &conn,
                    &format!(
                        r#"CREATE OR REPLACE TABLE "{}" AS SELECT * FROM read_csv_auto('{}'{})"#,
                        safe, safe_path, param_str
                    ),
                )?;
            }
        }
        null_empty_strings(&conn, &safe)
    })();

    let schema = match load_result {
        Ok(schema) => schema,
        Err(err) => {
            let msg = err.to_string();
            let is_csv_error = (ext == "csv" || ext == "tsv")
                && (msg.contains("CSV")
                    || msg.contains("delimiter")
                    || msg.contains("columns")
                    || msg.contains("expected")
                    || msg.contains("values")
                    || msg.contains("Error"));
            if is_csv_error {
                return Ok(LoadResult::Err {
                    error: msg,
                    can_retry: true,
                });
            }
            return Err(err);
        }
    };
    let count_rows = db::query(
        &conn,
        &format!(r#"SELECT COUNT(*) AS count FROM "{}""#, safe),
    )?;
    let row_count = count_rows
        .first()
        .and_then(|r| r.get("count"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    Ok(LoadResult::Ok {
        table_name: safe,
        schema,
        row_count,
    })
}

#[tauri::command]
pub fn query(
    window: Window,
    db_state: State<'_, DbState>,
    sql: String,
) -> AppResult<Vec<Value>> {
    let arc = db_state.get(window.label())?;
    let conn = arc.lock();
    db::query(&conn, &sql)
}

#[tauri::command]
pub fn exec(
    window: Window,
    db_state: State<'_, DbState>,
    sql: String,
) -> AppResult<bool> {
    let arc = db_state.get(window.label())?;
    let conn = arc.lock();
    db::exec(&conn, &sql)?;
    Ok(true)
}

#[tauri::command]
pub fn describe(
    window: Window,
    db_state: State<'_, DbState>,
    table_name: String,
) -> AppResult<Vec<Value>> {
    let arc = db_state.get(window.label())?;
    let conn = arc.lock();
    db::query(&conn, &format!(r#"DESCRIBE "{}""#, table_name))
}

#[tauri::command]
pub fn tables(
    window: Window,
    db_state: State<'_, DbState>,
) -> AppResult<Vec<Value>> {
    let arc = db_state.get(window.label())?;
    let conn = arc.lock();
    db::query(&conn, "SHOW TABLES")
}

#[tauri::command]
pub fn export_file(
    window: Window,
    db_state: State<'_, DbState>,
    sql: String,
    file_path: String,
    format: String,
) -> AppResult<bool> {
    let arc = db_state.get(window.label())?;
    let conn = arc.lock();
    let safe_path = escape_sql_literal(&file_path);
    match format.as_str() {
        "json" => db::exec(
            &conn,
            &format!("COPY ({sql}) TO '{safe_path}' (FORMAT JSON, ARRAY true)"),
        )?,
        "parquet" => db::exec(
            &conn,
            &format!("COPY ({sql}) TO '{safe_path}' (FORMAT PARQUET)"),
        )?,
        "tsv" => db::exec(
            &conn,
            &format!("COPY ({sql}) TO '{safe_path}' (HEADER, DELIMITER '\t')"),
        )?,
        "xlsx" | "xls" => {
            let rows = db::query(&conn, &sql)?;
            excel::write_single_sheet(&rows, &file_path, "Sheet1")?;
        }
        _ => db::exec(
            &conn,
            &format!("COPY ({sql}) TO '{safe_path}' (HEADER, DELIMITER ',')"),
        )?,
    }
    Ok(true)
}

#[derive(Debug, Deserialize)]
pub struct ExcelSheetSpec {
    #[serde(rename = "sheetName")]
    pub sheet_name: String,
    pub sql: String,
}

#[tauri::command]
pub fn export_excel_multi(
    window: Window,
    db_state: State<'_, DbState>,
    sheets: Vec<ExcelSheetSpec>,
    file_path: String,
) -> AppResult<bool> {
    let arc = db_state.get(window.label())?;
    let conn = arc.lock();
    let mut row_lists: Vec<(String, Vec<Value>)> = Vec::new();
    for s in &sheets {
        let rows = db::query(&conn, &s.sql)?;
        row_lists.push((s.sheet_name.clone(), rows));
    }
    let exports: Vec<SheetExport<'_>> = row_lists
        .iter()
        .map(|(n, r)| SheetExport { sheet_name: n.as_str(), rows: r })
        .collect();
    excel::write_multi_sheet(&exports, &file_path)?;
    Ok(true)
}

#[tauri::command]
pub fn get_excel_sheets(file_path: String) -> AppResult<Vec<SheetInfo>> {
    excel::list_sheets(&file_path)
}

#[tauri::command]
pub fn free_memory() -> AppResult<u64> {
    Ok(get_free_memory_bytes())
}

#[tauri::command]
pub fn get_regex_patterns(state: State<'_, PatternState>) -> AppResult<Vec<RegexPattern>> {
    patterns::get_all(&state)
}

#[tauri::command]
pub fn save_user_pattern(pattern: RegexPattern) -> AppResult<bool> {
    patterns::save_user(pattern)?;
    Ok(true)
}

#[tauri::command]
pub fn delete_user_pattern(pattern_id: String) -> AppResult<bool> {
    patterns::delete_user(&pattern_id)?;
    Ok(true)
}

#[tauri::command]
pub fn export_user_patterns(file_path: String) -> AppResult<bool> {
    patterns::export_to(&file_path)?;
    Ok(true)
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub imported: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub fn import_user_patterns(file_path: String) -> AppResult<ImportResult> {
    match patterns::import_from(&file_path) {
        Ok(n) => Ok(ImportResult { imported: n, error: None }),
        Err(e) => Ok(ImportResult { imported: 0, error: Some(e.to_string()) }),
    }
}

#[tauri::command]
pub fn write_json_file(file_path: String, data: Value) -> AppResult<bool> {
    let s = serde_json::to_string_pretty(&data)?;
    std::fs::write(file_path, s)?;
    Ok(true)
}

#[tauri::command]
pub fn read_json_file(file_path: String) -> AppResult<Value> {
    let s = std::fs::read_to_string(file_path)?;
    let v: Value = serde_json::from_str(&s)?;
    Ok(v)
}

#[tauri::command]
pub fn read_text_file(file_path: String) -> AppResult<String> {
    Ok(std::fs::read_to_string(file_path)?)
}

#[tauri::command]
pub fn write_text_file(file_path: String, contents: String) -> AppResult<bool> {
    std::fs::write(file_path, contents)?;
    Ok(true)
}

#[tauri::command]
pub fn write_binary_file(file_path: String, bytes: Vec<u8>) -> AppResult<bool> {
    std::fs::write(file_path, bytes)?;
    Ok(true)
}

#[tauri::command]
pub fn file_exists(file_path: String) -> AppResult<bool> {
    Ok(Path::new(&file_path).exists())
}

#[tauri::command]
pub fn open_new_window(app: tauri::AppHandle, files: Option<Vec<String>>) -> AppResult<String> {
    let label = crate::window_mgr::spawn_window(&app, files)?;
    Ok(label)
}

#[tauri::command]
pub fn close_db(window: Window, db_state: State<'_, DbState>) -> AppResult<bool> {
    db_state.close_for(window.label());
    Ok(false)
}

// ---- helpers ----

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{}_{}", t.as_secs(), t.subsec_nanos())
}

#[cfg(target_os = "macos")]
fn get_free_memory_bytes() -> u64 {
    // Crude approximation: page size * free pages from vm_stat parsing is heavy; fall back to 0 if not implementable here.
    // Renderer only uses this to threshold strategy choices.
    sysinfo_free_bytes()
}

#[cfg(not(target_os = "macos"))]
fn get_free_memory_bytes() -> u64 {
    sysinfo_free_bytes()
}

fn sysinfo_free_bytes() -> u64 {
    // Avoid heavy sysinfo dep — use page_size * /proc/meminfo style on linux; on others, return a large constant.
    #[cfg(target_os = "linux")]
    {
        if let Ok(s) = std::fs::read_to_string("/proc/meminfo") {
            for line in s.lines() {
                if let Some(rest) = line.strip_prefix("MemAvailable:") {
                    let kb: u64 = rest
                        .trim()
                        .trim_end_matches(" kB")
                        .parse()
                        .unwrap_or(0);
                    return kb * 1024;
                }
            }
        }
        0
    }
    #[cfg(not(target_os = "linux"))]
    {
        // Conservative default so renderer never picks the per-step-undo path based on a bogus tiny number
        4_u64 * 1024 * 1024 * 1024
    }
}
