import React from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
} from "@blueprintjs/core";

/** Format a cell value for display */
export function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") {
    if (Number.isInteger(val)) return val.toLocaleString();
    return val.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }
  return String(val);
}

interface PreviewTableDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  rows: Record<string, unknown>[];
  columns: string[];
  maxRows?: number;
}

export function PreviewTableDialog({
  isOpen,
  onClose,
  title = "Preview",
  rows,
  columns,
  maxRows = 200,
}: PreviewTableDialogProps): React.ReactElement {
  const displayRows = rows.slice(0, maxRows);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon="th"
      style={{ width: "90vw", maxWidth: 1100 }}
      canOutsideClickClose
    >
      <DialogBody>
        <div style={{ fontSize: 12, color: "#5c7080", marginBottom: 8 }}>
          {rows.length} row{rows.length !== 1 ? "s" : ""}
          {columns.length > 0 &&
            `, ${columns.length} column${columns.length !== 1 ? "s" : ""}`}
        </div>
        <div className="aggregate-results-wrapper">
          <table className="aggregate-results-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col}>{formatValue(row[col])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > maxRows && (
            <div className="aggregate-results-truncated">
              Showing first {maxRows} of {rows.length.toLocaleString()} rows
            </div>
          )}
        </div>
      </DialogBody>
      <DialogFooter
        actions={<Button text="Close" onClick={onClose} />}
      />
    </Dialog>
  );
}
