import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import path from "path";
import log from "electron-log";
import { Database } from "duckdb";

// Per-window DuckDB instances, keyed by webContents.id
const dbMap = new Map<number, Database>();

function getDb(event: Electron.IpcMainInvokeEvent): Database {
  const db = dbMap.get(event.sender.id);
  if (!db) throw new Error("No database for this window");
  return db;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "Chikku Data Combiner",
    webPreferences: {
      preload: path.join(__dirname, "preload.bundle.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Create a fresh in-memory DuckDB for this window
  const db = new Database(":memory:");
  dbMap.set(win.webContents.id, db);
  log.info(`DuckDB initialized for window ${win.webContents.id}`);

  win.loadFile(path.join(__dirname, "index.html"));

  if (process.env.NODE_ENV === "development") {
    win.webContents.openDevTools();
  }

  const wcId = win.webContents.id;
  win.on("closed", () => {
    const oldDb = dbMap.get(wcId);
    if (oldDb) {
      oldDb.close(() => {
        log.info(`DuckDB closed for window ${wcId}`);
      });
      dbMap.delete(wcId);
    }
  });
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Open CSV...",
          accelerator: "CmdOrCtrl+O",
          click: () => handleOpenCSV(),
        },
        {
          label: "Add CSV to Combine...",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => handleAddCSV(),
        },
        { type: "separator" },
        {
          label: "Export Combined CSV...",
          accelerator: "CmdOrCtrl+E",
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send("export-csv");
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];

  // macOS app menu
  if (process.platform === "darwin") {
    template.unshift({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function handleOpenCSV(): Promise<void> {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "CSV Files", extensions: ["csv", "tsv"] }],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    win.webContents.send("open-files", result.filePaths);
  }
}

async function handleAddCSV(): Promise<void> {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "CSV Files", extensions: ["csv", "tsv"] }],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    win.webContents.send("add-files", result.filePaths);
  }
}

// ── IPC Handlers ──

// Load a CSV file into DuckDB and return schema + preview rows
ipcMain.handle(
  "db:load-csv",
  async (event, filePath: string, tableName: string) => {
    const db = getDb(event);
    return new Promise((resolve, reject) => {
      const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, "_");
      db.run(
        `CREATE OR REPLACE TABLE "${safeTable}" AS SELECT * FROM read_csv_auto('${filePath.replace(/'/g, "''")}')`,
        (err: Error | null) => {
          if (err) return reject(err.message);
          // Get schema
          db.all(
            `DESCRIBE "${safeTable}"`,
            (err2: Error | null, schema: any[]) => {
              if (err2) return reject(err2.message);
              // Get row count
              db.all(
                `SELECT COUNT(*) as count FROM "${safeTable}"`,
                (err3: Error | null, countResult: any[]) => {
                  if (err3) return reject(err3.message);
                  resolve({
                    tableName: safeTable,
                    schema,
                    rowCount: Number(countResult[0].count),
                  });
                }
              );
            }
          );
        }
      );
    });
  }
);

// Run a SQL query and return results
ipcMain.handle("db:query", async (event, sql: string) => {
  const db = getDb(event);
  return new Promise((resolve, reject) => {
    db.all(sql, (err: Error | null, rows: any[]) => {
      if (err) return reject(err.message);
      resolve(rows);
    });
  });
});

// Run a SQL statement (no results expected)
ipcMain.handle("db:exec", async (event, sql: string) => {
  const db = getDb(event);
  return new Promise((resolve, reject) => {
    db.run(sql, (err: Error | null) => {
      if (err) return reject(err.message);
      resolve(true);
    });
  });
});

// Get table schema
ipcMain.handle("db:describe", async (event, tableName: string) => {
  const db = getDb(event);
  return new Promise((resolve, reject) => {
    db.all(`DESCRIBE "${tableName}"`, (err: Error | null, rows: any[]) => {
      if (err) return reject(err.message);
      resolve(rows);
    });
  });
});

// List all tables
ipcMain.handle("db:tables", async (event) => {
  const db = getDb(event);
  return new Promise((resolve, reject) => {
    db.all("SHOW TABLES", (err: Error | null, rows: any[]) => {
      if (err) return reject(err.message);
      resolve(rows);
    });
  });
});

// Save dialog for export
ipcMain.handle("dialog:save-csv", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  const result = await dialog.showSaveDialog(win, {
    filters: [{ name: "CSV Files", extensions: ["csv"] }],
  });
  return result.canceled ? null : result.filePath;
});

// Export query results to CSV via DuckDB
ipcMain.handle(
  "db:export-csv",
  async (event, sql: string, filePath: string) => {
    const db = getDb(event);
    return new Promise((resolve, reject) => {
      db.run(
        `COPY (${sql}) TO '${filePath.replace(/'/g, "''")}' (HEADER, DELIMITER ',')`,
        (err: Error | null) => {
          if (err) return reject(err.message);
          resolve(true);
        }
      );
    });
  }
);

// ── App Lifecycle ──

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
