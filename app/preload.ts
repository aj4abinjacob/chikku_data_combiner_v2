import { contextBridge, ipcRenderer } from "electron";

export interface DbApi {
  loadCSV: (filePath: string, tableName: string) => Promise<any>;
  query: (sql: string) => Promise<any[]>;
  exec: (sql: string) => Promise<boolean>;
  describe: (tableName: string) => Promise<any[]>;
  tables: () => Promise<any[]>;
  exportCSV: (sql: string, filePath: string) => Promise<boolean>;
  saveDialog: () => Promise<string | null>;
  onOpenFiles: (callback: (filePaths: string[]) => void) => void;
  onAddFiles: (callback: (filePaths: string[]) => void) => void;
  onExportCSV: (callback: () => void) => void;
}

contextBridge.exposeInMainWorld("api", {
  // Database operations
  loadCSV: (filePath: string, tableName: string) =>
    ipcRenderer.invoke("db:load-csv", filePath, tableName),
  query: (sql: string) => ipcRenderer.invoke("db:query", sql),
  exec: (sql: string) => ipcRenderer.invoke("db:exec", sql),
  describe: (tableName: string) => ipcRenderer.invoke("db:describe", tableName),
  tables: () => ipcRenderer.invoke("db:tables"),
  exportCSV: (sql: string, filePath: string) =>
    ipcRenderer.invoke("db:export-csv", sql, filePath),

  // Dialogs
  saveDialog: () => ipcRenderer.invoke("dialog:save-csv"),

  // Menu events from main process
  onOpenFiles: (callback: (filePaths: string[]) => void) => {
    ipcRenderer.on("open-files", (_event, filePaths) => callback(filePaths));
  },
  onAddFiles: (callback: (filePaths: string[]) => void) => {
    ipcRenderer.on("add-files", (_event, filePaths) => callback(filePaths));
  },
  onExportCSV: (callback: () => void) => {
    ipcRenderer.on("export-csv", () => callback());
  },
} satisfies DbApi);
