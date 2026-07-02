import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Button,
  Checkbox,
  Intent,
  Dialog,
  DialogBody,
  DialogFooter,
  Callout,
} from "@blueprintjs/core";
import { ColumnInfo } from "../types";
import { PreviewTableDialog } from "./PreviewTableDialog";
import { ColumnCheckList } from "./ColumnCheckList";

const NUMERIC_RE = /^(TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT|FLOAT|REAL|DOUBLE|DECIMAL|NUMERIC)/i;

const ALL_FUNCTIONS = [
  "SUM",
  "MIN",
  "MAX",
  "AVG",
  "COUNT",
  "COUNT DISTINCT",
  "COUNT NULL",
  "MEDIAN",
  "STDDEV",
] as const;

type AggFunc = (typeof ALL_FUNCTIONS)[number];

/** Functions available for non-numeric columns */
const NON_NUMERIC_FUNCTIONS: Set<AggFunc> = new Set(["COUNT", "COUNT DISTINCT", "COUNT NULL", "MIN", "MAX"]);

function isNumeric(colType: string): boolean {
  return NUMERIC_RE.test(colType);
}

function escapeIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function compareColumnNamesCaseless(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "accent", numeric: true }) || a.localeCompare(b);
}

function sortedColumnNames(columns: Iterable<string>): string[] {
  return Array.from(columns).sort(compareColumnNamesCaseless);
}

interface AggregateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  activeTable: string | null;
  schema: ColumnInfo[];
  onCreateTable: (sql: string, filePath: string) => void;
}

