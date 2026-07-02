import React, { useState, useEffect, useMemo } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Icon,
  Intent,
} from "@blueprintjs/core";
import { Tooltip2 } from "@blueprintjs/popover2";
import { LoadedTable, ColumnInfo, SortColumn, PivotViewConfig } from "../types";
import { DataOperationsDialog } from "./DataOperationsDialog";
import { AggregateDialog } from "./AggregateDialog";
import { PivotDialog } from "./PivotDialog";
import { LookupMergeDialog } from "./LookupMergeDialog";
import { DateConversionDialog } from "./DateConversionDialog";
import { SearchInput } from "./SearchInput";

interface SidebarProps {
  tables: LoadedTable[];
  activeTable: string | null;
  schema: ColumnInfo[];
  visibleColumns: string[];
  columnOrder: string[];
  sortColumns: SortColumn[];
  onSelectTable: (tableName: string) => void;
  onToggleColumn: (colName: string) => void;
  onSetVisibleColumns: (cols: string[]) => void;
  onReorderColumns: (newOrder: string[]) => void;
  onSort: (column: string, addLevel: boolean) => void;
  onClearSort: () => void;
  pivotConfig: PivotViewConfig | null;
  onPivotGroup: (column: string, addLevel: boolean) => void;
  onClearPivotGroups: () => void;
  onDataOperation: (sql: string, description?: string) => void;
  onSampleTable: (n: number, isPercent: boolean) => void;
  onDeleteTable: (tableName: string) => void;
  onCombine: (selectedNames: string[]) => void;
  onCreateAggregateTable: (sql: string) => void;
  onCreatePivotTable: (sql: string) => void;
  onLookupMerge: (sql: string, options: { replaceActive: boolean }) => void;
  onCompareTables?: () => void;
  onExport: () => void;
  onOpenHistory: () => void;
  onOpenFiles: () => void;
  onHide: () => void;
  jsonWorkspaceActive?: boolean;
}

type FileListIcon = {
  icon: "array" | "panel-table" | "th-derived";
  className: string;
};

function getFileExtension(filePath: string): string {
  return filePath.split(".").pop()?.toLowerCase() || "";
}

function getFileListIcon(table: LoadedTable): FileListIcon {
  if (table.filePath.startsWith("(")) {
    return { icon: "th-derived", className: "table-icon-generated" };
  }

  const extension = getFileExtension(table.filePath);
  if (extension === "json" || extension === "jsonl" || extension === "ndjson") {
    return { icon: "array", className: "table-icon-json" };
  }

  return { icon: "panel-table", className: "table-icon-tabular" };
}

