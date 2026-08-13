import React, { useState, useEffect, useRef, useCallback } from "react";
import { Icon } from "@blueprintjs/core";
import { Popover2 } from "@blueprintjs/popover2";
import { ColumnInfo } from "../types";
import { SearchInput } from "./SearchInput";

interface SearchableColumnSelectProps {
  value: string;
  onChange: (value: string) => void;
  columns: ColumnInfo[];
  placeholder?: string;
  leftIcon?: React.ComponentProps<typeof Icon>["icon"];
  showType?: boolean;
  fill?: boolean;
  className?: string;
  id?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  triggerPrefix?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

function getColumnLabel(column: ColumnInfo): string {
  return column.display_name ?? column.column_name;
}

export function SearchableColumnSelect({
  value,
  onChange,
  columns,
  placeholder = "Select column...",
  leftIcon,
  showType = false,
  fill = false,
  className = "",
  id,
  allowEmpty = false,
  emptyLabel = "— None —",
  triggerPrefix = "",
  disabled = false,
  "aria-label": ariaLabel,
}: SearchableColumnSelectProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const openHighlightRef = useRef<number | null>(null);
  const listId = React.useId();

  // Reset search and highlight when opening
  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setHighlightIndex(openHighlightRef.current ?? -1);
      openHighlightRef.current = null;
      // Auto-focus search input after popover renders
      requestAnimationFrame(() => {
        searchRef.current?.focus();
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  // Filter and sort columns (always alphabetical, case-insensitive)
  const filteredColumns = React.useMemo(() => {
    let cols = [...columns].sort((a, b) =>
      getColumnLabel(a).localeCompare(getColumnLabel(b), undefined, { sensitivity: "base" })
    );
    if (search) {
      const lower = search.toLowerCase();
      cols = cols.filter((c) =>
        c.column_name.toLowerCase().includes(lower) ||
        getColumnLabel(c).toLowerCase().includes(lower)
      );
    }
    return cols;
  }, [columns, search]);

  // Build selectable items list (with optional empty item at top)
  const items = React.useMemo(() => {
    const list: { value: string; label: string; type?: string }[] = [];
    const normalizedSearch = search.trim().toLowerCase();
    if (allowEmpty && (!normalizedSearch || emptyLabel.toLowerCase().includes(normalizedSearch))) {
      list.push({ value: "", label: emptyLabel });
    }
    for (const col of filteredColumns) {
      list.push({
        value: col.column_name,
        label: getColumnLabel(col),
        type: showType ? col.column_type : undefined,
      });
    }
    return list;
  }, [filteredColumns, allowEmpty, emptyLabel, search, showType]);

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val);
      setIsOpen(false);
    },
    [onChange]
  );

  const handleTriggerKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openHighlightRef.current = 0;
      setIsOpen(true);
      setHighlightIndex(0);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIndex] as HTMLElement;
      if (el) {
        el.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < items.length) {
          handleSelect(items[highlightIndex].value);
        }
      } else if (e.key === "Escape") {
        setIsOpen(false);
      }
    },
    [highlightIndex, items, handleSelect]
  );

  // Find display label for current value
  const selectedCol = columns.find((c) => c.column_name === value);
  const displayText = value
    ? selectedCol
      ? getColumnLabel(selectedCol)
      : value
    : "";
  const triggerText = displayText ? `${triggerPrefix}${displayText}` : "";

  const popoverContent = (
    <div
      className={`col-select-popover${fill ? " col-select-popover-fill" : ""}`}
      onKeyDown={handleKeyDown}
    >
      <div className="col-select-search">
        <SearchInput
          inputRef={searchRef}
          placeholder="Search columns..."
          value={search}
          onChange={(value) => {
            setSearch(value);
            setHighlightIndex(0);
          }}
          onClear={() => setHighlightIndex(0)}
          small
          role="combobox"
          aria-controls={listId}
          aria-expanded={isOpen}
          aria-activedescendant={
            highlightIndex >= 0 && highlightIndex < items.length
              ? `${listId}-option-${highlightIndex}`
              : undefined
          }
        />
      </div>
      <div className="col-select-list" ref={listRef} id={listId} role="listbox">
        {items.length === 0 && (
          <div className="col-select-empty">No columns found</div>
        )}
        {items.map((item, idx) => {
          const isSelected = item.value === value;

          return (
            <div
              key={item.value || "__empty__"}
              id={`${listId}-option-${idx}`}
              className={`col-select-item${isSelected ? " col-select-item-selected" : ""}${idx === highlightIndex ? " col-select-item-highlight" : ""}`}
              role="option"
              aria-selected={isSelected}
              onClick={() => handleSelect(item.value)}
              onMouseEnter={() => setHighlightIndex(idx)}
            >
              <span className="col-select-item-name">{item.label}</span>
              <span className="col-select-item-meta">
                {item.type && <span className="col-select-item-type">{item.type}</span>}
                {isSelected && <Icon icon="tick" iconSize={12} className="col-select-item-check" />}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <Popover2
      content={popoverContent}
      isOpen={disabled ? false : isOpen}
      onInteraction={(nextOpen) => {
        if (disabled) {
          setIsOpen(false);
          return;
        }
        if (nextOpen) openHighlightRef.current = null;
        setIsOpen(nextOpen);
      }}
      placement="bottom-start"
      minimal
      matchTargetWidth={fill}
    >
      <button
        id={id}
        type="button"
        className={`col-select-trigger ${fill ? "col-select-trigger-fill" : ""} ${className}`}
        onClick={() => {
          openHighlightRef.current = null;
          setIsOpen((v) => !v);
        }}
        onKeyDown={handleTriggerKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
      >
        {leftIcon && <Icon icon={leftIcon} iconSize={13} className="col-select-trigger-left-icon" />}
        <span className={`col-select-trigger-text ${!triggerText ? "col-select-trigger-placeholder" : ""}`}>
          {triggerText || placeholder}
        </span>
        <Icon icon="caret-down" iconSize={12} className="col-select-trigger-caret" />
      </button>
    </Popover2>
  );
}
