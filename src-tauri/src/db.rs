use crate::error::{AppError, AppResult};
use duckdb::types::ValueRef;
use duckdb::{params, Connection};
use parking_lot::Mutex;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::Arc;

/// Per-window DuckDB session map. Keyed by Tauri window label.
#[derive(Default)]
pub struct DbState {
    pub sessions: Mutex<HashMap<String, Arc<Mutex<Connection>>>>,
}

impl DbState {
    pub fn open_for(&self, label: &str) -> AppResult<Arc<Mutex<Connection>>> {
        let mut map = self.sessions.lock();
        if let Some(c) = map.get(label) {
            return Ok(c.clone());
        }
        let conn = Connection::open_in_memory()?;
        let arc = Arc::new(Mutex::new(conn));
        map.insert(label.to_string(), arc.clone());
        log::info!("DuckDB opened for window {}", label);
        Ok(arc)
    }

    pub fn close_for(&self, label: &str) {
        let mut map = self.sessions.lock();
        if map.remove(label).is_some() {
            log::info!("DuckDB closed for window {}", label);
        }
    }

    pub fn get(&self, label: &str) -> AppResult<Arc<Mutex<Connection>>> {
        let map = self.sessions.lock();
        map.get(label)
            .cloned()
            .ok_or_else(|| AppError::NoDb(label.to_string()))
    }
}

/// Convert a DuckDB row column to serde_json::Value.
fn value_ref_to_json(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Boolean(b) => Value::Bool(b),
        ValueRef::TinyInt(i) => Value::from(i),
        ValueRef::SmallInt(i) => Value::from(i),
        ValueRef::Int(i) => Value::from(i),
        ValueRef::BigInt(i) => Value::from(i),
        ValueRef::HugeInt(i) => Value::from(i.to_string()),
        ValueRef::UTinyInt(i) => Value::from(i),
        ValueRef::USmallInt(i) => Value::from(i),
        ValueRef::UInt(i) => Value::from(i),
        ValueRef::UBigInt(i) => Value::from(i),
        ValueRef::Float(f) => {
            serde_json::Number::from_f64(f as f64).map(Value::Number).unwrap_or(Value::Null)
        }
        ValueRef::Double(f) => {
            serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
        }
        ValueRef::Decimal(d) => Value::from(d.to_string()),
        ValueRef::Timestamp(_, ts) => Value::from(ts),
        ValueRef::Text(bytes) => {
            Value::from(std::str::from_utf8(bytes).unwrap_or("").to_string())
        }
        ValueRef::Blob(bytes) => Value::from(format!("<blob {} bytes>", bytes.len())),
        ValueRef::Date32(d) => Value::from(d),
        ValueRef::Time64(_, t) => Value::from(t),
        ValueRef::Interval { months, days, nanos } => {
            let mut m = Map::new();
            m.insert("months".into(), Value::from(months));
            m.insert("days".into(), Value::from(days));
            m.insert("nanos".into(), Value::from(nanos));
            Value::Object(m)
        }
        _ => Value::Null,
    }
}

/// Run a SQL statement that returns no rows.
pub fn exec(conn: &Connection, sql: &str) -> AppResult<()> {
    conn.execute_batch(sql)?;
    Ok(())
}

/// Run a SELECT and return rows as `[{col: value, ...}, ...]`.
pub fn query(conn: &Connection, sql: &str) -> AppResult<Vec<Value>> {
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query(params![])?;
    let stmt = rows
        .as_ref()
        .ok_or_else(|| AppError::msg("query did not return statement metadata"))?;
    let col_count = stmt.column_count();
    let col_names: Vec<String> = (0..col_count)
        .map(|i| stmt.column_name(i).map(|s| s.to_string()).unwrap_or_default())
        .collect();
    let mut out: Vec<Value> = Vec::new();
    while let Some(row) = rows.next()? {
        let mut obj = Map::with_capacity(col_count);
        for i in 0..col_count {
            let v = row.get_ref(i)?;
            obj.insert(col_names[i].clone(), value_ref_to_json(v));
        }
        out.push(Value::Object(obj));
    }
    Ok(out)
}
