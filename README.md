# Chikku Data Combiner

A desktop app for viewing, combining, and transforming CSV data. Built with Electron, React, DuckDB, and BlueprintJS.

## Features

- **CSV Viewer** — Open and browse large CSV files with virtualized scrolling (handles millions of rows)
- **Combine Tables** — Load multiple CSVs and combine them with flexible column mapping (UNION ALL with aliases)
- **Column Operations** — Transform columns with regex extract, trim, upper/lower case, replace, substring, custom SQL, and more
- **Filter & Sort** — Filter data with 16+ operators (equals, contains, IN, LIKE, regex, etc.) and sort by any column
- **Export** — Export filtered/combined results to CSV
- **Cell Selection & Copy** — Click, Shift+click, Cmd+click to select cells; Cmd+C to copy as TSV

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron 31 |
| UI Framework | React 18 |
| Language | TypeScript 5 |
| Database | DuckDB (in-memory) |
| UI Components | BlueprintJS 4 |
| Virtual Scrolling | @tanstack/react-virtual |
| Bundler | Webpack 5 |
| Styles | Less |

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm

### Install

```bash
git clone https://github.com/aj4abinjacob/chikku_data_combiner_v2.git
cd chikku_data_combiner_v2
npm install
```

### Run

```bash
npm run dev
```

This builds the app in development mode and launches Electron.

### Other Commands

| Command | Description |
|---------|-------------|
| `npm run build-dev` | Build in development mode |
| `npm run build-prod` | Build in production mode |
| `npm run watch` | Webpack watch mode |
| `npm run start` | Launch Electron (requires prior build) |
| `npm run dist` | Package for distribution |
| `npm run dist:mac` | Package for macOS |
| `npm run dist:win` | Package for Windows |
| `npm run dist:linux` | Package for Linux |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+O / Ctrl+O | Open CSV files |
| Cmd+Shift+O / Ctrl+Shift+O | Add CSV files to existing session |
| Cmd+E / Ctrl+E | Export CSV |
| Cmd+C / Ctrl+C | Copy selected cells |

## Architecture

The app uses a single-package Electron architecture with three webpack bundles:

- **Main process** (`app/main.ts`) — Window management, DuckDB instances (one per window), IPC handlers
- **Preload** (`app/preload.ts`) — Context bridge exposing a typed `window.api`
- **Renderer** (`src/renderer.tsx`) — React UI with virtualized data grid, sidebar, filters, and dialogs

Data is loaded into DuckDB's in-memory database using `read_csv_auto()`, queried in chunks for virtual scrolling, and exported via `COPY ... TO`.

## License

MIT
