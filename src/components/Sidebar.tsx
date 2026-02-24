import React, { useState, useEffect } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Icon,
  Intent,
  HTMLSelect,
  InputGroup,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
} from "@blueprintjs/core";
import { LoadedTable, ColumnInfo } from "../types";

type OpType =
  | "regex_extract"
  | "trim"
  | "upper"
  | "lower"
  | "replace_regex"
  | "substring"
  | "custom_sql"
  | "create_column"
  | "delete_column"
  | "combine_columns";

const OP_LABELS: Record<OpType, string> = {
  regex_extract: "Regex Extract",
  trim: "Trim Whitespace",
  upper: "To Uppercase",
  lower: "To Lowercase",
  replace_regex: "Regex Replace",
  substring: "Substring",
  custom_sql: "Custom SQL Expression",
  create_column: "Create New Column",
  delete_column: "Delete Column",
  combine_columns: "Combine Columns",
};

interface SidebarProps {
  tables: LoadedTable[];
  activeTable: string | null;
  schema: ColumnInfo[];
  visibleColumns: string[];
  columnOrder: string[];
  filterPanelOpen: boolean;
  onSelectTable: (tableName: string) => void;
  onToggleColumn: (colName: string) => void;
  onReorderColumns: (newOrder: string[]) => void;
  onColumnOperation: (sql: string) => void;
  onDeleteTable: (tableName: string) => void;
  onCombine: (selectedNames: string[]) => void;
  onHide: () => void;
  onToggleFilterPanel: () => void;
}

