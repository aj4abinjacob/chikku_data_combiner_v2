import React, { useState, useEffect, useCallback } from "react";
import { Button, Intent } from "@blueprintjs/core";
import { LoadedTable, ViewState, ColumnInfo } from "../types";
import { Toolbar } from "./Toolbar";
import { Sidebar } from "./Sidebar";
import { DataGrid } from "./DataGrid";
import { StatusBar } from "./StatusBar";
import { buildSelectQuery, buildCombineQuery, buildCountQuery } from "../utils/sqlBuilder";
import path from "path";

const DEFAULT_PAGE_SIZE = 500;

function makeTableName(filePath: string): string {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[^a-zA-Z0-9_]/g, "_");
}

export function App(): React.ReactElement {
  const [tables, setTables] = useState<LoadedTable[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [schema, setSchema] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [viewState, setViewState] = useState<ViewState>({
    visibleColumns: [],
    filters: [],
    sortColumn: null,
    sortDirection: "ASC",
    limit: DEFAULT_PAGE_SIZE,
    offset: 0,
  });

  // Load CSV files into DuckDB
  const loadFiles = useCallback(
    async (filePaths: string[], replace: boolean) => {
      const newTables: LoadedTable[] = replace ? [] : [...tables];

      for (const fp of filePaths) {
        const tableName = makeTableName(fp);
        try {
          const result = await window.api.loadCSV(fp, tableName);
          newTables.push({
            tableName: result.tableName,
            filePath: fp,
            schema: result.schema,
            rowCount: result.rowCount,
          });
        } catch (err) {
          console.error(`Failed to load ${fp}:`, err);
        }
      }

      setTables(newTables);

      if (newTables.length > 0) {
        const first = newTables[0].tableName;
        setActiveTable(first);
      }
    },
    [tables]
  );

  // Listen for menu events from main process
  useEffect(() => {
    window.api.onOpenFiles((filePaths) => loadFiles(filePaths, true));
    window.api.onAddFiles((filePaths) => loadFiles(filePaths, false));
    window.api.onExportCSV(async () => {
      if (!activeTable) return;
      const savePath = await window.api.saveDialog();
      if (!savePath) return;
      const sql =
        tables.length > 1
          ? buildCombineQuery(tables.map((t) => t.tableName))
          : `SELECT * FROM "${activeTable}"`;
      await window.api.exportCSV(sql, savePath);
    });
  }, [loadFiles, activeTable, tables]);

  // When active table or view state changes, refresh data
  useEffect(() => {
    if (!activeTable) return;

    const fetchData = async () => {
      try {
        // Get schema for active table
        const desc = await window.api.describe(activeTable);
        setSchema(desc);

        // If no visible columns set, show all
        const vs =
          viewState.visibleColumns.length > 0
            ? viewState
            : { ...viewState, visibleColumns: desc.map((c: ColumnInfo) => c.column_name) };

        // Get total count (for pagination)
        const countSql = buildCountQuery(activeTable, vs.filters);
        const countResult = await window.api.query(countSql);
        setTotalRows(countResult[0]?.total ?? 0);

        // Get page of data
        const dataSql = buildSelectQuery(activeTable, vs);
        const dataRows = await window.api.query(dataSql);
        setRows(dataRows);
      } catch (err) {
        console.error("Query error:", err);
      }
    };

    fetchData();
  }, [activeTable, viewState]);

  // Combine all loaded tables into a new "combined" table
  const handleCombine = useCallback(async () => {
    if (tables.length < 2) return;
    const sql = buildCombineQuery(tables.map((t) => t.tableName));
    try {
      await window.api.exec(
        `CREATE OR REPLACE TABLE "combined" AS ${sql}`
      );
      const desc = await window.api.describe("combined");
      const countResult = await window.api.query(
        `SELECT COUNT(*) as count FROM "combined"`
      );
      const combinedTable: LoadedTable = {
        tableName: "combined",
        filePath: "(combined)",
        schema: desc,
        rowCount: countResult[0].count,
      };

      // Add combined table if not already present
      setTables((prev) => {
        const without = prev.filter((t) => t.tableName !== "combined");
        return [...without, combinedTable];
      });
      setActiveTable("combined");
    } catch (err) {
      console.error("Combine error:", err);
    }
  }, [tables]);

  // Column visibility toggle
  const toggleColumn = useCallback(
    (colName: string) => {
      setViewState((prev) => {
        const visible = prev.visibleColumns.includes(colName)
          ? prev.visibleColumns.filter((c) => c !== colName)
          : [...prev.visibleColumns, colName];
        return { ...prev, visibleColumns: visible, offset: 0 };
      });
    },
    []
  );

  // Sort handler
  const handleSort = useCallback((column: string) => {
    setViewState((prev) => ({
      ...prev,
      sortColumn: column,
      sortDirection:
        prev.sortColumn === column && prev.sortDirection === "ASC"
          ? "DESC"
          : "ASC",
      offset: 0,
    }));
  }, []);

  // Pagination
  const handlePageChange = useCallback((newOffset: number) => {
    setViewState((prev) => ({ ...prev, offset: newOffset }));
  }, []);

  // Column operation: run SQL to add/replace column
  const handleColumnOperation = useCallback(
    async (sql: string) => {
      if (!activeTable) return;
      try {
        await window.api.exec(sql);
        // Refresh schema and data
        setViewState((prev) => ({ ...prev, visibleColumns: [] }));
      } catch (err) {
        console.error("Column operation error:", err);
      }
    },
    [activeTable]
  );

  const hasData = tables.length > 0;

  return (
    <div className="app-container">
      <Toolbar
        hasData={hasData}
        tableCount={tables.length}
        onCombine={handleCombine}
        activeTable={activeTable}
        onColumnOperation={handleColumnOperation}
        schema={schema}
      />
      <div className="main-layout">
        <Sidebar
          tables={tables}
          activeTable={activeTable}
          schema={schema}
          visibleColumns={viewState.visibleColumns}
          onSelectTable={setActiveTable}
          onToggleColumn={toggleColumn}
        />
        <div className="data-area">
          {hasData ? (
            <DataGrid
              rows={rows}
              columns={viewState.visibleColumns}
              sortColumn={viewState.sortColumn}
              sortDirection={viewState.sortDirection}
              onSort={handleSort}
            />
          ) : (
            <div className="welcome">
              <h2>Chikku Data Combiner</h2>
              <p>Open CSV files to get started (Cmd+O / Ctrl+O)</p>
              <p>Add more files to combine them (Cmd+Shift+O / Ctrl+Shift+O)</p>
            </div>
          )}
        </div>
      </div>
      <StatusBar
        totalRows={totalRows}
        limit={viewState.limit}
        offset={viewState.offset}
        onPageChange={handlePageChange}
        activeTable={activeTable}
        tableCount={tables.length}
      />
    </div>
  );
}
