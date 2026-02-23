import React, { useState, useEffect } from "react";
import { Button, HTMLSelect, InputGroup, Intent, Tag } from "@blueprintjs/core";
import { ColumnInfo, FilterCondition } from "../types";

const OPERATORS: { value: FilterCondition["operator"]; label: string }[] = [
  { value: "CONTAINS", label: "contains" },
  { value: "IN", label: "in" },
  { value: ">", label: ">" },
  { value: "<", label: "<" },
  { value: "=", label: "=" },
  { value: "!=", label: "!=" },
  { value: ">=", label: ">=" },
  { value: "<=", label: "<=" },
  { value: "LIKE", label: "like" },
  { value: "NOT LIKE", label: "not like" },
  { value: "IS NULL", label: "is null" },
  { value: "IS NOT NULL", label: "is not null" },
];

const NO_VALUE_OPS = new Set(["IS NULL", "IS NOT NULL"]);

interface DraftFilter {
  column: string;
  operator: FilterCondition["operator"];
  value: string;
}

interface FilterPanelProps {
  columns: ColumnInfo[];
  activeFilters: FilterCondition[];
  onApplyFilters: (filters: FilterCondition[]) => void;
}

export function FilterPanel({
  columns,
  activeFilters,
  onApplyFilters,
}: FilterPanelProps): React.ReactElement {
  const [drafts, setDrafts] = useState<DraftFilter[]>([]);

  // Sync drafts when active filters change externally (e.g. table switch)
  useEffect(() => {
    setDrafts(
      activeFilters.map((f) => ({
        column: f.column,
        operator: f.operator,
        value: f.value,
      }))
    );
  }, [activeFilters]);

  const addFilter = () => {
    const col = columns.length > 0 ? columns[0].column_name : "";
    setDrafts((prev) => [...prev, { column: col, operator: "CONTAINS", value: "" }]);
  };

  const removeFilter = (index: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  };

  const updateFilter = (index: number, patch: Partial<DraftFilter>) => {
    setDrafts((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );
  };

  const clearAll = () => {
    setDrafts([]);
  };

  const applyFilters = () => {
    const valid = drafts.filter(
      (d) => d.column && (NO_VALUE_OPS.has(d.operator) || d.value.trim() !== "")
    );
    onApplyFilters(
      valid.map((d) => ({ column: d.column, operator: d.operator, value: d.value }))
    );
  };

  const isDirty =
    JSON.stringify(drafts) !==
    JSON.stringify(
      activeFilters.map((f) => ({ column: f.column, operator: f.operator, value: f.value }))
    );

  return (
    <div className="filter-panel">
      <div className="filter-panel-header">
        <div className="filter-panel-header-left">
          <span className="filter-panel-title">Filters</span>
          {activeFilters.length > 0 && (
            <Tag minimal round intent={Intent.PRIMARY}>
              {activeFilters.length} active
            </Tag>
          )}
        </div>
        <div className="filter-panel-header-right">
          <Button icon="add" text="Add Filter" small minimal onClick={addFilter} />
          {drafts.length > 0 && (
            <Button icon="cross" text="Clear All" small minimal onClick={clearAll} />
          )}
        </div>
      </div>

      {drafts.length > 0 && (
        <div className="filter-panel-body">
          {drafts.map((draft, i) => (
            <div className="filter-row" key={i}>
              <HTMLSelect
                className="filter-col-select"
                value={draft.column}
                onChange={(e) => updateFilter(i, { column: e.target.value })}
              >
                {columns.map((c) => (
                  <option key={c.column_name} value={c.column_name}>
                    {c.column_name}
                  </option>
                ))}
              </HTMLSelect>

              <HTMLSelect
                className="filter-op-select"
                value={draft.operator}
                onChange={(e) =>
                  updateFilter(i, {
                    operator: e.target.value as FilterCondition["operator"],
                  })
                }
              >
                {OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </HTMLSelect>

              {!NO_VALUE_OPS.has(draft.operator) && (
                <InputGroup
                  className="filter-value-input"
                  value={draft.value}
                  onChange={(e) => updateFilter(i, { value: e.target.value })}
                  placeholder={
                    draft.operator === "IN"
                      ? "val1, val2, val3"
                      : "value"
                  }
                  small
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyFilters();
                  }}
                />
              )}

              <Button
                icon="small-cross"
                minimal
                small
                onClick={() => removeFilter(i)}
              />
            </div>
          ))}
        </div>
      )}

      {drafts.length > 0 && (
        <div className="filter-panel-footer">
          <Button
            intent={Intent.PRIMARY}
            text="Apply Filters"
            small
            onClick={applyFilters}
            disabled={!isDirty && activeFilters.length === drafts.length}
          />
        </div>
      )}
    </div>
  );
}