export function Sidebar({
  tables,
  activeTable,
  schema,
  visibleColumns,
  columnOrder,
  filterPanelOpen,
  onSelectTable,
  onToggleColumn,
  onReorderColumns,
  onColumnOperation,
  onDeleteTable,
  onCombine,
  onHide,
  onToggleFilterPanel,
}: SidebarProps): React.ReactElement {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [selectedForCombine, setSelectedForCombine] = useState<Set<string>>(new Set());
  const [opType, setOpType] = useState<OpType>("regex_extract");
  const [sourceCol, setSourceCol] = useState("");
  const [targetCol, setTargetCol] = useState("");
  const [param1, setParam1] = useState("");
  const [param2, setParam2] = useState("");
  const [combineSourceCols, setCombineSourceCols] = useState<string[]>([]);
  const [combineSearch, setCombineSearch] = useState("");
  const [previews, setPreviews] = useState<Array<{ original: string; result: string }>>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Drag-and-drop state
  const dragIndexRef = React.useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; position: "top" | "bottom" } | null>(null);

  // Clean up stale selections when tables change
  useEffect(() => {
    const tableNames = new Set(tables.map((t) => t.tableName));
    setSelectedForCombine((prev) => {
      const cleaned = new Set([...prev].filter((n) => tableNames.has(n)));
      return cleaned.size === prev.size ? prev : cleaned;
    });
  }, [tables]);

  const toggleCombineSelection = (tableName: string) => {
    setSelectedForCombine((prev) => {
      const next = new Set(prev);
      if (next.has(tableName)) next.delete(tableName);
      else next.add(tableName);
      return next;
    });
  };

  // Build a lookup map from schema for column types
  const colTypeMap = React.useMemo(() => {
    const map = new Map<string, string>();
    schema.forEach((col) => map.set(col.column_name, col.column_type));
    return map;
  }, [schema]);

  // Use columnOrder if available, otherwise fall back to schema order
  const orderedColumns = columnOrder.length > 0
    ? columnOrder.map((name) => schema.find((c) => c.column_name === name)).filter(Boolean) as ColumnInfo[]
    : schema;

  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = "move";
    // Make the drag image slightly transparent
    const target = e.currentTarget as HTMLElement;
    target.classList.add("dragging");
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragIndexRef.current === null || dragIndexRef.current === index) {
      setDropTarget(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? "top" : "bottom";
    setDropTarget({ index, position });
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const fromIndex = dragIndexRef.current;
    if (fromIndex === null || !dropTarget) return;

    const newOrder = [...orderedColumns.map((c) => c.column_name)];
    const [moved] = newOrder.splice(fromIndex, 1);
    let toIndex = dropTarget.index;
    // Adjust index after removal
    if (fromIndex < toIndex) toIndex--;
    if (dropTarget.position === "bottom") toIndex++;
    newOrder.splice(toIndex, 0, moved);

    onReorderColumns(newOrder);
    dragIndexRef.current = null;
    setDropTarget(null);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove("dragging");
    dragIndexRef.current = null;
    setDropTarget(null);
  };

  const buildExpression = (op: OpType, col: string, p1: string, p2: string): string | null => {
    // For string-based ops, cast to VARCHAR if the column isn't already a string type
    const colType = colTypeMap.get(col) || "";
    const isString = /^(VARCHAR|TEXT|STRING|CHAR)/i.test(colType);
    const ref = isString ? `"${col}"` : `CAST("${col}" AS VARCHAR)`;

    switch (op) {
      case "regex_extract": {
        const pattern = p1 || "(.+)";
        const groupIdx = p2 || "1";
        return `regexp_extract(${ref}, '${pattern.replace(/'/g, "''")}', ${groupIdx})`;
      }
      case "trim":
        return `TRIM(${ref})`;
      case "upper":
        return `UPPER(${ref})`;
      case "lower":
        return `LOWER(${ref})`;
      case "replace_regex":
        return `regexp_replace(${ref}, '${p1.replace(/'/g, "''")}', '${p2.replace(/'/g, "''")}')`;
      case "substring":
        return `SUBSTRING(${ref}, ${p1 || "1"}, ${p2 || "10"})`;
      case "custom_sql":
        return p1 || null;
      case "create_column":
        return p1 || null;
      case "delete_column":
        return null;
      case "combine_columns":
        return null; // handled separately in handleApply
      default:
        return null;
    }
  };

  // Live preview: fetch 3 distinct non-null samples and show before/after
  useEffect(() => {
    if (!activeTable) {
      setPreviews([]);
      setPreviewError(null);
      return;
    }

    // delete_column and create_column: no preview needed
    if (opType === "delete_column" || opType === "create_column") {
      setPreviews([]);
      setPreviewError(null);
      return;
    }

    // combine_columns: preview the concatenation result
    if (opType === "combine_columns") {
      if (combineSourceCols.length < 2) {
        setPreviews([]);
        setPreviewError(null);
        return;
      }
      const concatExpr = buildCombineExpression(combineSourceCols, param1);
      const timer = setTimeout(async () => {
        try {
          const sql = `SELECT CAST(${concatExpr} AS VARCHAR) AS "result" FROM "${activeTable}" LIMIT 3`;
          const rows = await window.api.query(sql);
          setPreviews(rows.map((r: any) => ({ original: "", result: String(r.result ?? "") })));
          setPreviewError(null);
        } catch (e: any) {
          setPreviews([]);
          setPreviewError(e.message || "Preview failed");
        }
      }, 300);
      return () => clearTimeout(timer);
    }

    // All other operations require a source column
    if (!sourceCol) {
      setPreviews([]);
      setPreviewError(null);
      return;
    }
    const expr = buildExpression(opType, sourceCol, param1, param2);
    if (!expr) {
      setPreviews([]);
      setPreviewError(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const sql = `SELECT DISTINCT CAST("${sourceCol}" AS VARCHAR) AS "original", CAST(${expr} AS VARCHAR) AS "result" FROM "${activeTable}" WHERE "${sourceCol}" IS NOT NULL LIMIT 3`;
        const rows = await window.api.query(sql);
        setPreviews(rows.map((r: any) => ({ original: String(r.original ?? ""), result: String(r.result ?? "") })));
        setPreviewError(null);
      } catch (e: any) {
        setPreviews([]);
        setPreviewError(e.message || "Preview failed");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [activeTable, sourceCol, opType, param1, param2, combineSourceCols]);

  const resetForm = () => {
    setSourceCol("");
    setTargetCol("");
    setParam1("");
    setParam2("");
    setCombineSourceCols([]);
    setCombineSearch("");
    setOpType("regex_extract");
    setPreviews([]);
    setPreviewError(null);
  };

  const buildCombineExpression = (cols: string[], separator: string): string => {
    const parts = cols.map((col) => {
      const colType = colTypeMap.get(col) || "";
      const isString = /^(VARCHAR|TEXT|STRING|CHAR)/i.test(colType);
      return isString ? `"${col}"` : `CAST("${col}" AS VARCHAR)`;
    });
    if (separator) {
      return parts.join(` || '${separator.replace(/'/g, "''")}' || `);
    }
    return parts.join(" || ");
  };

  const handleApply = () => {
    if (!activeTable) return;

    let finalSql: string;

    if (opType === "delete_column") {
      if (!sourceCol || schema.length <= 1) return;
      const otherCols = schema
        .filter((c) => c.column_name !== sourceCol)
        .map((c) => `"${c.column_name}"`)
        .join(", ");
      finalSql = `CREATE OR REPLACE TABLE "${activeTable}" AS SELECT ${otherCols} FROM "${activeTable}"`;
    } else if (opType === "create_column") {
      if (!targetCol) return;
      const valueExpr = param1 || "NULL";
      finalSql = `CREATE OR REPLACE TABLE "${activeTable}" AS SELECT *, ${valueExpr} AS "${targetCol}" FROM "${activeTable}"`;
    } else if (opType === "combine_columns") {
      if (combineSourceCols.length < 2 || !targetCol) return;
      const concatExpr = buildCombineExpression(combineSourceCols, param1);
      finalSql = `CREATE OR REPLACE TABLE "${activeTable}" AS SELECT *, ${concatExpr} AS "${targetCol}" FROM "${activeTable}"`;
    } else {
      if (!sourceCol) return;
      const target = targetCol || sourceCol;
      const expr = buildExpression(opType, sourceCol, param1, param2);
      if (!expr) return;

      if (target === sourceCol) {
        const otherCols = schema
          .filter((c) => c.column_name !== sourceCol)
          .map((c) => `"${c.column_name}"`)
          .join(", ");
        finalSql = `CREATE OR REPLACE TABLE "${activeTable}" AS SELECT ${otherCols}, ${expr} AS "${sourceCol}" FROM "${activeTable}"`;
      } else {
        finalSql = `CREATE OR REPLACE TABLE "${activeTable}" AS SELECT *, ${expr} AS "${target}" FROM "${activeTable}"`;
      }
    }

    onColumnOperation(finalSql);
    setDialogOpen(false);
    resetForm();
  };

  return (
    <div className="sidebar">
      {/* Loaded tables */}
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <h4>Tables</h4>
          <Button
            icon="chevron-left"
            minimal
            small
            onClick={onHide}
            title="Hide sidebar"
          />
        </div>
        {tables.length === 0 && (
          <div style={{ fontSize: 12, color: "#5c7080" }}>No tables loaded</div>
        )}
        {tables.map((t) => (
          <div
            key={t.tableName}
            className={`table-list-item${t.tableName === activeTable ? " active" : ""}`}
            style={{ cursor: "pointer" }}
          >
            {tables.length >= 2 && (
              <Checkbox
                checked={selectedForCombine.has(t.tableName)}
                onChange={() => toggleCombineSelection(t.tableName)}
                className="table-combine-checkbox"
                style={{ marginBottom: 0, marginRight: 4 }}
              />
            )}
            <span
              className="table-name"
              onClick={() => onSelectTable(t.tableName)}
            >
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
            <Button
              icon="cross"
              minimal
              small
              className="table-delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(t.tableName);
              }}
            />
          </div>
        ))}
      </div>

      {/* Combine button */}
      {tables.length >= 2 && (
        <div className="sidebar-section sidebar-actions-inline">
          <Button
            intent={Intent.PRIMARY}
            icon="merge-columns"
            text={`Combine ${selectedForCombine.size} Selected`}
            onClick={() => onCombine([...selectedForCombine])}
            small
            fill
            disabled={selectedForCombine.size < 2}
          />
        </div>
      )}

      {/* Column visibility */}
      {schema.length > 0 && (
        <div className="sidebar-section">
          <h4>Columns</h4>
          {orderedColumns.map((col, index) => (
            <div
              key={col.column_name}
              className={`column-item${
                dropTarget?.index === index
                  ? ` drag-over-${dropTarget.position}`
                  : ""
              }`}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            >
              <Icon
                icon="drag-handle-vertical"
                size={12}
                className="drag-handle"
              />
              <Checkbox
                checked={visibleColumns.includes(col.column_name)}
                onChange={() => onToggleColumn(col.column_name)}
                style={{ marginBottom: 0 }}
              />
              <span>{col.column_name}</span>
              <span className="column-type">{colTypeMap.get(col.column_name)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Column operation + filter buttons */}
      {activeTable && schema.length > 0 && (
        <div className="sidebar-section sidebar-actions">
          <Button
            icon="filter"
            text="Filters"
            onClick={onToggleFilterPanel}
            active={filterPanelOpen}
            small
            fill
          />
          <Button
            icon="column-layout"
            text="Column Operation"
            onClick={() => setDialogOpen(true)}
            small
            fill
          />
        </div>
      )}

      <Alert
        isOpen={deleteTarget !== null}
        onConfirm={() => {
          if (deleteTarget) onDeleteTable(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
        cancelButtonText="Cancel"
        confirmButtonText="Remove"
        intent={Intent.DANGER}
        icon="trash"
      >
        <p>Remove table <strong>{deleteTarget}</strong>? This will drop it from the current session.</p>
      </Alert>

      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Column Operation"
      >
        <DialogBody>
          <div className="column-op-form">
            <FormGroup label="Operation">
              <HTMLSelect
                value={opType}
                onChange={(e) => setOpType(e.target.value as OpType)}
                fill
              >
                {Object.entries(OP_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </HTMLSelect>
            </FormGroup>

            {/* Source Column — shown for all ops except create_column and combine_columns */}
            {opType !== "create_column" && opType !== "combine_columns" && (
              <FormGroup label="Source Column">
                <HTMLSelect
                  value={sourceCol}
                  onChange={(e) => setSourceCol(e.target.value)}
                  fill
                >
                  <option value="">Select column...</option>
                  {schema.map((col) => (
                    <option key={col.column_name} value={col.column_name}>
                      {col.column_name} ({col.column_type})
                    </option>
                  ))}
                </HTMLSelect>
              </FormGroup>
            )}

            {/* Target Column — shown for all ops except delete_column */}
            {opType !== "delete_column" && (
              <FormGroup
                label={opType === "create_column" || opType === "combine_columns" ? "New Column Name" : "Target Column Name"}
                helperText={opType === "create_column" || opType === "combine_columns" ? undefined : "Leave blank to replace the source column"}
              >
                <InputGroup
                  value={targetCol}
                  onChange={(e) => setTargetCol(e.target.value)}
                  placeholder={opType === "create_column" || opType === "combine_columns" ? "new_column" : (sourceCol || "new_column")}
                />
              </FormGroup>
            )}

            {/* delete_column: warning */}
            {opType === "delete_column" && sourceCol && (
              <div className="bp4-callout bp4-intent-warning" style={{ marginBottom: 10 }}>
                <p style={{ margin: 0 }}>
                  This will permanently remove the column <strong>{sourceCol}</strong> from the table.
                  {schema.length <= 1 && " Cannot delete the only column."}
                </p>
              </div>
            )}

            {/* create_column: value input */}
            {opType === "create_column" && (
              <FormGroup
                label="Value"
                helperText={`Leave empty for NULL. Or enter a value (e.g. 0, 'unknown') or SQL expression (e.g. "price" * 1.1)`}
              >
                <InputGroup
                  value={param1}
                  onChange={(e) => setParam1(e.target.value)}
                  placeholder="0"
                />
              </FormGroup>
            )}

            {/* combine_columns: multi-column selector */}
            {opType === "combine_columns" && (
              <>
                <FormGroup label="Columns to Combine" helperText="Select 2 or more columns. They will be concatenated in the order selected.">
                  <div className="combine-col-list">
                    <div className="combine-col-search">
                      <InputGroup
                        leftIcon="search"
                        placeholder="Search columns..."
                        value={combineSearch}
                        onChange={(e) => setCombineSearch(e.target.value)}
                        small
                      />
                    </div>
                    <div className="combine-col-items">
                      {schema
                        .filter((col) => col.column_name.toLowerCase().includes(combineSearch.toLowerCase()))
                        .map((col) => {
                          const isSelected = combineSourceCols.includes(col.column_name);
                          const orderIndex = combineSourceCols.indexOf(col.column_name);
                          return (
                            <div key={col.column_name} className={`combine-col-item${isSelected ? " selected" : ""}`}>
                              <Checkbox
                                checked={isSelected}
                                onChange={() => {
                                  if (isSelected) {
                                    setCombineSourceCols((prev) => prev.filter((c) => c !== col.column_name));
                                  } else {
                                    setCombineSourceCols((prev) => [...prev, col.column_name]);
                                  }
                                }}
                                style={{ marginBottom: 0 }}
                              />
                              <span className="combine-col-name">{col.column_name}</span>
                              <span className="column-type">{col.column_type}</span>
                              <span className={`combine-order-badge${isSelected ? " visible" : ""}`}>
                                {isSelected ? orderIndex + 1 : ""}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </FormGroup>
                <FormGroup label="Separator" helperText="String to insert between column values (can be empty)">
                  <InputGroup
                    value={param1}
                    onChange={(e) => setParam1(e.target.value)}
                    placeholder=" "
                  />
                </FormGroup>
              </>
            )}

            {opType === "regex_extract" && (
              <>
                <FormGroup label="Pattern (regex)" helperText="Use a capture group, e.g. ([0-9]+)">
                  <InputGroup
                    value={param1}
                    onChange={(e) => setParam1(e.target.value)}
                    placeholder="([0-9]+\.?[0-9]*)"
                  />
                </FormGroup>
                <FormGroup label="Capture Group Index" helperText="Which group to extract (default: 1)">
                  <InputGroup
                    value={param2}
                    onChange={(e) => setParam2(e.target.value)}
                    placeholder="1"
                  />
                </FormGroup>
              </>
            )}

            {opType === "replace_regex" && (
              <>
                <FormGroup label="Pattern (regex)">
                  <InputGroup
                    value={param1}
                    onChange={(e) => setParam1(e.target.value)}
                    placeholder="[^0-9]"
                  />
                </FormGroup>
                <FormGroup label="Replacement">
                  <InputGroup
                    value={param2}
                    onChange={(e) => setParam2(e.target.value)}
                    placeholder=""
                  />
                </FormGroup>
              </>
            )}

            {opType === "substring" && (
              <>
                <FormGroup label="Start Position">
                  <InputGroup
                    value={param1}
                    onChange={(e) => setParam1(e.target.value)}
                    placeholder="1"
                  />
                </FormGroup>
                <FormGroup label="Length">
                  <InputGroup
                    value={param2}
                    onChange={(e) => setParam2(e.target.value)}
                    placeholder="10"
                  />
                </FormGroup>
              </>
            )}

            {opType === "custom_sql" && (
              <FormGroup
                label="SQL Expression"
                helperText='Use column names in double quotes, e.g. "price" * 1.1'
              >
                <InputGroup
                  value={param1}
                  onChange={(e) => setParam1(e.target.value)}
                  placeholder='"price" * 1.1'
                />
              </FormGroup>
            )}

            {/* Preview — shown for operations that produce a result */}
            {opType !== "delete_column" && opType !== "create_column" && (previews.length > 0 || previewError) && (
              <div className="op-preview">
                <div className="op-preview-header">Preview</div>
                {previewError ? (
                  <div className="op-preview-error">{previewError}</div>
                ) : (
                  <table className="op-preview-table">
                    <thead>
                      <tr>
                        {opType !== "combine_columns" && <th>Original</th>}
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previews.map((p, i) => (
                        <tr key={i}>
                          {opType !== "combine_columns" && <td>{p.original}</td>}
                          <td>{p.result}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button onClick={() => setDialogOpen(false)} text="Cancel" />
              <Button
                intent={opType === "delete_column" ? Intent.DANGER : Intent.PRIMARY}
                onClick={handleApply}
                text={opType === "delete_column" ? "Delete" : "Apply"}
                disabled={
                  opType === "delete_column"
                    ? !sourceCol || schema.length <= 1
                    : opType === "create_column"
                    ? !targetCol
                    : opType === "combine_columns"
                    ? combineSourceCols.length < 2 || !targetCol
                    : !sourceCol
                }
              />
            </>
          }
        />
      </Dialog>
    </div>
  );
}
