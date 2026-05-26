use crate::error::{AppError, AppResult};
use calamine::{open_workbook_auto, Data, Reader};
use rust_xlsxwriter::Workbook;
use serde::Serialize;
use serde_json::Value;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct SheetInfo {
    pub name: String,
    #[serde(rename = "rowCount")]
    pub row_count: usize,
}

pub fn list_sheets(path: &str) -> AppResult<Vec<SheetInfo>> {
    let mut wb = open_workbook_auto(path).map_err(|e| AppError::msg(e.to_string()))?;
    let names = wb.sheet_names().to_vec();
    let mut out = Vec::with_capacity(names.len());
    for name in names {
        let range = wb
            .worksheet_range(&name)
            .map_err(|e| AppError::msg(e.to_string()))?;
        let total = range.height();
        let row_count = total.saturating_sub(1); // exclude header
        out.push(SheetInfo { name, row_count });
    }
    Ok(out)
}

fn data_to_csv_field(d: &Data) -> String {
    match d {
        Data::Empty => String::new(),
        Data::String(s) => csv_escape(s),
        Data::Float(f) => {
            if f.fract() == 0.0 && f.abs() < 1e16 {
                format!("{}", *f as i64)
            } else {
                format!("{}", f)
            }
        }
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(dt) => dt.as_f64().to_string(),
        Data::DateTimeIso(s) => csv_escape(s),
        Data::DurationIso(s) => csv_escape(s),
        Data::Error(e) => csv_escape(&format!("{:?}", e)),
    }
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        let escaped = s.replace('"', "\"\"");
        format!("\"{}\"", escaped)
    } else {
        s.to_string()
    }
}

/// Export the given Excel sheet to a CSV file. Returns the path on success.
pub fn sheet_to_csv(input: &str, sheet_name: Option<&str>, output: &Path) -> AppResult<()> {
    let mut wb = open_workbook_auto(input).map_err(|e| AppError::msg(e.to_string()))?;
    let chosen = if let Some(name) = sheet_name {
        name.to_string()
    } else {
        wb.sheet_names()
            .first()
            .cloned()
            .ok_or_else(|| AppError::msg("workbook has no sheets"))?
    };
    let range = wb
        .worksheet_range(&chosen)
        .map_err(|e| AppError::msg(e.to_string()))?;

    let file = File::create(output)?;
    let mut w = BufWriter::new(file);
    for row in range.rows() {
        let line: Vec<String> = row.iter().map(data_to_csv_field).collect();
        writeln!(w, "{}", line.join(","))?;
    }
    w.flush()?;
    Ok(())
}

/// Write rows to a single-sheet xlsx file.
pub fn write_single_sheet(rows: &[Value], output: &str, sheet_name: &str) -> AppResult<()> {
    let mut book = Workbook::new();
    let sheet = book.add_worksheet();
    let name = sheet_name.chars().take(31).collect::<String>();
    sheet
        .set_name(&name)
        .map_err(|e| AppError::msg(e.to_string()))?;
    write_rows_to_sheet(sheet, rows)?;
    book.save(output)?;
    Ok(())
}

pub struct SheetExport<'a> {
    pub sheet_name: &'a str,
    pub rows: &'a [Value],
}

/// Write multiple sheets to a single xlsx file.
pub fn write_multi_sheet(sheets: &[SheetExport<'_>], output: &str) -> AppResult<()> {
    let mut book = Workbook::new();
    for s in sheets {
        let sheet = book.add_worksheet();
        let name = s.sheet_name.chars().take(31).collect::<String>();
        sheet
            .set_name(&name)
            .map_err(|e| AppError::msg(e.to_string()))?;
        write_rows_to_sheet(sheet, s.rows)?;
    }
    book.save(output)?;
    Ok(())
}

fn write_rows_to_sheet(
    sheet: &mut rust_xlsxwriter::Worksheet,
    rows: &[Value],
) -> AppResult<()> {
    if rows.is_empty() {
        return Ok(());
    }
    // Collect headers from union of keys in row order of first row, then any new keys.
    let mut headers: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for r in rows {
        if let Value::Object(map) = r {
            for k in map.keys() {
                if seen.insert(k.clone()) {
                    headers.push(k.clone());
                }
            }
        }
    }
    for (col, h) in headers.iter().enumerate() {
        sheet.write_string(0, col as u16, h)?;
    }
    for (i, r) in rows.iter().enumerate() {
        let row_idx = (i + 1) as u32;
        if let Value::Object(map) = r {
            for (col, h) in headers.iter().enumerate() {
                if let Some(v) = map.get(h) {
                    write_value(sheet, row_idx, col as u16, v)?;
                }
            }
        }
    }
    Ok(())
}

fn write_value(
    sheet: &mut rust_xlsxwriter::Worksheet,
    row: u32,
    col: u16,
    v: &Value,
) -> AppResult<()> {
    match v {
        Value::Null => {
            sheet.write_blank(row, col, &rust_xlsxwriter::Format::default())?;
        }
        Value::Bool(b) => {
            sheet.write_boolean(row, col, *b)?;
        }
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                sheet.write_number(row, col, f)?;
            } else {
                sheet.write_string(row, col, &n.to_string())?;
            }
        }
        Value::String(s) => {
            sheet.write_string(row, col, s)?;
        }
        other => {
            sheet.write_string(row, col, &other.to_string())?;
        }
    }
    Ok(())
}
