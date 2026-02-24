import React, { useState } from "react";
import {
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
  | "custom_sql";

const OP_LABELS: Record<OpType, string> = {
  regex_extract: "Regex Extract",
  trim: "Trim Whitespace",
  upper: "To Uppercase",
  lower: "To Lowercase",
  replace_regex: "Regex Replace",
  substring: "Substring",
  custom_sql: "Custom SQL Expression",
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
  onCombine: () => void;
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
  onCombine,
  onHide,
  onToggleFilterPanel,
}: SidebarProps): React.ReactElement {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [opType, setOpType] = useState<OpType>("regex_extract");
  const [sourceCol, setSourceCol] = useState("");
  const [targetCol, setTargetCol] = useState("");
  const [param1, setParam1] = useState("");
  const [param2, setParam2] = useState("");

  // Drag-and-drop state
  const dragIndexRef = React.useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; position: "top" | "bottom" } | null>(null);

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

  const resetForm = () => {
    setSourceCol("");
    setTargetCol("");
    setParam1("");
    setParam2("");
    setOpType("regex_extract");
  };

  const handleApply = () => {
    if (!activeTable || !sourceCol) return;

    const target = targetCol || sourceCol;
    let expr = "";

    switch (opType) {
      case "regex_extract": {
        const pattern = param1 || '(.+)';
        const groupIdx = param2 || '1';
        expr = `regexp_extract(CAST("${sourceCol}" AS VARCHAR), '${pattern.replace(/'/g, "''")}', ${groupIdx})`;
        break;
      }
      case "trim":
        expr = `TRIM("${sourceCol}")`;
        break;
      case "upper":
        expr = `UPPER("${sourceCol}")`;
        break;
      case "lower":
        expr = `LOWER("${sourceCol}")`;
        break;
      case "replace_regex":
        expr = `regexp_replace("${sourceCol}", '${param1.replace(/'/g, "''")}', '${param2.replace(/'/g, "''")}')`;
        break;
      case "substring":
        expr = `SUBSTRING("${sourceCol}", ${param1 || "1"}, ${param2 || "10"})`;
        break;
      case "custom_sql":
        expr = param1;
        break;
    }

    let finalSql: string;
    if (target === sourceCol) {
      const otherCols = schema
        .filter((c) => c.column_name !== sourceCol)
        .map((c) => `"${c.column_name}"`)
        .join(", ");
      finalSql = `CREATE OR REPLACE TABLE "${activeTable}" AS SELECT ${otherCols}, ${expr} AS "${sourceCol}" FROM "${activeTable}"`;
    } else {
      finalSql = `CREATE OR REPLACE TABLE "${activeTable}" AS SELECT *, ${expr} AS "${target}" FROM "${activeTable}"`;
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

      {/* Combine button */}
      {tables.length >= 2 && (
        <div className="sidebar-section sidebar-actions-inline">
          <Button
            intent={Intent.PRIMARY}
            icon="merge-columns"
            text={`Combine ${tables.length} Tables`}
            onClick={onCombine}
            small
            fill
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

            <FormGroup
              label="Target Column Name"
              helperText="Leave blank to replace the source column"
            >
              <InputGroup
                value={targetCol}
                onChange={(e) => setTargetCol(e.target.value)}
                placeholder={sourceCol || "new_column"}
              />
            </FormGroup>

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
          </div>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button onClick={() => setDialogOpen(false)} text="Cancel" />
              <Button
                intent={Intent.PRIMARY}
                onClick={handleApply}
                text="Apply"
                disabled={!sourceCol}
              />
            </>
          }
        />
      </Dialog>
    </div>
  );
}
