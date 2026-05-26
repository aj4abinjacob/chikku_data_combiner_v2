/**
 * Tauri adapter that exposes the same `window.api` shape the Electron preload provides.
 *
 * The React app talks to `window.api` (typed as DbApi). In Tauri builds, the preload script
 * does not exist — this module installs an equivalent surface backed by Tauri commands and
 * event listeners.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";

interface RegexPattern {
  id: string;
  title: string;
  pattern: string;
  description: string;
  category?: string;
  isBuiltin: boolean;
}

interface LoadOptions {
  csvDelimiter?: string;
  csvIgnoreErrors?: boolean;
  excelSheet?: string;
}

const filterMap: Record<string, { name: string; extensions: string[] }[]> = {
  csv: [{ name: "CSV Files", extensions: ["csv"] }],
  tsv: [{ name: "TSV Files", extensions: ["tsv"] }],
  json: [{ name: "JSON Files", extensions: ["json"] }],
  parquet: [{ name: "Parquet Files", extensions: ["parquet"] }],
  xlsx: [{ name: "Excel Files", extensions: ["xlsx"] }],
  xls: [{ name: "Excel Files", extensions: ["xls"] }],
};

function installTauriApi() {
  const api = {
    loadCSV: (filePath: string, tableName: string) =>
      invoke("load_file", { filePath, tableName, options: null }),

    loadFile: (filePath: string, tableName: string, options?: LoadOptions) =>
      invoke("load_file", { filePath, tableName, options: options ?? null }),

    getExcelSheets: (filePath: string) =>
      invoke("get_excel_sheets", { filePath }),

    query: (sql: string) => invoke("query", { sql }),

    exec: (sql: string) => invoke("exec", { sql }),

    describe: (tableName: string) =>
      invoke("describe", { tableName }),

    tables: () => invoke("tables"),

    exportCSV: (sql: string, filePath: string) =>
      invoke("export_file", { sql, filePath, format: "csv" }),

    exportFile: (sql: string, filePath: string, format: string) =>
      invoke("export_file", { sql, filePath, format }),

    exportExcelMulti: (
      sheets: { sheetName: string; sql: string }[],
      filePath: string
    ) => invoke("export_excel_multi", { sheets, filePath }),

    saveDialog: async () => {
      const result = await saveDialog({
        filters: [{ name: "CSV Files", extensions: ["csv"] }],
      });
      return result ?? null;
    },

    saveFileDialog: async (format: string) => {
      const filters = filterMap[format] ?? filterMap.csv;
      const result = await saveDialog({ filters });
      return result ?? null;
    },

    getFreeMemory: () => invoke("free_memory"),

    getRegexPatterns: () => invoke("get_regex_patterns"),

    saveUserPattern: (pattern: RegexPattern) =>
      invoke("save_user_pattern", { pattern }),

    deleteUserPattern: (patternId: string) =>
      invoke("delete_user_pattern", { patternId }),

    exportPatterns: async () => {
      const path = await saveDialog({
        filters: [{ name: "JSON Files", extensions: ["json"] }],
        defaultPath: "regex-patterns.json",
      });
      if (!path) return false;
      return invoke<boolean>("export_user_patterns", { filePath: path });
    },

    importPatterns: async () => {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: "JSON Files", extensions: ["json"] }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return { imported: 0 };
      return invoke<{ imported: number; error?: string }>(
        "import_user_patterns",
        { filePath: path }
      );
    },

    openExternal: async (url: string) => {
      if (/^https?:\/\//i.test(url)) await openExternal(url);
    },

    writeJsonFile: (filePath: string, data: unknown) =>
      invoke("write_json_file", { filePath, data }),

    readJsonFile: async () => {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: "JSON Files", extensions: ["json"] }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return null;
      try {
        return await invoke("read_json_file", { filePath: path });
      } catch (err) {
        return { error: String(err) };
      }
    },

    fileExists: (filePath: string) => invoke("file_exists", { filePath }),

    onOpenFiles: (callback: (filePaths: string[]) => void) => {
      listen<string[]>("open-files", (e) => callback(e.payload));
      // Drain anything queued before the React app mounted.
      invoke<string[]>("take_pending_files")
        .then((files) => {
          if (files && files.length > 0) callback(files);
        })
        .catch(() => {});
    },

    onAddFiles: (callback: (filePaths: string[]) => void) => {
      listen<string[]>("add-files", (e) => callback(e.payload));
    },

    onExportCSV: (callback: () => void) => {
      listen("export-csv", () => callback());
    },

    onSetDarkMode: (callback: (isDark: boolean) => void) => {
      listen<boolean>("set-dark-mode", (e) => callback(e.payload));
    },

    syncTheme: (_isDark: boolean) => {
      // Native menu sync is not wired in this scaffold pass; intentionally no-op.
    },
  };

  (window as any).api = api;
}

export function isTauri(): boolean {
  return typeof (window as any).__TAURI_INTERNALS__ !== "undefined"
    || typeof (window as any).__TAURI__ !== "undefined";
}

export function installIfTauri(): boolean {
  if (!isTauri()) return false;
  installTauriApi();
  return true;
}
