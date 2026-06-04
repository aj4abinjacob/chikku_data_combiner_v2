import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import {
  Button,
  Checkbox,
  HTMLSelect,
  InputGroup,
  Intent,
  Alert,
  Icon,
  RadioGroup,
  Radio,
  Tag,
} from "@blueprintjs/core";
import { ColumnInfo, RowOpType, RowOpStep, UndoStrategy, FilterGroup, hasActiveFilters } from "../types";

const OP_OPTIONS: { value: RowOpType; label: string; description: string }[] = [
  { value: "delete_filtered", label: "Delete Filtered Rows", description: "Remove rows that match the current filter" },
  { value: "keep_filtered", label: "Keep Filtered Rows", description: "Remove rows that do NOT match the current filter" },
  { value: "remove_empty", label: "Remove Empty Rows", description: "Remove rows that are empty in selected columns" },
  { value: "remove_duplicates", label: "Remove Duplicates", description: "Drop duplicate rows by selected columns" },
];

const FILTER_REQUIRED_OPS = new Set<RowOpType>(["delete_filtered", "keep_filtered"]);
const COLUMN_SELECT_OPS = new Set<RowOpType>(["remove_empty", "remove_duplicates"]);

// ── Multi-column picker popover (modeled after filter IN picker) ──

interface ColumnMultiPickerProps {
  columns: ColumnInfo[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  placeholderAll: string;
}

function ColumnMultiPicker({ columns, selected, onChange, placeholderAll }: ColumnMultiPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({
        top: rect.top,
        left: rect.left,
        width: Math.max(rect.width, 280),
      });
    }
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };

  const filtered = columns
    .filter((c) => !search || c.column_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.column_name.localeCompare(b.column_name, undefined, { sensitivity: "base" }));

  const selectAll = () => {
    const next = new Set(selected);
    for (const c of filtered) next.add(c.column_name);
    onChange(next);
  };

  const clearAll = () => onChange(new Set());

  const label = selected.size === 0
    ? placeholderAll
    : selected.size === 1
      ? Array.from(selected)[0]
      : `${selected.size} columns`;

  const dropdown = open
    ? ReactDOM.createPortal(
        <div
          className="in-value-dropdown"
          ref={dropdownRef}
          style={{
            position: "fixed",
            bottom: window.innerHeight - pos.top + 4,
            left: pos.left,
            width: pos.width,
          }}
        >
          <div className="in-value-dropdown-header">
            <InputGroup
              placeholder="Search columns..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              small
              leftIcon="search"
              autoFocus
            />
            <div className="in-value-dropdown-actions">
              <Button small minimal text="All" onClick={selectAll} />
              <Button small minimal text="None" onClick={clearAll} />
              <span className="in-value-dropdown-count">
                {selected.size} / {columns.length}
              </span>
            </div>
          </div>
          <div className="in-value-dropdown-list">
            {filtered.length === 0 ? (
              <div className="in-value-dropdown-empty">No columns</div>
            ) : (
              filtered.map((c) => (
                <label key={c.column_name} className="in-value-dropdown-item">
                  <Checkbox
                    checked={selected.has(c.column_name)}
                    onChange={() => toggle(c.column_name)}
                    style={{ marginBottom: 0 }}
                  />
                  <span className="in-value-dropdown-label" title={c.column_name}>{c.column_name}</span>
                  <span className="rowops-picker-type">{c.column_type}</span>
                </label>
              ))
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="in-value-picker-wrapper rowops-col-picker" ref={anchorRef}>
      <Button
        className="filter-value-btn"
        small
        rightIcon={open ? "caret-up" : "caret-down"}
        text={label}
        onClick={() => setOpen((v) => !v)}
      />
      {dropdown}
    </div>
  );
}

interface RowOpsPanelProps {
  columns: ColumnInfo[];
  activeTable: string | null;
  activeFilters: FilterGroup;
  rowOpsSteps: RowOpStep[];
  undoStrategy: UndoStrategy;
  onApply: (opType: RowOpType, params: Record<string, string>) => Promise<void>;
  onUndo: () => Promise<void>;
  onRevertAll: () => Promise<void>;
  onClearAll: () => Promise<void>;
  totalRows: number;
  unfilteredRows: number | null;
  visible: boolean;
}

export function RowOpsPanel({
  columns,
  activeTable,
  activeFilters,
  rowOpsSteps,
  undoStrategy,
  onApply,
  onUndo,
  onRevertAll,
  onClearAll,
  totalRows,
  unfilteredRows,
  visible,
}: RowOpsPanelProps): React.ReactElement {
  const [opType, setOpType] = useState<RowOpType>("delete_filtered");
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [emptyMode, setEmptyMode] = useState<"all" | "any">("any");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasFilter = hasActiveFilters(activeFilters);
  const isFiltered = unfilteredRows !== null;
  const needsFilter = FILTER_REQUIRED_OPS.has(opType);
  const needsColumns = COLUMN_SELECT_OPS.has(opType);
  const isDisabled = needsFilter && !hasFilter;

  useEffect(() => {
    setSelectedColumns(new Set());
    setEmptyMode("any");
    setPreviewCount(null);
  }, [opType]);

  useEffect(() => {
    if (!activeTable || !visible) return;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);

    if (isDisabled) {
      setPreviewCount(null);
      return;
    }

    previewTimerRef.current = setTimeout(async () => {
      try {
        if (opType === "delete_filtered" && hasFilter) {
          setPreviewCount(totalRows);
        } else if (opType === "keep_filtered" && hasFilter) {
          const total = unfilteredRows ?? totalRows;
          setPreviewCount(total - totalRows);
        } else if (opType === "remove_empty") {
          const cols = selectedColumns.size > 0
            ? Array.from(selectedColumns)
            : columns.map((c) => c.column_name);
          const conditions = cols.map((colName) => {
            const col = columns.find((c) => c.column_name === colName);
            const ident = `"${colName.replace(/"/g, '""')}"`;
            const colType = col?.column_type?.toUpperCase() ?? "";
            const isVarchar = colType.startsWith("VARCHAR") || colType === "TEXT" || colType === "STRING";
            if (isVarchar) {
              return `(${ident} IS NULL OR TRIM(CAST(${ident} AS VARCHAR)) = '')`;
            }
            return `${ident} IS NULL`;
          });
          const joiner = emptyMode === "any" ? " OR " : " AND ";
          const escapedTable = `"${activeTable.replace(/"/g, '""')}"`;
          const sql = `SELECT COUNT(*) as cnt FROM ${escapedTable} WHERE ${conditions.join(joiner)}`;
          const rows = await window.api.query(sql);
          setPreviewCount(Number(rows[0]?.cnt ?? 0));
        } else if (opType === "remove_duplicates") {
          const cols = selectedColumns.size > 0
            ? Array.from(selectedColumns)
            : columns.map((c) => c.column_name);
          const partitionCols = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
          const escapedTable = `"${activeTable.replace(/"/g, '""')}"`;
          const sql = `SELECT COUNT(*) as cnt FROM (SELECT *, row_number() OVER (PARTITION BY ${partitionCols}) as __rn FROM ${escapedTable}) WHERE __rn > 1`;
          const rows = await window.api.query(sql);
          setPreviewCount(Number(rows[0]?.cnt ?? 0));
        } else {
          setPreviewCount(null);
        }
      } catch {
        setPreviewCount(null);
      }
    }, 400);

    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, [opType, activeTable, totalRows, unfilteredRows, hasFilter, selectedColumns, columns, visible, isDisabled, emptyMode]);

  const handleApply = async () => {
    setConfirmOpen(false);
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const params: Record<string, string> = {};
      if (needsColumns && selectedColumns.size > 0) {
        params.columns = JSON.stringify(Array.from(selectedColumns));
      }
      if (opType === "remove_empty") {
        params.emptyMode = emptyMode;
      }
      const appliedOp = OP_OPTIONS.find((o) => o.value === opType)?.label ?? opType;
      await onApply(opType, params);
      setOpType("delete_filtered");
      setSelectedColumns(new Set());
      setPreviewCount(null);
      setSuccessMsg(`${appliedOp} completed`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClearAll = async () => {
    setClearConfirmOpen(false);
    setLoading(true);
    try {
      await onClearAll();
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRevertAll = async () => {
    setRevertConfirmOpen(false);
    setLoading(true);
    setError(null);
    try {
      await onRevertAll();
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = async () => {
    setLoading(true);
    setError(null);
    try {
      await onUndo();
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!activeTable) {
    return (
      <div className="rowops-body" style={{ display: visible ? "flex" : "none" }}>
        <div className="rowops-empty">No table selected</div>
      </div>
    );
  }

  const opMeta = OP_OPTIONS.find((o) => o.value === opType)!;

  const previewLabel = (() => {
    if (previewCount === null) return null;
    if (previewCount === 0) return "No rows will be removed";
    return `${previewCount.toLocaleString()} row${previewCount !== 1 ? "s" : ""} will be removed`;
  })();

  const statusInfo = (() => {
    if (successMsg) return { tag: "Done", intent: Intent.SUCCESS, icon: "tick" as const, detail: successMsg };
    if (error) return { tag: "Error", intent: Intent.DANGER, icon: "error" as const, detail: error };
    if (loading) return { tag: "Working", intent: Intent.PRIMARY, icon: "refresh" as const, detail: "Applying..." };
    if (isDisabled) return { tag: "Needs filter", intent: Intent.WARNING, icon: "filter" as const, detail: opMeta.description };
    if (previewLabel) return { tag: "Ready", intent: Intent.WARNING, icon: "edit" as const, detail: previewLabel };
    return { tag: "Ready", intent: undefined, icon: "edit" as const, detail: opMeta.description };
  })();

  return (
    <div className="rowops-body" style={{ display: visible ? "flex" : "none" }}>
      {/* Toolbar — matches filter-toolbar */}
      <div className="rowops-toolbar">
        <div className="rowops-status-strip">
          <Tag minimal icon={statusInfo.icon} intent={statusInfo.intent}>
            {statusInfo.tag}
          </Tag>
          <span className="rowops-status-detail" title={statusInfo.detail}>{statusInfo.detail}</span>
          {isFiltered && (
            <Tag minimal icon="filter" intent={Intent.PRIMARY} className="rowops-scope-tag">
              {totalRows.toLocaleString()} of {unfilteredRows!.toLocaleString()} rows
            </Tag>
          )}
          {!isFiltered && (
            <Tag minimal icon="database" className="rowops-scope-tag rowops-scope-all">
              All {totalRows.toLocaleString()} rows
            </Tag>
          )}
        </div>
        <div className="rowops-toolbar-actions">
          <Button
            intent={Intent.WARNING}
            icon="tick"
            text="Apply"
            small
            onClick={() => setConfirmOpen(true)}
            loading={loading}
            disabled={isDisabled || loading}
          />
        </div>
      </div>

      {/* Content */}
      <div className="rowops-content">
        {isDisabled ? (
          <div className="rowops-empty-state">
            <div className="rowops-empty-icon" aria-hidden="true">
              <Icon icon="filter" iconSize={18} />
            </div>
            <div className="rowops-empty-main">
              <div className="rowops-empty-copy">
                <span className="rowops-empty-title">A filter is required first</span>
                <span className="rowops-empty-text">
                  {opMeta.label} works on filtered rows. Switch to the Filters tab and add a condition.
                </span>
              </div>
              <div className="rowops-empty-actions">
                <HTMLSelect
                  className="rowops-empty-op-select"
                  value={opType}
                  onChange={(e) => setOpType(e.target.value as RowOpType)}
                >
                  {OP_OPTIONS.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </HTMLSelect>
              </div>
            </div>
          </div>
        ) : (
          <div className="rowops-form-card">
            <div className="rowops-form-row">
              <div className="rowops-field">
                <label>Operation</label>
                <HTMLSelect
                  className="rowops-op-select"
                  value={opType}
                  onChange={(e) => setOpType(e.target.value as RowOpType)}
                  fill
                >
                  {OP_OPTIONS.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </HTMLSelect>
              </div>

              {opType === "remove_empty" && (
                <div className="rowops-field">
                  <label>Match</label>
                  <div className="rowops-mode-switch" role="group" aria-label="Empty match mode">
                    <button
                      type="button"
                      className={`rowops-mode-option${emptyMode === "any" ? " active" : ""}`}
                      aria-pressed={emptyMode === "any"}
                      onClick={() => setEmptyMode("any")}
                      title="Match if any selected column is empty"
                    >
                      Any
                    </button>
                    <button
                      type="button"
                      className={`rowops-mode-option${emptyMode === "all" ? " active" : ""}`}
                      aria-pressed={emptyMode === "all"}
                      onClick={() => setEmptyMode("all")}
                      title="Match only if all selected columns are empty"
                    >
                      All
                    </button>
                  </div>
                </div>
              )}

              {needsColumns && (
                <div className="rowops-field rowops-field-grow">
                  <label>
                    {opType === "remove_duplicates" ? "Dedup by" : "Check"}
                  </label>
                  <ColumnMultiPicker
                    columns={columns}
                    selected={selectedColumns}
                    onChange={setSelectedColumns}
                    placeholderAll="All columns"
                  />
                </div>
              )}
            </div>

            <div className="rowops-form-hint">
              <Icon icon="info-sign" iconSize={11} />
              <span>{opMeta.description}</span>
            </div>
          </div>
        )}
      </div>

      {/* Step history */}
      {rowOpsSteps.length > 0 && (
        <div className="rowops-steps">
          <div className="rowops-steps-header">
            <span className="rowops-steps-title">
              History
              <span className="rowops-steps-count">{rowOpsSteps.length}</span>
            </span>
            <div className="rowops-steps-actions">
              {undoStrategy === "snapshot" && (
                <Button
                  small
                  minimal
                  intent={Intent.WARNING}
                  icon="undo"
                  text="Revert All"
                  onClick={() => setRevertConfirmOpen(true)}
                  disabled={loading}
                />
              )}
              <Button
                small
                minimal
                icon="trash"
                onClick={() => setClearConfirmOpen(true)}
                disabled={loading}
                title="Clear history"
              />
            </div>
          </div>
          <div className="rowops-step-list">
            {[...rowOpsSteps].reverse().map((step, idx) => (
              <div key={step.id} className={`rowops-step-item ${idx === 0 ? "rowops-step-latest" : ""}`}>
                <span className="rowops-step-number">{step.id}</span>
                <span className="rowops-step-desc" title={step.description}>{step.description}</span>
                {undoStrategy === "per-step" && idx === 0 && (
                  <Button
                    small
                    minimal
                    icon="undo"
                    className="rowops-step-undo"
                    title="Undo this step"
                    onClick={handleUndo}
                    disabled={loading}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Apply confirmation */}
      <Alert
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleApply}
        intent={Intent.WARNING}
        icon="warning-sign"
        confirmButtonText="Apply"
        cancelButtonText="Cancel"
      >
        <p>
          {opType === "delete_filtered" && `Delete ${totalRows.toLocaleString()} filtered rows? This modifies the table data.`}
          {opType === "keep_filtered" && `Delete all rows NOT matching the current filter? This modifies the table data.`}
          {opType === "remove_empty" && `Remove rows where ${emptyMode === "any" ? "any" : "all"} of ${selectedColumns.size === 0 ? "all" : selectedColumns.size} column${selectedColumns.size !== 1 ? "s are" : " is"} empty? ${previewCount !== null ? `(${previewCount.toLocaleString()} rows)` : ""}`}
          {opType === "remove_duplicates" && `Remove duplicate rows based on ${selectedColumns.size === 0 ? "all" : selectedColumns.size} column${selectedColumns.size !== 1 ? "s" : ""}? ${previewCount !== null ? `(${previewCount.toLocaleString()} rows)` : ""}`}
        </p>
      </Alert>

      {/* Clear confirmation */}
      <Alert
        isOpen={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        onConfirm={handleClearAll}
        intent={Intent.DANGER}
        icon="trash"
        confirmButtonText="Clear All"
        cancelButtonText="Cancel"
      >
        <p>Clear all step history and drop backup tables? This cannot be undone.</p>
      </Alert>

      {/* Revert All confirmation */}
      <Alert
        isOpen={revertConfirmOpen}
        onClose={() => setRevertConfirmOpen(false)}
        onConfirm={handleRevertAll}
        intent={Intent.WARNING}
        icon="undo"
        confirmButtonText="Revert All"
        cancelButtonText="Cancel"
      >
        <p>Revert the table to its state before any row operations were applied?</p>
      </Alert>
    </div>
  );
}
