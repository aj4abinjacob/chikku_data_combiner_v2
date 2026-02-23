import React from "react";
import { Checkbox, Icon } from "@blueprintjs/core";
import { LoadedTable, ColumnInfo } from "../types";

interface SidebarProps {
  tables: LoadedTable[];
  activeTable: string | null;
  schema: ColumnInfo[];
  visibleColumns: string[];
  onSelectTable: (tableName: string) => void;
  onToggleColumn: (colName: string) => void;
}

export function Sidebar({
  tables,
  activeTable,
  schema,
  visibleColumns,
  onSelectTable,
  onToggleColumn,
}: SidebarProps): React.ReactElement {
  return (
    <div className="sidebar">
      {/* Loaded tables */}
      <div className="sidebar-section">
        <h4>Tables</h4>
        {tables.length === 0 && (
          <div style={{ fontSize: 12, color: "#5c7080" }}>No tables loaded</div>
        )}
        {tables.map((t) => (
          <div
            key={t.tableName}
            className="table-list-item"
            onClick={() => onSelectTable(t.tableName)}
            style={{
              cursor: "pointer",
              fontWeight: t.tableName === activeTable ? 600 : 400,
              color: t.tableName === activeTable ? "#137cbd" : undefined,
            }}
          >
            <span className="table-name">
              <Icon
                icon="th"
                size={12}
                style={{ marginRight: 6, opacity: 0.6 }}
              />
              {t.tableName}
            </span>
            <span className="row-count">
              {t.rowCount.toLocaleString()} rows
            </span>
          </div>
        ))}
      </div>

      {/* Column visibility */}
      {schema.length > 0 && (
        <div className="sidebar-section">
          <h4>Columns</h4>
          {schema.map((col) => (
            <div key={col.column_name} className="column-item">
              <Checkbox
                checked={visibleColumns.includes(col.column_name)}
                onChange={() => onToggleColumn(col.column_name)}
                style={{ marginBottom: 0 }}
              />
              <span>{col.column_name}</span>
              <span className="column-type">{col.column_type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
