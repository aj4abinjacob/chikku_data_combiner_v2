use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegexPattern {
    pub id: String,
    pub title: String,
    pub pattern: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(rename = "isBuiltin", default)]
    pub is_builtin: bool,
}

const BUILTIN_URL: &str =
    "https://raw.githubusercontent.com/aj4abinjacob/chikku_parser/master/app/regex-patterns.json";

const BUNDLED_FALLBACK: &str = include_str!("../../app/regex-patterns.json");

#[derive(Default)]
pub struct PatternState {
    pub cached_builtins: Mutex<Option<Vec<RegexPattern>>>,
}

fn user_patterns_path() -> AppResult<PathBuf> {
    let base = dirs::data_dir().ok_or_else(|| AppError::msg("no data_dir"))?;
    let dir = base.join("chikku-parser");
    fs::create_dir_all(&dir)?;
    Ok(dir.join("user-regex-patterns.json"))
}

fn fetch_builtins() -> Option<Vec<RegexPattern>> {
    let resp = ureq::get(BUILTIN_URL).timeout(std::time::Duration::from_secs(5)).call().ok()?;
    let text = resp.into_string().ok()?;
    serde_json::from_str(&text).ok()
}

fn read_users() -> Vec<RegexPattern> {
    let path = match user_patterns_path() {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn write_users(list: &[RegexPattern]) -> AppResult<()> {
    let path = user_patterns_path()?;
    let s = serde_json::to_string_pretty(list)?;
    fs::write(path, s)?;
    Ok(())
}

pub fn get_all(state: &PatternState) -> AppResult<Vec<RegexPattern>> {
    let builtins = {
        let mut guard = state.cached_builtins.lock().unwrap();
        if guard.is_none() {
            *guard = Some(
                fetch_builtins().unwrap_or_else(|| {
                    serde_json::from_str(BUNDLED_FALLBACK).unwrap_or_default()
                }),
            );
        }
        guard.clone().unwrap_or_default()
    };
    let mut all = builtins;
    all.extend(read_users());
    Ok(all)
}

pub fn save_user(p: RegexPattern) -> AppResult<()> {
    let mut list = read_users();
    if let Some(idx) = list.iter().position(|x| x.id == p.id) {
        list[idx] = RegexPattern { is_builtin: false, ..p };
    } else {
        list.push(RegexPattern { is_builtin: false, ..p });
    }
    write_users(&list)
}

pub fn delete_user(id: &str) -> AppResult<()> {
    let list: Vec<RegexPattern> = read_users().into_iter().filter(|p| p.id != id).collect();
    write_users(&list)
}

pub fn export_to(path: &str) -> AppResult<()> {
    let list = read_users();
    fs::write(path, serde_json::to_string_pretty(&list)?)?;
    Ok(())
}

pub fn import_from(path: &str) -> AppResult<usize> {
    let text = fs::read_to_string(path)?;
    let incoming: Vec<RegexPattern> = serde_json::from_str(&text)?;
    let mut existing = read_users();
    let mut existing_ids: std::collections::HashSet<String> =
        existing.iter().map(|p| p.id.clone()).collect();
    let mut imported = 0usize;
    for p in incoming {
        if !p.id.is_empty() && !p.title.is_empty() && !p.pattern.is_empty()
            && !existing_ids.contains(&p.id)
        {
            existing_ids.insert(p.id.clone());
            existing.push(RegexPattern { is_builtin: false, ..p });
            imported += 1;
        }
    }
    write_users(&existing)?;
    Ok(imported)
}
