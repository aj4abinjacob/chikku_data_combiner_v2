# TODO — Feature Ideas

## Data Transformation
- [ ] **Split Column** — Split a column by delimiter into multiple columns
- [ ] **Unpivot / Melt** — Reverse of pivot; turn column headers into row values (DuckDB has native `UNPIVOT`)
- [ ] **Fill Down/Up** — Fill NULL values with the previous or next non-null value
- [ ] **Data Type Casting** — Convert column types (string to date, string to number, etc.) with format options
- [ ] **Date Operations** — Extract year/month/day/week, date arithmetic, parse date strings

## Analysis & Visualization
- [ ] **Column Profiling / Statistics Panel** — Quick overview per column: null count, unique count, min/max, distribution histogram, most frequent values
- [ ] **Basic Charts** — Bar, line, scatter plots from selected columns (e.g., Chart.js or Recharts)
- [ ] **Cross-tab / Frequency Table** — Quick value counts for categorical columns

## Grid & UX
- [ ] **Find & Replace** — Ctrl+F to search across all cells, with optional regex replace
- [ ] **Multi-column Sort** — Sort by 2+ columns with priority ordering
- [ ] **Pin/Freeze Columns** — Pin key columns to the left while scrolling horizontally
- [ ] **Inline Cell Editing** — Click a cell to edit its value directly
- [ ] **Dark Mode** — Theme toggle

## Workflow
- [ ] **Undo/Redo History** — Operation history with the ability to step back
- [ ] **Saved Queries / Bookmarks** — Save and reuse frequently used SQL or filter configurations
- [ ] **SQL Console** — Free-form SQL query editor to run arbitrary queries against loaded tables
- [ ] **Data Validation Rules** — Flag rows that violate rules (e.g., nulls in required columns, values out of range)
