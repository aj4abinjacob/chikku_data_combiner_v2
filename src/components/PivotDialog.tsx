import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Button,
  Intent,
  Dialog,
  DialogBody,
  DialogFooter,
  Callout,
  Icon,
} from "@blueprintjs/core";
import { SoftSelect } from "./SoftSelect";
import { ColumnInfo } from "../types";
import { PreviewTableDialog } from "./PreviewTableDialog";
import { ColumnCheckList } from "./ColumnCheckList";

const NUMERIC_RE =
  /^(TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT|FLOAT|REAL|DOUBLE|DECIMAL|NUMERIC)/i;

const AGG_FUNCTIONS = [
  "SUM",
  "COUNT",
  "COUNT NULL",
  "AVG",
  "MIN",
  "MAX",
  "MEDIAN",
  "STDDEV",
  "FIRST",
] as const;

type AggFunc = (typeof AGG_FUNCTIONS)[number];

/** Functions that work on non-numeric columns */
const NON_NUMERIC_FUNCTIONS: Set<AggFunc> = new Set([
  "COUNT",
  "COUNT NULL",
  "MIN",
  "MAX",
  "FIRST",
]);

function isNumeric(colType: string): boolean {
  return NUMERIC_RE.test(colType);
}

function escapeIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

interface PivotDialogProps {
  isOpen: boolean;
  onClose: () => void;
  activeTable: string | null;
  schema: ColumnInfo[];
  onCreateTable: (sql: string, filePath: string) => void;
}

