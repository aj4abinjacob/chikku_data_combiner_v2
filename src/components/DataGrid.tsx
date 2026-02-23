import React from "react";
import { Icon } from "@blueprintjs/core";

interface DataGridProps {
  rows: any[];
  columns: string[];
  sortColumn: string | null;
  sortDirection: "ASC" | "DESC";
  onSort: (column: string) => void;
}

export function DataGrid({
  rows,
  columns,
  sortColumn,
  sortDirection,
  onSort,
}: DataGridProps): React.ReactElement {
  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="welcome">
        <p>No data to display</p>
      </div>
    );
  }

  return (
    <div className="data-grid-container">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 50, textAlign: "right", color: "#5c7080" }}>#</th>
            {columns.map((col) => (
              <th key={col} onClick={() => onSort(col)}>
                {col}
                {sortColumn === col && (
                  <span className="sort-indicator">
                    <Icon
                      icon={sortDirection === "ASC" ? "chevron-up" : "chevron-down"}
                      size={12}
                    />
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              <td style={{ textAlign: "right", color: "#5c7080", fontSize: 11 }}>
                {rowIdx + 1}
              </td>
              {columns.map((col) => (
                <td key={col} title={String(row[col] ?? "")}>
                  {formatCell(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toString() : value.toFixed(4);
  }
  return String(value);
}