export function Sidebar({
  tables,
  activeTable,
  schema,
  visibleColumns,
  columnOrder,
  sortColumns,
  onSelectTable,
  onToggleColumn,
  onSetVisibleColumns,
  onReorderColumns,
  onSort,
  onClearSort,
  pivotConfig,
  onPivotGroup,
  onClearPivotGroups,
  onDataOperation,
  onSampleTable,
  onDeleteTable,
  onCombine,
  onCreateAggregateTable,
  onCreatePivotTable,
  onLookupMerge,
  onCompareTables,
  onExport,
  onOpenHistory,
  onOpenFiles,
  onHide,
  jsonWorkspaceActive = false,
}: SidebarProps): React.ReactElement {
  const [dataOpDialogOpen, setDataOpDialogOpen] = useState(false);
  const [aggregateDialogOpen, setAggregateDialogOpen] = useState(false);
  const [pivotDialogOpen, setPivotDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [dateConvDialogOpen, setDateConvDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [selectedForCombine, setSelectedForCombine] = useState<Set<string>>(new Set());
  const [columnSearch, setColumnSearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");

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

  // Clear search when active table changes
  useEffect(() => {
    setColumnSearch("");
  }, [activeTable]);

  // Filter tables by search
  const filteredTables = useMemo(() => {
    if (!tableSearch.trim()) return tables;
    const q = tableSearch.toLowerCase();
    return tables.filter((t) => t.tableName.toLowerCase().includes(q));
  }, [tables, tableSearch]);

  const toggleCombineSelection = (tableName: string) => {
    setSelectedForCombine((prev) => {
      const next = new Set(prev);
      if (next.has(tableName)) next.delete(tableName);
      else next.add(tableName);
      return next;
    });
  };

  const selectAllTablesForCombine = () => {
    setSelectedForCombine(new Set(tables.map((t) => t.tableName)));
  };

  const deselectAllTablesForCombine = () => {
    setSelectedForCombine(new Set());
  };

  // Use columnOrder if available, otherwise fall back to schema order
  const orderedColumns = columnOrder.length > 0
    ? columnOrder.map((name) => schema.find((c) => c.column_name === name)).filter(Boolean) as ColumnInfo[]
    : schema;

  // Filter columns by search
  const filteredColumns = useMemo(() => {
    if (!columnSearch.trim()) return orderedColumns;
    const q = columnSearch.toLowerCase();
    return orderedColumns.filter((col) => col.column_name.toLowerCase().includes(q));
  }, [orderedColumns, columnSearch]);

  // Build a sort index map for quick lookup
  const sortIndexMap = useMemo(() => {
    const map = new Map<string, { index: number; direction: "ASC" | "DESC" }>();
    sortColumns.forEach((sc, i) => map.set(sc.column, { index: i + 1, direction: sc.direction }));
    return map;
  }, [sortColumns]);

  // Build a pivot group index map
  const pivotGroupIndexMap = useMemo(() => {
    const map = new Map<string, { index: number; direction: "ASC" | "DESC" }>();
    const groups = pivotConfig?.groupColumns ?? [];
    groups.forEach((gc, i) => map.set(gc.column, { index: i + 1, direction: gc.direction }));
    return map;
  }, [pivotConfig]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = "move";
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

  const allColumnNames = orderedColumns.map((c) => c.column_name);
  const allVisible = visibleColumns.length === allColumnNames.length;
  const noneVisible = visibleColumns.length === 0;
  const visibleColumnCount = visibleColumns.length;
  const compareDisabled = tables.length < 2;

  return (
    <div className="sidebar">
      {/* Loaded files */}
      <div className="sidebar-section sidebar-section-tables">
        <div className="sidebar-section-header">
          <div className="sidebar-heading-block">
            <h4>Files</h4>
            <span className="sidebar-count">{tables.length}</span>
          </div>
          <div className="table-header-actions">
            <Button
              icon="chevron-left"
              minimal
              small
              onClick={onHide}
              title="Hide sidebar"
              className="sidebar-hide-btn"
            />
          </div>
        </div>
        {tables.length > 8 && (
          <div className="table-search">
            <SearchInput
              placeholder="Search files..."
              value={tableSearch}
              onChange={setTableSearch}
              small
            />
          </div>
        )}
        {tables.length === 0 && (
          <div className="sidebar-empty sidebar-empty-action">
            <span>No files loaded</span>
            <Button
              icon="folder-open"
              text="Open files"
              small
              onClick={onOpenFiles}
            />
          </div>
        )}
        {tables.length > 0 && filteredTables.length === 0 && (
          <div className="sidebar-empty">No matching files</div>
        )}
        {filteredTables.map((t) => {
          const fileIcon = getFileListIcon(t);

          return (
            <div
              key={t.tableName}
              className={`table-list-item${t.tableName === activeTable ? " active" : ""}${selectedForCombine.has(t.tableName) ? " selected" : ""}`}
            >
              {tables.length >= 2 && (
                <Checkbox
                  checked={selectedForCombine.has(t.tableName)}
                  onChange={() => toggleCombineSelection(t.tableName)}
                  className="table-combine-checkbox"
                />
              )}
              <span
                className="table-main"
                onClick={() => onSelectTable(t.tableName)}
                title={t.tableName}
              >
                <span className={`table-icon ${fileIcon.className}`}>
                  <Icon icon={fileIcon.icon} size={12} />
                </span>
                <span className="table-text">
                  <span className="table-name">{t.tableName}</span>
                  <span className="row-count">
                    {t.rowCount.toLocaleString()} rows
                  </span>
                </span>
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
          );
        })}
      </div>

      {/* Combine button */}
      {tables.length >= 2 && (
        <div className="sidebar-section sidebar-combine-bar">
          <div className="combine-meta">
            <span className="combine-title">Combine</span>
            <span className="combine-count">{selectedForCombine.size} selected</span>
          </div>
          <div className="combine-select-actions">
            <Button
              minimal
              small
              text="All"
              title="Select all files for combine"
              disabled={selectedForCombine.size === tables.length}
              onClick={selectAllTablesForCombine}
            />
            <Button
              minimal
              small
              text="None"
              title="Deselect all files"
              disabled={selectedForCombine.size === 0}
              onClick={deselectAllTablesForCombine}
            />
          </div>
          <Button
            intent={Intent.PRIMARY}
            icon="merge-columns"
            text="Combine"
            onClick={() => onCombine([...selectedForCombine])}
            small
            disabled={selectedForCombine.size < 2}
          />
        </div>
      )}

      {/* Column visibility */}
      {!jsonWorkspaceActive && schema.length > 0 && (
        <div className="sidebar-section sidebar-section-columns">
          <div className="column-header-row">
            <div className="sidebar-heading-block">
              <h4>Columns</h4>
              <span className="sidebar-count">{visibleColumnCount}/{allColumnNames.length}</span>
            </div>
            <div className="column-header-actions">
              <Button
                minimal
                small
                text="All"
                title="Show all columns"
                disabled={allVisible}
                onClick={() => onSetVisibleColumns(allColumnNames)}
                className="column-visibility-btn"
              />
              <Button
                minimal
                small
                text="None"
                title="Hide all columns"
                disabled={noneVisible}
                onClick={() => onSetVisibleColumns([])}
                className="column-visibility-btn"
              />
              {pivotConfig && pivotConfig.groupColumns.length > 0 && (
                <Button
                  minimal
                  small
                  icon="layers"
                  title="Clear all group levels"
                  onClick={onClearPivotGroups}
                  className="column-clear-pivot-btn"
                />
              )}
              {sortColumns.length > 0 && (
                <Button
                  minimal
                  small
                  icon="sort"
                  title="Clear all sorts"
                  onClick={onClearSort}
                  className="column-clear-sort-btn"
                />
              )}
            </div>
          </div>
          {orderedColumns.length > 8 && (
            <div className="column-search">
              <SearchInput
                placeholder="Search columns..."
                value={columnSearch}
                onChange={setColumnSearch}
                small
              />
            </div>
          )}
          {filteredColumns.map((col, index) => {
            const sortInfo = sortIndexMap.get(col.column_name);
            const pivotInfo = pivotGroupIndexMap.get(col.column_name);
            const isVisible = visibleColumns.includes(col.column_name);
            return (
              <div
                key={col.column_name}
                className={`column-item${isVisible ? "" : " column-hidden"}${
                  dropTarget?.index === index
                    ? ` drag-over-${dropTarget.position}`
                    : ""
                }`}
                title={`${col.column_name} (${col.column_type})`}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
              >
                <Icon
                  icon="drag-handle-vertical"
                  size={10}
                  className="drag-handle"
                />
                <Checkbox
                  checked={isVisible}
                  onChange={() => onToggleColumn(col.column_name)}
                  className="column-visibility-checkbox"
                />
                <span className="column-meta">
                  <span className="column-name-text">{col.column_name}</span>
                  <span className="column-type">{col.column_type}</span>
                </span>
                <span className="column-tools">
                  {/* Group control (left, green) */}
                  <span
                    className={`column-pivot-indicator${pivotInfo ? " active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPivotGroup(col.column_name, e.shiftKey);
                    }}
                    title={
                      pivotInfo
                        ? `Group ${pivotInfo.index}: ${pivotInfo.direction}${pivotConfig?.groupSortMode ? ` (sorted by ${pivotConfig.groupSortMode === "count" ? "count" : "name"} ${pivotConfig.groupSortDirection})` : ""} (click to toggle, shift+click for multi-group)`
                        : "Click to group (shift+click for multi-group)"
                    }
                  >
                    {pivotInfo ? (
                      <>
                        <span className="column-pivot-number">{pivotInfo.index}</span>
                        <Icon icon={pivotInfo.direction === "ASC" ? "chevron-up" : "chevron-down"} size={10} />
                        {pivotConfig?.groupSortMode && (
                          <Icon
                            icon={pivotConfig.groupSortMode === "count" ? "sort-numerical" : "sort-alphabetical"}
                            size={9}
                            className="column-pivot-sort-mode"
                          />
                        )}
                      </>
                    ) : (
                      <Icon icon="layers" size={10} className="column-pivot-idle" />
                    )}
                  </span>
                  {/* Sort control (right, blue) */}
                  <span
                    className={`column-sort-indicator${sortInfo ? " active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSort(col.column_name, e.shiftKey);
                    }}
                    title={
                      sortInfo
                        ? `Sort ${sortInfo.index}: ${sortInfo.direction} (click to toggle, shift+click for multi-sort)`
                        : "Click to sort (shift+click for multi-sort)"
                    }
                  >
                    {sortInfo ? (
                      <>
                        <span className="column-sort-number">{sortInfo.index}</span>
                        <Icon icon={sortInfo.direction === "ASC" ? "chevron-up" : "chevron-down"} size={10} />
                      </>
                    ) : (
                      <Icon icon="double-caret-vertical" size={10} className="column-sort-idle" />
                    )}
                  </span>
                </span>
              </div>
            );
          })}
          {orderedColumns.length > 0 && filteredColumns.length === 0 && (
            <div className="sidebar-empty">No matching columns</div>
          )}
        </div>
      )}

      {/* Data operation + filter buttons */}
      {!jsonWorkspaceActive && activeTable && schema.length > 0 && (
        <div className="sidebar-section sidebar-actions">
          <Button
            icon="grouped-bar-chart"
            text="Aggregate"
            onClick={() => setAggregateDialogOpen(true)}
            small
          />
          <Button
            icon="pivot-table"
            text="Pivot"
            title="Pivot Table"
            onClick={() => setPivotDialogOpen(true)}
            small
          />
          {tables.length >= 2 && (
            <Button
              icon="data-lineage"
              text="Lookup"
              title="Lookup Merge"
              onClick={() => setMergeDialogOpen(true)}
              small
            />
          )}
          {onCompareTables && (
            <Tooltip2
              content="Open another table to enable comparison."
              disabled={!compareDisabled}
              placement="top"
              minimal
            >
              <span className="sidebar-action-tooltip">
                <Button
                  icon="data-lineage"
                  text="Compare"
                  title={compareDisabled ? undefined : "Compare current table with another table"}
                  onClick={onCompareTables}
                  small
                  fill
                  disabled={compareDisabled}
                />
              </span>
            </Tooltip2>
          )}
          <Button
            icon="column-layout"
            text="Data Ops"
            title="Data Operations"
            onClick={() => setDataOpDialogOpen(true)}
            small
          />
          <Button
            icon="calendar"
            text="Dates"
            title="Date Conversion"
            onClick={() => setDateConvDialogOpen(true)}
            small
          />
          <Button
            icon="history"
            text="History"
            onClick={onOpenHistory}
            small
          />
          <Button
            icon="export"
            text="Export"
            onClick={onExport}
            small
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

      <DataOperationsDialog
        isOpen={dataOpDialogOpen}
        onClose={() => setDataOpDialogOpen(false)}
        activeTable={activeTable}
        schema={schema}
        onApply={onDataOperation}
        onSampleTable={onSampleTable}
      />

      <AggregateDialog
        isOpen={aggregateDialogOpen}
        onClose={() => setAggregateDialogOpen(false)}
        activeTable={activeTable}
        schema={schema}
        onCreateTable={onCreateAggregateTable}
      />

      <PivotDialog
        isOpen={pivotDialogOpen}
        onClose={() => setPivotDialogOpen(false)}
        activeTable={activeTable}
        schema={schema}
        onCreateTable={onCreatePivotTable}
      />

      <LookupMergeDialog
        isOpen={mergeDialogOpen}
        onClose={() => setMergeDialogOpen(false)}
        activeTable={activeTable}
        schema={schema}
        tables={tables}
        onExecute={onLookupMerge}
      />

      <DateConversionDialog
        isOpen={dateConvDialogOpen}
        onClose={() => setDateConvDialogOpen(false)}
        activeTable={activeTable}
        schema={schema}
        tables={tables}
        onApply={onDataOperation}
      />
    </div>
  );
}