export function AggregateDialog({
  isOpen,
  onClose,
  activeTable,
  schema,
  onCreateTable,
}: AggregateDialogProps): React.ReactElement {
  // Group By columns
  const [groupByCols, setGroupByCols] = useState<Set<string>>(new Set());

  // Selected columns (which columns to aggregate)
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());

  // Selected functions
  const [selectedFuncs, setSelectedFuncs] = useState<Set<AggFunc>>(new Set());

  // Results
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [resultColumns, setResultColumns] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Reset state when dialog opens or table changes
  useEffect(() => {
    if (isOpen) {
      setGroupByCols(new Set());
      setSelectedCols(new Set());
      setSelectedFuncs(new Set());
      setResults(null);
      setResultColumns([]);
      setPreviewOpen(false);
      setError(null);
    }
  }, [isOpen, activeTable]);

  const allColNames = useMemo(
    () => sortedColumnNames(schema.map((c) => c.column_name)),
    [schema]
  );
  const aggregateColumnItems = useMemo(
    () => [...schema]
      .sort((a, b) => compareColumnNamesCaseless(a.column_name, b.column_name))
      .map((col) => ({ name: col.column_name, type: col.column_type })),
    [schema]
  );

  const toggleGroupBy = useCallback((col: string) => {
    setGroupByCols((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
    setResults(null);
  }, []);

  const handleColsChange = useCallback((next: Set<string>) => {
    setSelectedCols(next);
    setResults(null);
  }, []);

  const toggleFunc = useCallback((fn: AggFunc) => {
    setSelectedFuncs((prev) => {
      const next = new Set(prev);
      if (next.has(fn)) next.delete(fn);
      else next.add(fn);
      return next;
    });
    setResults(null);
  }, []);

  /** Build the aggregate SQL */
  const buildSQL = useCallback((): string | null => {
    if (!activeTable || selectedCols.size === 0 || selectedFuncs.size === 0) return null;

    const selectParts: string[] = [];

    // Group By columns first
    for (const col of sortedColumnNames(groupByCols)) {
      selectParts.push(escapeIdent(col));
    }

    // Aggregate expressions
    for (const col of sortedColumnNames(selectedCols)) {
      const colInfo = schema.find((c) => c.column_name === col);
      const colIsNumeric = colInfo ? isNumeric(colInfo.column_type) : false;

      for (const fn of ALL_FUNCTIONS) {
        if (!selectedFuncs.has(fn)) continue;
        // Skip numeric-only functions on non-numeric columns
        if (!colIsNumeric && !NON_NUMERIC_FUNCTIONS.has(fn)) continue;

        const ident = escapeIdent(col);
        let expr: string;
        let alias: string;
        if (fn === "COUNT DISTINCT") {
          expr = `COUNT(DISTINCT ${ident})`;
          alias = `COUNT_DISTINCT(${col})`;
        } else if (fn === "COUNT NULL") {
          expr = `SUM(CASE WHEN ${ident} IS NULL THEN 1 ELSE 0 END)`;
          alias = `COUNT_NULL(${col})`;
        } else {
          expr = `${fn}(${ident})`;
          alias = `${fn}(${col})`;
        }
        selectParts.push(`${expr} AS ${escapeIdent(alias)}`);
      }
    }

    if (selectParts.length === 0) return null;

    let sql = `SELECT ${selectParts.join(", ")} FROM ${escapeIdent(activeTable)}`;
    if (groupByCols.size > 0) {
      sql += ` GROUP BY ${sortedColumnNames(groupByCols).map(escapeIdent).join(", ")}`;
    }

    return sql;
  }, [activeTable, selectedCols, selectedFuncs, groupByCols, schema]);

  const handleRun = useCallback(async () => {
    const sql = buildSQL();
    if (!sql) return;

    setRunning(true);
    setError(null);
    try {
      const rows = await window.api.query(sql);
      if (rows.length > 0) {
        setResultColumns(Object.keys(rows[0]));
      } else {
        setResultColumns([]);
      }
      setResults(rows);
      setPreviewOpen(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setResults(null);
      setResultColumns([]);
    } finally {
      setRunning(false);
    }
  }, [buildSQL]);

  const handleCreateTable = useCallback(() => {
    const sql = buildSQL();
    if (!sql) return;
    onCreateTable(sql, "(aggregate)");
    onClose();
  }, [buildSQL, onCreateTable, onClose]);

  const canRun = selectedCols.size > 0 && selectedFuncs.size > 0 && activeTable;
  const groupByList = useMemo(() => sortedColumnNames(groupByCols), [groupByCols]);
  const aggregateOutputs = useMemo(() => {
    const outputs: string[] = [];
    for (const col of sortedColumnNames(selectedCols)) {
      const colInfo = schema.find((c) => c.column_name === col);
      const colIsNumeric = colInfo ? isNumeric(colInfo.column_type) : false;

      for (const fn of ALL_FUNCTIONS) {
        if (!selectedFuncs.has(fn)) continue;
        if (!colIsNumeric && !NON_NUMERIC_FUNCTIONS.has(fn)) continue;
        outputs.push(`${fn}(${col})`);
      }
    }
    return outputs;
  }, [schema, selectedCols, selectedFuncs]);
  const estimatedColumnCount = groupByCols.size + aggregateOutputs.length;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Aggregate Summary"
      className="workbench-dialog"
      style={{ width: 980, maxWidth: "94vw" }}
      canOutsideClickClose={false}
    >
      <DialogBody className="workbench-dialog-body">
        <div className="workbench-layout aggregate-workbench-layout">
          <div className="workbench-config">
          {/* Group By Section */}
          <div className="aggregate-section workbench-section">
            <div className="aggregate-section-header workbench-step-header">
              <span className="workbench-step-title">
                <span className="workbench-step-badge">1</span>
                Group By
                <span className="workbench-muted-label">(optional)</span>
              </span>
              {groupByCols.size > 0 && (
                <Button minimal small text="Clear all" onClick={() => setGroupByCols(new Set())} />
              )}
            </div>
            <div className="aggregate-checkbox-list workbench-chip-grid">
              {allColNames.map((col) => (
                <Checkbox
                  key={col}
                  checked={groupByCols.has(col)}
                  onChange={() => toggleGroupBy(col)}
                  label={col}
                  style={{ marginBottom: 0 }}
                />
              ))}
            </div>
          </div>

          {/* Function Selection */}
          <div className="aggregate-section workbench-section">
            <div className="aggregate-section-header workbench-step-header">
              <span className="workbench-step-title">
                <span className="workbench-step-badge">2</span>
                Aggregate Functions
              </span>
              <span className="workbench-section-count">{selectedFuncs.size} selected</span>
            </div>
            <div className="aggregate-func-row workbench-token-row">
              {ALL_FUNCTIONS.map((fn) => (
                <Checkbox
                  key={fn}
                  checked={selectedFuncs.has(fn)}
                  onChange={() => toggleFunc(fn)}
                  label={fn}
                  style={{ marginBottom: 0 }}
                />
              ))}
            </div>
          </div>

          {/* Column Selection */}
          <div className="aggregate-section workbench-section">
            <div className="aggregate-section-header workbench-step-header">
              <span className="workbench-step-title">
                <span className="workbench-step-badge">3</span>
                Columns to Aggregate
              </span>
              <span className="workbench-section-count">{selectedCols.size} selected</span>
            </div>
            <ColumnCheckList
              items={aggregateColumnItems}
              selected={selectedCols}
              onChange={handleColsChange}
              isNumeric={(type) => isNumeric(type ?? "")}
              numericHint=" (count/count null/min/max only)"
              emptyMeans="invalid"
              maxHeight={234}
            />
          </div>
          </div>

          <aside className="workbench-sidecar">
            <div className="workbench-sidecar-title">Query Summary</div>

            <div className="workbench-summary-block">
              <div className="workbench-summary-label">Group By</div>
              <div className="workbench-chip-row">
                {groupByList.length > 0 ? (
                  groupByList.map((col) => <span key={col} className="workbench-chip">{col}</span>)
                ) : (
                  <span className="workbench-empty-text">All rows</span>
                )}
              </div>
            </div>

            <div className="workbench-summary-block">
              <div className="workbench-summary-label">Aggregations</div>
              <div className="workbench-chip-row">
                {aggregateOutputs.length > 0 ? (
                  aggregateOutputs.slice(0, 8).map((label) => (
                    <span key={label} className="workbench-chip workbench-chip-accent">{label}</span>
                  ))
                ) : (
                  <span className="workbench-empty-text">No aggregate columns yet</span>
                )}
                {aggregateOutputs.length > 8 && (
                  <span className="workbench-chip workbench-chip-muted">+{aggregateOutputs.length - 8} more</span>
                )}
              </div>
            </div>

            <div className="workbench-summary-metrics">
              <div>
                <span>{groupByCols.size}</span>
                <small>group columns</small>
              </div>
              <div>
                <span>{aggregateOutputs.length}</span>
                <small>aggregate columns</small>
              </div>
              <div>
                <span>{estimatedColumnCount}</span>
                <small>total columns</small>
              </div>
            </div>

            <div className="workbench-preview-card">
              <div className="workbench-preview-title">Result Preview</div>
              {results ? (
                <div className="workbench-preview-state success">
                  {results.length.toLocaleString()} row{results.length !== 1 ? "s" : ""} ready in preview.
                </div>
              ) : canRun ? (
                <div className="workbench-preview-state ready">
                  Ready to run with {estimatedColumnCount} output column{estimatedColumnCount !== 1 ? "s" : ""}.
                </div>
              ) : (
                <div className="workbench-preview-state">Select at least one function and one column.</div>
              )}
            </div>
          </aside>

          {/* Error */}
          {error && (
            <Callout intent={Intent.DANGER} icon="error" style={{ marginTop: 10 }}>
              {error}
            </Callout>
          )}

          {/* Results — opens in separate dialog */}
          <PreviewTableDialog
            isOpen={previewOpen}
            onClose={() => setPreviewOpen(false)}
            title="Aggregate Results"
            rows={results ?? []}
            columns={resultColumns}
          />
        </div>
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button text="Close" onClick={onClose} />
            <Button
              intent={Intent.PRIMARY}
              text="Run"
              icon="play"
              onClick={handleRun}
              disabled={!canRun}
              loading={running}
            />
            <Button
              intent={Intent.SUCCESS}
              text="Create as Table"
              icon="th-derived"
              onClick={handleCreateTable}
              disabled={!results || results.length === 0}
            />
          </>
        }
      />
    </Dialog>
  );
}
