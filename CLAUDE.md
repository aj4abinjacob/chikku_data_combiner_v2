# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Chikku Data Combiner v2 — an Electron desktop app for viewing, combining, and transforming CSV data. Built with the same tech stack as [Tad](https://github.com/antonycourtney/tad).

## Commands

```bash
npm run dev          # Build (dev) + launch Electron
npm run build-dev    # Build in development mode only
npm run build-prod   # Build in production mode
npm run watch        # Webpack watch mode (dev)
npm run start        # Launch Electron (requires prior build)
npm run dist         # Package for distribution (electron-builder)
npm run dist:mac     # Package for macOS only
npm run clean        # Remove dist/
```

## Architecture

**Single-package Electron app** with two webpack bundles:

- **Main process** (`app/main.ts`) — Electron window management, native menus, DuckDB database instance, all IPC handlers for SQL queries and file dialogs
- **Preload** (`app/preload.ts`) — Context bridge exposing `window.api` to renderer via `contextBridge.exposeInMainWorld`
- **Renderer** (`src/renderer.tsx`) — React 18 entry point, all UI lives here

### IPC Pattern

Main ↔ Renderer communication uses Electron's `ipcMain.handle` / `ipcRenderer.invoke` pattern. All database operations go through the preload bridge (`window.api`). The API surface is typed in `app/preload.ts` as `DbApi`.

### Key Directories

- `app/` — Electron main process + preload (Node.js context)
- `src/components/` — React components (App, Toolbar, Sidebar, DataGrid, StatusBar)
- `src/utils/` — SQL query builder utilities
- `src/styles/` — Less stylesheets (imports BlueprintJS CSS)
- `html/` — HTML shell copied to dist at build time

### Tech Stack

- **Electron 31** — desktop shell
- **React 18** — UI framework
- **TypeScript 5** — all source files
- **DuckDB** — in-memory analytical database for CSV loading, querying, combining, and column operations
- **BlueprintJS 4** — UI component library (buttons, dialogs, selects, icons)
- **Webpack 5** — bundles 3 targets: `electron-main`, `electron-preload`, `electron-renderer`
- **Less** — stylesheet preprocessor

### Data Flow

1. User opens CSV files via native file dialog (menu or keyboard shortcut)
2. Main process loads CSVs into DuckDB via `read_csv_auto()`
3. Renderer queries DuckDB through IPC for schema, data pages, and counts
4. `sqlBuilder.ts` constructs SELECT/WHERE/ORDER BY/LIMIT queries from UI state
5. Combine operation creates a `UNION ALL` across loaded tables
6. Column operations rebuild tables with `CREATE OR REPLACE TABLE ... AS SELECT`