export function PivotDialog({
  isOpen,
  onClose,
  activeTable,
  schema,
  onCreateTable,
}: PivotDialogProps): React.ReactElement {
  // Row fields (GROUP BY in the pivot)
  const [rowFields, setRowFields] = useState<Set<string>>(new Set());

  // Pivot column (the column whose values become headers)
  const [pivotColumn, setPivotColumn] = useState<string>("");

  // Value fields (columns to aggregate)
  const [valueFields, setValueFields] = useState<Set<string>>(new Set());

  // Aggregate function
  const [aggFunction, setAggFunction] = useState<AggFunc>("SUM");

  // Results
  const [results, setResults] = useState<Record<string, unknown>[] | null>(
    null
  );
  const [resultColumns, setResultColumns] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Distinct value info for pivot column
  const [pivotDistinctCount, setPivotDistinctCount] = useState<number | null>(
    null
  );
  const [pivotDistinctValues, setPivotDistinctValues] = useState<string[]>([]);
  const [loadingDistinct, setLoadingDistinct] = useState(false);

  // Debounce timer ref
  const distinctTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when dialog opens or table changes
  useEffect(() => {
    if (isOpen) {
      setRowFields(new Set());
      setPivotColumn("");
      setValueFields(new Set());
      setAggFunction("SUM");
      setResults(null);
      setResultColumns([]);
      setPreviewOpen(false);
      setError(null);
      setPivotDistinctCount(null);
      setPivotDistinctValues([]);
    }
  }, [isOpen, activeTable]);

  // Fetch distinct values when pivot column changes (with 300ms debounce)
  useEffect(() => {
    if (distinctTimerRef.current) {
      clearTimeout(distinctTimerRef.current);
      distinctTimerRef.current = null;
    }

    if (!pivotColumn || !activeTable) {
      setPivotDistinctCount(null);
      setPivotDistinctValues([]);
      return;
    }

    setLoadingDistinct(true);

    distinctTimerRef.current = setTimeout(async () => {
      try {
        const countResult = await window.api.query(
          `SELECT COUNT(DISTINCT ${escapeIdent(pivotColumn)}) AS cnt FROM ${escapeIdent(activeTable)}`
        );
        const count = Number(countResult[0].cnt);
        setPivotDistinctCount(count);

        const valuesResult = await window.api.query(
          `SELECT DISTINCT ${escapeIdent(pivotColumn)} AS val FROM ${escapeIdent(activeTable)} ORDER BY ${escapeIdent(pivotColumn)} LIMIT 50`
        );
        setPivotDistinctValues(
          valuesResult.map((r: Record<string, unknown>) =>
            r.val === null ? "NULL" : String(r.val)
          )
        );
      } catch {
        setPivotDistinctCount(null);
        setPivotDistinctValues([]);
      } finally {
        setLoadingDistinct(false);
      }
    }, 300);

    return () => {
      if (distinctTimerRef.current) {
        clearTimeout(distinctTimerRef.current);
      }
    };
  }, [pivotColumn, activeTable]);

  const allColNames = schema.map((c) => c.column_name);

  // Columns available for pivot (exclude row fields)
  const pivotColumnOptions = allColNames.filter((c) => !rowFields.has(c));

  const handleRowFieldsChange = useCallback((next: Set<string>) => {
    setRowFields(next);
    setResults(null);
  }, []);

  // Clear pivot column if it becomes a row field
  useEffect(() => {
    if (pivotColumn && rowFields.has(pivotColumn)) {
      setPivotColumn("");
    }
  }, [rowFields, pivotColumn]);

  const handleValueFieldsChange = useCallback((next: Set<string>) => {
    setValueFields(next);
    setResults(null);
  }, []);

  const handleAggFunctionSelect = useCallback((fn: AggFunc) => {
    setAggFunction(fn);
    setResults(null);
  }, []);

  const handleAggFunctionKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIndex = (index + 1) % AGG_FUNCTIONS.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIndex = (index - 1 + AGG_FUNCTIONS.length) % AGG_FUNCTIONS.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = AGG_FUNCTIONS.length - 1;
      }

      if (nextIndex === null) return;

      event.preventDefault();
      const nextFn = AGG_FUNCTIONS[nextIndex];
      handleAggFunctionSelect(nextFn);

      const buttons =
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
          ".pivot-agg-function-option"
        );
      buttons?.[nextIndex]?.focus();
    },
    [handleAggFunctionSelect]
  );

  /** Build the DuckDB PIVOT SQL */
  const buildPivotSQL = useCallback((): string | null => {
    if (!activeTable || !pivotColumn || valueFields.size === 0) return null;

    // Build USING clause: filter out invalid combos (non-numeric col + numeric-only func)
    const usingParts: string[] = [];
    for (const col of valueFields) {
      const colInfo = schema.find((c) => c.column_name === col);
      const colIsNumeric = colInfo ? isNumeric(colInfo.column_type) : false;
      if (!colIsNumeric && !NON_NUMERIC_FUNCTIONS.has(aggFunction)) continue;
      if (aggFunction === "COUNT NULL") {
        usingParts.push(`SUM(CASE WHEN ${escapeIdent(col)} IS NULL THEN 1 ELSE 0 END)`);
      } else {
        usingParts.push(`${aggFunction}(${escapeIdent(col)})`);
      }
    }

    if (usingParts.length === 0) return null;

    let sql = `PIVOT ${escapeIdent(activeTable)} ON ${escapeIdent(pivotColumn)} USING ${usingParts.join(", ")}`;

    if (rowFields.size > 0) {
      sql += ` GROUP BY ${[...rowFields].map(escapeIdent).join(", ")}`;
    }

    return sql;
  }, [activeTable, pivotColumn, valueFields, aggFunction, rowFields, schema]);

  const handleRun = useCallback(async () => {
    const sql = buildPivotSQL();
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
  }, [buildPivotSQL]);

  const handleCreateTable = useCallback(() => {
    const sql = buildPivotSQL();
    if (!sql) return;
    onCreateTable(sql, "(pivot)");
    onClose();
  }, [buildPivotSQL, onCreateTable, onClose]);

  // Can run: pivot column selected + at least one valid value field
  const hasValidUsing = (() => {
    for (const col of valueFields) {
      const colInfo = schema.find((c) => c.column_name === col);
      const colIsNumeric = colInfo ? isNumeric(colInfo.column_type) : false;
      if (colIsNumeric || NON_NUMERIC_FUNCTIONS.has(aggFunction)) return true;
    }
    return false;
  })();

  const canRun = !!pivotColumn && valueFields.size > 0 && hasValidUsing && !!activeTable;
  const rowFieldList = useMemo(() => Array.from(rowFields), [rowFields]);
  const valueFieldList = useMemo(() => Array.from(valueFields), [valueFields]);
  const validValueFields = useMemo(
    () =>
      valueFieldList.filter((col) => {
        const colInfo = schema.find((c) => c.column_name === col);
        const colIsNumeric = colInfo ? isNumeric(colInfo.column_type) : false;
        return colIsNumeric || NON_NUMERIC_FUNCTIONS.has(aggFunction);
      }),
    [aggFunction, schema, valueFieldList]
  );
  const estimatedPivotColumns =
    pivotDistinctCount !== null
      ? rowFields.size + Math.max(1, validValueFields.length) * pivotDistinctCount
      : null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Pivot Table"
      icon="pivot-table"
      className="workbench-dialog pivot-workbench-dialog"
      style={{ width: 1100, maxWidth: "94vw" }}
      canOutsideClickClose={false}
    >
      <DialogBody className="workbench-dialog-body">
        <div className="workbench-layout pivot-workbench-layout">
          <div className="workbench-config">
          {/* Row Fields Section */}
          <div className="aggregate-section workbench-section">
            <div className="aggregate-section-header workbench-step-header">
              <span className="workbench-step-title">
                <span className="workbench-step-badge">1</span>
                Row Fields
                <span className="workbench-muted-label">(optional)</span>
              </span>
              <span className="workbench-section-count">{rowFields.size} selected</span>
            </div>
            <ColumnCheckList
              items={schema.map((c) => ({ name: c.column_name }))}
              selected={rowFields}
              onChange={handleRowFieldsChange}
              emptyMeans="all"
              emptyAllText="No row grouping — values are aggregated across all rows."
              maxHeight={246}
            />
          </div>

          {/* Aggregate Function Section */}
          <div className="aggregate-section workbench-section">
            <div className="aggregate-section-header workbench-step-header">
              <span className="workbench-step-title">
                <span className="workbench-step-badge">3</span>
                Aggregate Function
              </span>
            </div>
            <div
              className="pivot-agg-function-grid"
              role="radiogroup"
              aria-label="Aggregate function"
            >
              {AGG_FUNCTIONS.map((fn, index) => {
                const selected = fn === aggFunction;

                return (
                  <button
                    key={fn}
                    type="button"
                    className={`pivot-agg-function-option${selected ? " selected" : ""}`}
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => handleAggFunctionSelect(fn)}
                    onKeyDown={(event) => handleAggFunctionKeyDown(event, index)}
                    title={fn}
                  >
                    <span className="pivot-agg-function-check" aria-hidden="true">
                      {selected && <Icon icon="tick" iconSize={12} />}
                    </span>
                    <span className="pivot-agg-function-label">{fn}</span>
                  </button>
                );
              })}
            </div>
          </div>
          </div>

          <div className="workbench-config">
          {/* Pivot Column Section */}
          <div className="aggregate-section workbench-section">
            <div className="aggregate-section-header workbench-step-header">
              <span className="workbench-step-title">
                <span className="workbench-step-badge">2</span>
                Pivot Column
                <span className="workbench-required-label">required</span>
              </span>
            </div>
            <SoftSelect
              value={pivotColumn}
              onChange={(e) => {
                setPivotColumn(e.target.value);
                setResults(null);
              }}
              fill
            >
              <option value="">— Select a column —</option>
              {pivotColumnOptions.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </SoftSelect>

            {/* Distinct values preview */}
            {pivotColumn && (
              <div className="pivot-distinct-preview workbench-distinct-preview">
                {loadingDistinct ? (
                  <span className="pivot-distinct-loading">
                    Loading distinct values...
                  </span>
                ) : (
                  pivotDistinctCount !== null && (
                    <>
                      <span className="pivot-distinct-count">
                        {pivotDistinctCount} distinct value
                        {pivotDistinctCount !== 1 ? "s" : ""}
                      </span>
                      {pivotDistinctValues.length > 0 && (
                        <span className="pivot-distinct-sample">
                          {pivotDistinctValues.join(", ")}
                          {pivotDistinctCount! > 50 && ", ..."}
                        </span>
                      )}
                    </>
                  )
                )}
              </div>
            )}

            {/* Cardinality warnings */}
            {pivotDistinctCount !== null && pivotDistinctCount > 200 && (
              <Callout
                intent={Intent.DANGER}
                icon="warning-sign"
                style={{ marginTop: 8 }}
              >
                This column has {pivotDistinctCount} distinct values — the pivot
                will create {pivotDistinctCount}+ columns. This may be slow or
                produce an unwieldy result.
              </Callout>
            )}
            {pivotDistinctCount !== null &&
              pivotDistinctCount > 50 &&
              pivotDistinctCount <= 200 && (
                <Callout
                  intent={Intent.WARNING}
                  icon="warning-sign"
                  style={{ marginTop: 8 }}
                >
                  This column has {pivotDistinctCount} distinct values — the
                  pivot will create {pivotDistinctCount}+ columns.
                </Callout>
              )}
          </div>

          {/* Value Fields Section */}
          <div className="aggregate-section workbench-section">
            <div className="aggregate-section-header workbench-step-header">
              <span className="workbench-step-title">
                <span className="workbench-step-badge">4</span>
                Value Fields
                <span className="workbench-required-label">required</span>
              </span>
              <span className="workbench-section-count">{valueFields.size} selected</span>
            </div>
            <ColumnCheckList
              items={schema.map((c) => ({
                name: c.column_name,
                type: c.column_type,
              }))}
              selected={valueFields}
              onChange={handleValueFieldsChange}
              isNumeric={(t) => isNumeric(t ?? "")}
              numericHint=" (count/min/max/first only)"
              emptyMeans="invalid"
              maxHeight={246}
            />
          </div>

          <div className="workbench-preview-card pivot-summary-card">
            <div className="workbench-preview-title">Preview Summary</div>
            <div className="workbench-summary-lines">
              <div>
                <span>Rows after pivot</span>
                <strong>{rowFields.size > 0 ? "Grouped" : "1 row"}</strong>
              </div>
              <div>
                <span>Pivot columns</span>
                <strong>{pivotDistinctCount !== null ? pivotDistinctCount.toLocaleString() : "—"}</strong>
              </div>
              <div>
                <span>Value fields</span>
                <strong>{validValueFields.length}</strong>
              </div>
              <div>
                <span>Estimated output columns</span>
                <strong>{estimatedPivotColumns !== null ? estimatedPivotColumns.toLocaleString() : "—"}</strong>
              </div>
            </div>
            <div className="workbench-chip-row">
              {rowFieldList.slice(0, 3).map((field) => (
                <span key={field} className="workbench-chip">{field}</span>
              ))}
              {rowFieldList.length > 3 && (
                <span className="workbench-chip workbench-chip-muted">+{rowFieldList.length - 3} rows</span>
              )}
              {valueFieldList.slice(0, 3).map((field) => (
                <span key={field} className="workbench-chip workbench-chip-accent">{aggFunction}({field})</span>
              ))}
            </div>
          </div>
          </div>

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
            title="Pivot Results"
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
