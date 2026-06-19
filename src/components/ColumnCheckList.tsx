import * as React from "react";
import { Button, Checkbox, InputGroup } from "@blueprintjs/core";

/**
 * Shared column/table/sheet checkbox list.
 *
 * Replaces the duplicated `.aggregate-col-grid` selection grids in
 * AggregateDialog, PivotDialog, LookupMergeDialog, ExportDialog and
 * ExcelSheetPickerDialog. Emits the existing `.aggregate-col-*` classes so
 * row visuals are unchanged; the only normalization is that Select All /
 * Deselect All / Select All Numeric now live in a consistent toolbar above
 * the grid instead of each dialog's section header.
 *
 * Selection state is owned by the parent (a `Set<string>` of item names) so
 * every call site keeps its exact business logic. `emptyMeans` documents
 * whether an empty selection is valid; parents still own their own
 * apply/run gating — when `emptyMeans="all"` the component additionally
 * shows an inline "all items" hint while nothing is selected.
 */
export interface ColumnCheckItem {
  /** Unique identifier shown as the row label. */
  name: string;
  /** Right-aligned secondary text (column type, "N rows", etc.). */
  type?: string;
}

export interface ColumnCheckListProps {
  items: ColumnCheckItem[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Show the search box. Defaults to on when there are more than 8 items. */
  search?: boolean;
  searchPlaceholder?: string;
  /** Show Select All / Deselect All buttons. */
  showSelectAll?: boolean;
  /**
   * When provided, enables a "Select All Numeric" action and appends the
   * numeric-only hint to non-matching rows. Receives each item's `type`.
   */
  isNumeric?: (type: string | undefined) => boolean;
  numericHint?: string;
  /** Whether an empty selection is meaningful or invalid for this call site. */
  emptyMeans?: "all" | "invalid";
  /** Inline hint shown while nothing is selected and `emptyMeans="all"`. */
  emptyAllText?: string;
  maxHeight?: number;
  className?: string;
}

const DEFAULT_NUMERIC_HINT = " (count/count null/min/max only)";
const SEARCH_THRESHOLD = 8;

export function ColumnCheckList({
  items,
  selected,
  onChange,
  search,
  searchPlaceholder = "Search...",
  showSelectAll = true,
  isNumeric,
  numericHint = DEFAULT_NUMERIC_HINT,
  emptyMeans = "invalid",
  emptyAllText = "All items will be used.",
  maxHeight = 200,
  className,
}: ColumnCheckListProps) {
  const [query, setQuery] = React.useState("");

  const showSearch = search ?? items.length > SEARCH_THRESHOLD;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.name.toLowerCase().includes(q));
  }, [items, query]);

  const toggle = React.useCallback(
    (name: string) => {
      const next = new Set(selected);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      onChange(next);
    },
    [selected, onChange]
  );

  const selectAll = React.useCallback(
    () => onChange(new Set(items.map((it) => it.name))),
    [items, onChange]
  );
  const deselectAll = React.useCallback(() => onChange(new Set()), [onChange]);
  const selectNumeric = React.useCallback(
    () => onChange(new Set(items.filter((it) => isNumeric?.(it.type)).map((it) => it.name))),
    [items, isNumeric, onChange]
  );

  const showToolbar = showSearch || showSelectAll || Boolean(isNumeric);

  return (
    <div className={`column-check-list${className ? " " + className : ""}`}>
      {showToolbar && (
        <div className="column-check-list-toolbar">
          {showSearch ? (
            <InputGroup
              small
              leftIcon="search"
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              rightElement={
                query ? (
                  <Button
                    minimal
                    small
                    icon="cross"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                  />
                ) : undefined
              }
              className="column-check-list-search"
            />
          ) : (
            <span className="column-check-list-spacer" />
          )}
          <span className="column-check-list-actions">
            {isNumeric ? (
              // Numeric contexts keep their original "Select All Numeric" action
              // instead of a generic Select All, so the UI never selects
              // non-numeric columns that the SQL would silently skip.
              <Button minimal small text="Select All Numeric" onClick={selectNumeric} />
            ) : (
              showSelectAll && <Button minimal small text="Select All" onClick={selectAll} />
            )}
            {showSelectAll && (
              <Button minimal small text="Deselect All" onClick={deselectAll} />
            )}
          </span>
        </div>
      )}
      <div className="aggregate-col-grid" style={{ maxHeight }}>
        {filtered.length === 0 ? (
          <div className="column-check-list-empty">No matches</div>
        ) : (
          filtered.map((it) => {
            const numeric = isNumeric ? isNumeric(it.type) : true;
            return (
              <div
                key={it.name}
                className={`aggregate-col-item${selected.has(it.name) ? " selected" : ""}`}
              >
                <Checkbox
                  checked={selected.has(it.name)}
                  onChange={() => toggle(it.name)}
                  style={{ marginBottom: 0 }}
                />
                <span className="aggregate-col-name">{it.name}</span>
                {it.type !== undefined && (
                  <span className="aggregate-col-type">
                    {it.type}
                    {isNumeric && !numeric && (
                      <span className="aggregate-col-hint">{numericHint}</span>
                    )}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
      {emptyMeans === "all" && selected.size === 0 && (
        <div className="column-check-list-hint">{emptyAllText}</div>
      )}
    </div>
  );
}
