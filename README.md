# Chikku Parser

A Tauri desktop app for viewing documents and exploring, combining, and transforming data files. Built with React, DuckDB, Rust, and BlueprintJS.

## Features

- **Data Viewer** — Open and browse large CSV, TSV, JSON, Parquet, and Excel files with virtualized scrolling
- **PDF Viewer, Image Placement & Export** — Search, thumbnails, outlines, zoom, rotation, a clearly labeled PDF theme menu with Light · Original, Dark · Keep colors, and Dark · High contrast choices, permission-aware printing, drag-and-resize image insertion, and PNG/JPEG/WebP page export at standard paper sizes such as A4 or custom pixel/physical dimensions
- **Combine Tables** — Load multiple files and combine them with flexible column mapping
- **Column Operations** — Transform columns with regex extract, trim, upper/lower case, find/replace, assignment, and more
- **Filter & Sort** — Filter data with 16+ operators and sort by any column
- **Pivot & Aggregate** — Build grouped, aggregate, pivot, lookup, and row-operation workflows
- **Export** — Export filtered or combined results to CSV, TSV, JSON, Excel, or Parquet
- **Cell Selection & Copy** — Select cells and copy as TSV
- **Live Link Previews** — Hover public HTTPS URLs for safe metadata cards, or disable them from View → Live Link Previews
- **In-App Help** — Searchable guidance for tabular, JSON, Markdown, PDF, multi-file, review, and export workflows

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Shell | Tauri 2 |
| Backend | Rust |
| UI Framework | React 18 |
| Language | TypeScript 5 |
| Database | DuckDB (in-memory, per window) |
| UI Components | BlueprintJS 4 |
| Virtual Scrolling | @tanstack/react-virtual |
| Bundler | Webpack 5 |
| Styles | Less |

## Getting Started

### Prerequisites

- Node.js (v22.13+)
- npm
- Rust toolchain via [rustup](https://rustup.rs)
- macOS: Xcode Command Line Tools (`xcode-select --install`)

### Install

```bash
git clone https://github.com/aj4abinjacob/chikku_parser.git
cd chikku_parser
npm install
```

### Run

```bash
npm run dev
```

This starts the webpack dev server for the renderer on port 5181, then launches the Tauri shell.

### Package

```bash
npm run build
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Launch Tauri in development mode |
| `npm run build` | Build/package the Tauri app |
| `npm run clean` | Remove renderer build output |
| `npm run tauri:renderer:build` | Build the renderer only |
| `npm run tauri:renderer:watch` | Run the renderer dev server |
| `npm run tauri:dev` | Launch Tauri in development mode |
| `npm run tauri:build` | Build/package the Tauri app |

## Architecture

- `src-tauri/` — Rust/Tauri app, DuckDB sessions, commands, window management, Excel and pattern helpers
- `src/tauri-api.ts` — Frontend adapter that installs the Tauri-backed `window.api`
- `src/components/` — React UI components
- `src/hooks/` — Virtual scrolling and pivot cache hooks
- `src/utils/` — SQL builders and data-operation helpers
- `src/styles/app.less` — App styles
- `html/index.html` — Renderer HTML shell
- `dist-tauri/` — Renderer output consumed by Tauri

Each Tauri window owns its own in-memory DuckDB session. Files opened through the OS while the app is already running are routed into the running process and spawn new app windows.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+O / Ctrl+O | Open files |
| Cmd+Shift+O / Ctrl+Shift+O | Add files to existing session |
| Cmd+E / Ctrl+E | Export |
| Cmd+C / Ctrl+C | Copy selected cells |
| F1 | Open the in-app Help Center |

## Live Link Previews

Chikku can show a rich metadata card when you hover over a public HTTPS URL in the data grid. The preview fetches page metadata without running page scripts or using browser cookies.

Use **View → Live Link Previews** to turn this behavior on or off. The setting is enabled by default and remembered across app launches. When disabled, URLs remain visible, copyable, and clickable, but Chikku does not request rich preview metadata.

## License

MIT
