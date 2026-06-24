import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Button,
  Callout,
  HTMLSelect,
  Icon,
  InputGroup,
  Intent,
  Spinner,
  Switch,
  Tag,
} from "@blueprintjs/core";
import { LoadedTable } from "../types";
import {
  FlattenOptions,
  JsonValue,
  flattenJson,
  formatJsonScalar,
  getChildCount,
  getJsonType,
  parseJsonText,
  toCsv,
} from "../utils/jsonFlatten";

const DEFAULT_JSON_TREE_WIDTH_PERCENT = 44;
const JSON_TREE_MIN_WIDTH = 240;
const JSON_EDITOR_MIN_WIDTH = 280;
const JSON_SPLITTER_WIDTH = 8;
const JSON_HISTORY_LIMIT = 100;
const JSON_TYPING_PUSH_DELAY = 700;

interface JsonHistoryEntry {
  text: string;
  label: string;
}

interface JsonHistoryState {
  entries: JsonHistoryEntry[];
  index: number;
}

type JsonHistoryAction =
  | { type: "reset"; text: string; label: string }
  | { type: "push"; text: string; label: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "jump"; index: number };

function jsonHistoryReducer(state: JsonHistoryState, action: JsonHistoryAction): JsonHistoryState {
  switch (action.type) {
    case "reset":
      return { entries: [{ text: action.text, label: action.label }], index: 0 };
    case "push": {
      const current = state.entries[state.index];
      if (current && current.text === action.text) return state;
      const kept = state.entries.slice(0, state.index + 1);
      const next = [...kept, { text: action.text, label: action.label }];
      const overflow = Math.max(0, next.length - JSON_HISTORY_LIMIT);
      const trimmed = overflow ? next.slice(overflow) : next;
      return { entries: trimmed, index: trimmed.length - 1 };
    }
    case "undo":
      return state.index > 0 ? { ...state, index: state.index - 1 } : state;
    case "redo":
      return state.index < state.entries.length - 1 ? { ...state, index: state.index + 1 } : state;
    case "jump":
      if (action.index < 0 || action.index >= state.entries.length) return state;
      return { ...state, index: action.index };
    default:
      return state;
  }
}

interface JsonWorkspaceProps {
  table: LoadedTable;
  onOpenFiles: () => void;
  onReloadTable: () => Promise<void>;
}

function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function getFileExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() || "";
}

function isJsonLinesExtension(extension: string): boolean {
  return extension === "jsonl" || extension === "ndjson";
}

function serializeJsonForFile(
  value: JsonValue | null,
  extension: string,
  pretty: boolean,
  sourceText: string
): string {
  if (isJsonLinesExtension(extension)) {
    const records = Array.isArray(value) ? value : [value];
    const text = records.map((record) => JSON.stringify(record)).join("\n");
    return /\r?\n$/.test(sourceText) ? `${text}\n` : text;
  }
  return JSON.stringify(value, null, pretty ? 2 : undefined);
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function flattenPathForLabel(path: string): string {
  return path.replace(/\[(\d+)\]/g, ".$1").replace(/^\$\./, "");
}

function searchablePathText(path: string): string {
  const labelPath = flattenPathForLabel(path);
  const pathWithoutIndexes = labelPath
    .replace(/(^|\.)\d+(?=\.|$)/g, "$1")
    .replace(/^\./, "")
    .replace(/\.+/g, ".");
  return `${path} ${labelPath} ${pathWithoutIndexes}`.toLowerCase();
}

function nodeMatches(value: JsonValue, name: string, path: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (name.toLowerCase().includes(q) || searchablePathText(path).includes(q)) return true;
  if (getJsonType(value).includes(q)) return true;
  if (value === null || typeof value !== "object") {
    return String(value).toLowerCase().includes(q);
  }
  if (Array.isArray(value)) {
    return value.some((child, index) => nodeMatches(child, String(index), `${path}[${index}]`, query));
  }
  return Object.entries(value).some(([key, child]) => {
    const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;
    return nodeMatches(child, key, childPath, query);
  });
}

function nodeSelfMatches(value: JsonValue, name: string, path: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (name.toLowerCase().includes(q) || searchablePathText(path).includes(q)) return true;
  if (getJsonType(value).includes(q)) return true;
  if (value === null || typeof value !== "object") {
    return String(value).toLowerCase().includes(q);
  }
  return false;
}

function countSelfMatches(value: JsonValue, name: string, path: string, query: string): number {
  let total = nodeSelfMatches(value, name, path, query) ? 1 : 0;
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        total += countSelfMatches(child, String(index), `${path}[${index}]`, query);
      });
    } else {
      Object.entries(value).forEach(([key, child]) => {
        const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;
        total += countSelfMatches(child, key, childPath, query);
      });
    }
  }
  return total;
}

function JsonTypeBadge({ value }: { value: JsonValue }): React.ReactElement {
  const type = getJsonType(value);
  const count = getChildCount(value);
  const label = count > 0 ? `${type} [${count}]` : type;
  return <span className={`json-type-badge json-type-${type}`}>{label}</span>;
}

interface JsonTreeRowProps {
  name: string;
  path: string;
  value: JsonValue;
  depth: number;
  expanded: Set<string>;
  selectedPath: string;
  search: string;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

function JsonTreeRow({
  name,
  path,
  value,
  depth,
  expanded,
  selectedPath,
  search,
  onToggle,
  onSelect,
}: JsonTreeRowProps): React.ReactElement | null {
  if (!nodeMatches(value, name, path, search)) return null;

  const expandable = value !== null && typeof value === "object" && getChildCount(value) > 0;
  const isExpanded = expanded.has(path);
  const searchActive = search.trim().length > 0;
  const isVisuallyExpanded = isExpanded || searchActive;
  const scalar = formatJsonScalar(value);
  const isSelected = selectedPath === path;

  let children: React.ReactNode = null;
  if (expandable && isVisuallyExpanded) {
    if (Array.isArray(value)) {
      children = value.map((child, index) => (
        <JsonTreeRow
          key={`${path}[${index}]`}
          name={String(index)}
          path={`${path}[${index}]`}
          value={child}
          depth={depth + 1}
          expanded={expanded}
          selectedPath={selectedPath}
          search={search}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ));
    } else {
      children = Object.entries(value).map(([key, child]) => {
        const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;
        return (
          <JsonTreeRow
            key={childPath}
            name={key}
            path={childPath}
            value={child}
            depth={depth + 1}
            expanded={expanded}
            selectedPath={selectedPath}
            search={search}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        );
      });
    }
  }

  return (
    <>
      <div
        className={`json-tree-row${isSelected ? " selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 18 }}
        role="treeitem"
        tabIndex={0}
        aria-expanded={expandable ? isVisuallyExpanded : undefined}
        aria-selected={isSelected}
        onClick={() => onSelect(path)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(path);
          } else if (expandable && event.key === "ArrowRight" && !isVisuallyExpanded) {
            event.preventDefault();
            onToggle(path);
          } else if (expandable && event.key === "ArrowLeft" && isVisuallyExpanded) {
            event.preventDefault();
            onToggle(path);
          }
        }}
        title={path}
      >
        {expandable ? (
          <button
            type="button"
            className="json-tree-toggle"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(path);
            }}
            tabIndex={-1}
            aria-label={isVisuallyExpanded ? "Collapse JSON node" : "Expand JSON node"}
          >
            <Icon icon={isVisuallyExpanded ? "chevron-down" : "chevron-right"} size={12} />
          </button>
        ) : (
          <span className="json-tree-toggle-spacer" />
        )}
        <span className="json-tree-name">{name}</span>
        {scalar && <span className="json-tree-value">{scalar}</span>}
        <JsonTypeBadge value={value} />
      </div>
      {children}
    </>
  );
}

export function JsonWorkspace({
  table,
  onOpenFiles,
  onReloadTable,
}: JsonWorkspaceProps): React.ReactElement {
  const [rawText, setRawText] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState("$");
  const [treeSearch, setTreeSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["$"]));
  const [treePanelCollapsed, setTreePanelCollapsed] = useState(false);
  const [flattenCollapsed, setFlattenCollapsed] = useState(false);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [history, dispatchHistory] = useReducer(jsonHistoryReducer, { entries: [], index: 0 });
  const [treePanelWidthPercent, setTreePanelWidthPercent] = useState(DEFAULT_JSON_TREE_WIDTH_PERCENT);
  const [isTreeResizing, setIsTreeResizing] = useState(false);
  const [rawScrollTop, setRawScrollTop] = useState(0);
  const [flattenOptions, setFlattenOptions] = useState<FlattenOptions>({
    arrayMode: "unwind",
    delimiter: ".",
    includeArrayIndex: false,
  });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const rawTextRef = useRef(rawText);
  const pushTimerRef = useRef<number | null>(null);

  const canUndo = history.index > 0;
  const canRedo = history.index < history.entries.length - 1;

  const fileName = getFileName(table.filePath);
  const extension = getFileExtension(table.filePath);
  const parsed = useMemo(() => parseJsonText(rawText, extension), [rawText, extension]);
  const isDirty = rawText !== originalText;
  const isValid = parsed.error === null && rawText.trim().length > 0;

  const flattened = useMemo(() => {
    if (!isValid) return { rows: [], columns: [], recordPath: "$" };
    return flattenJson(parsed.value, flattenOptions);
  }, [isValid, parsed.value, flattenOptions]);

  const previewRows = flattened.rows.slice(0, 120);
  const previewTruncated = flattened.rows.length > previewRows.length;
  const treeSearchActive = treeSearch.trim().length > 0;
  const rootMatches = useMemo(
    () => (isValid ? nodeMatches(parsed.value, "root", "$", treeSearch) : false),
    [isValid, parsed.value, treeSearch]
  );
  const searchMatchCount = useMemo(
    () => (isValid && treeSearchActive ? countSelfMatches(parsed.value, "root", "$", treeSearch) : 0),
    [isValid, treeSearchActive, parsed.value, treeSearch]
  );
  const lineCount = useMemo(() => rawText.split(/\r\n|\r|\n/).length, [rawText]);
  const lineNumbers = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1), [lineCount]);

  useLayoutEffect(() => {
    rawTextRef.current = rawText;
  });

  useEffect(() => () => {
    if (pushTimerRef.current) window.clearTimeout(pushTimerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setStatusMessage(null);
    window.api.readTextFile(table.filePath)
      .then((text) => {
        if (cancelled) return;
        setRawText(text);
        setOriginalText(text);
        setFileSize(new Blob([text]).size);
        setSelectedPath("$");
        setExpanded(new Set(["$"]));
        dispatchHistory({ type: "reset", text, label: "Opened" });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [table.filePath]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const maxTop = Math.max(0, editor.scrollHeight - editor.clientHeight);
    if (editor.scrollTop > maxTop) {
      editor.scrollTop = maxTop;
    }
    setRawScrollTop(editor.scrollTop);
  }, [rawText]);

  const flushPendingHistory = useCallback(() => {
    if (pushTimerRef.current) {
      window.clearTimeout(pushTimerRef.current);
      pushTimerRef.current = null;
      dispatchHistory({ type: "push", text: rawTextRef.current, label: "Edited" });
    }
  }, []);

  // Apply text when the user navigates history (undo / redo / jump). Pushes are
  // no-ops here because the current entry text already equals rawText.
  useEffect(() => {
    const entry = history.entries[history.index];
    if (entry && entry.text !== rawTextRef.current) {
      if (pushTimerRef.current) {
        window.clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
      setRawText(entry.text);
    }
  }, [history.index, history.entries]);

  const handleUndo = useCallback(() => {
    flushPendingHistory();
    dispatchHistory({ type: "undo" });
  }, [flushPendingHistory]);

  const handleRedo = useCallback(() => {
    dispatchHistory({ type: "redo" });
  }, []);

  const handleJump = useCallback((index: number) => {
    flushPendingHistory();
    dispatchHistory({ type: "jump", index });
  }, [flushPendingHistory]);

  const togglePath = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const updateTreePanelWidth = useCallback((clientX: number) => {
    const main = mainRef.current;
    if (!main) return;
    const rect = main.getBoundingClientRect();
    const maxTreeWidth = Math.max(80, rect.width - JSON_EDITOR_MIN_WIDTH - JSON_SPLITTER_WIDTH);
    const minTreeWidth = Math.min(JSON_TREE_MIN_WIDTH, maxTreeWidth);
    const nextWidth = Math.min(
      Math.max(clientX - rect.left, minTreeWidth),
      Math.max(minTreeWidth, maxTreeWidth)
    );
    setTreePanelWidthPercent((nextWidth / rect.width) * 100);
  }, []);

  useEffect(() => {
    if (!isTreeResizing) return;

    const handleMouseMove = (event: MouseEvent) => {
      updateTreePanelWidth(event.clientX);
    };
    const handleMouseUp = () => {
      setIsTreeResizing(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isTreeResizing, updateTreePanelWidth]);

  const handleResizeMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsTreeResizing(true);
    updateTreePanelWidth(event.clientX);
  }, [updateTreePanelWidth]);

  const handleFormat = useCallback(() => {
    if (!isValid) return;
    flushPendingHistory();
    const formatted = serializeJsonForFile(parsed.value, extension, true, rawText);
    setRawText(formatted);
    const label = isJsonLinesExtension(extension) ? "Formatted JSON Lines" : "Formatted JSON";
    dispatchHistory({ type: "push", text: formatted, label });
    setStatusMessage(label);
  }, [extension, isValid, parsed.value, rawText, flushPendingHistory]);

  const handleMinify = useCallback(() => {
    if (!isValid) return;
    flushPendingHistory();
    const minified = serializeJsonForFile(parsed.value, extension, false, rawText);
    setRawText(minified);
    const label = isJsonLinesExtension(extension) ? "Minified JSON Lines" : "Minified JSON";
    dispatchHistory({ type: "push", text: minified, label });
    setStatusMessage(label);
  }, [extension, isValid, parsed.value, rawText, flushPendingHistory]);

  const handleRawChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    setRawText(value);
    if (pushTimerRef.current) window.clearTimeout(pushTimerRef.current);
    pushTimerRef.current = window.setTimeout(() => {
      pushTimerRef.current = null;
      dispatchHistory({ type: "push", text: rawTextRef.current, label: "Edited" });
    }, JSON_TYPING_PUSH_DELAY);
  }, []);

  const handleRevert = useCallback(() => {
    if (rawText === originalText) return;
    flushPendingHistory();
    setRawText(originalText);
    dispatchHistory({ type: "push", text: originalText, label: "Reverted to saved" });
    setStatusMessage("Reverted to saved");
  }, [rawText, originalText, flushPendingHistory]);

  const handleSave = useCallback(async () => {
    if (!isValid) {
      setStatusMessage("Fix JSON before saving");
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      await window.api.writeTextFile(table.filePath, rawText);
      setOriginalText(rawText);
      setFileSize(new Blob([rawText]).size);
      await onReloadTable();
      setStatusMessage("Saved JSON");
    } catch (err) {
      setStatusMessage(`Save failed: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [isValid, onReloadTable, rawText, table.filePath]);

  const handleExportCsv = useCallback(async () => {
    if (flattened.rows.length === 0 || flattened.columns.length === 0) return;
    setExporting(true);
    setStatusMessage(null);
    try {
      const path = await window.api.saveFileDialog("csv");
      if (!path) return;
      await window.api.writeTextFile(path, toCsv(flattened.rows, flattened.columns));
      setStatusMessage(`Exported ${flattened.rows.length.toLocaleString()} rows`);
    } catch (err) {
      setStatusMessage(`Export failed: ${String(err)}`);
    } finally {
      setExporting(false);
    }
  }, [flattened.columns, flattened.rows]);

  const handleSaveAs = useCallback(async () => {
    if (!isValid) {
      setStatusMessage("Fix JSON before saving");
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      const path = await window.api.saveFileDialog(extension || "json");
      if (!path) return;
      await window.api.writeTextFile(path, rawText);
      setStatusMessage(`Saved copy to ${getFileName(path)}`);
    } catch (err) {
      setStatusMessage(`Save As failed: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [isValid, extension, rawText]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        if (isDirty && isValid && !saving) handleSave();
      } else if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        if (canUndo) handleUndo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        if (canRedo) handleRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, isDirty, isValid, saving, canUndo, canRedo, handleUndo, handleRedo]);

  useEffect(() => {
    if (!statusMessage) return;
    const id = window.setTimeout(() => setStatusMessage(null), 4000);
    return () => window.clearTimeout(id);
  }, [statusMessage]);

  const selectedLabel = flattenPathForLabel(selectedPath) || "$";
  const mainClassName = `json-main${treePanelCollapsed ? " tree-collapsed" : ""}${isTreeResizing ? " resizing" : ""}`;
  const historyCol = historyPanelOpen ? " minmax(220px, 280px)" : "";
  const treeCols = treePanelCollapsed
    ? `38px minmax(${JSON_EDITOR_MIN_WIDTH}px, 1fr)`
    : `minmax(${JSON_TREE_MIN_WIDTH}px, ${treePanelWidthPercent}%) ${JSON_SPLITTER_WIDTH}px minmax(${JSON_EDITOR_MIN_WIDTH}px, 1fr)`;
  const mainStyle = { gridTemplateColumns: `${treeCols}${historyCol}` } as React.CSSProperties;

  return (
    <div className="json-workspace">
      <div className="json-toolbar">
        <div className="json-toolbar-actions">
          <span className="json-file-name" title={table.filePath}>
            {fileName}
            {isDirty && <span className="json-dirty-dot" title="Unsaved changes">●</span>}
          </span>
          <span className="json-toolbar-divider" />
          <Button icon="folder-open" text="Open JSON" onClick={onOpenFiles} />
          <Button icon="floppy-disk" text="Save" intent={Intent.PRIMARY} onClick={handleSave} disabled={!isDirty || !isValid || saving} loading={saving} />
          <Button icon="duplicate" text="Save As" onClick={handleSaveAs} disabled={!isValid || saving} />
          <Button icon="reset" text="Revert" onClick={handleRevert} disabled={!isDirty} />
          <span className="json-toolbar-divider" />
          <Button icon="undo" aria-label="Undo (Cmd+Z)" title="Undo (Cmd+Z)" onClick={handleUndo} disabled={!canUndo} />
          <Button icon="redo" aria-label="Redo (Cmd+Shift+Z)" title="Redo (Cmd+Shift+Z)" onClick={handleRedo} disabled={!canRedo} />
          <span className="json-toolbar-divider" />
          <Button icon="align-left" text="Format" onClick={handleFormat} disabled={!isValid} />
          <Button icon="minimize" text="Minify" onClick={handleMinify} disabled={!isValid} />
        </div>
        <div className="json-toolbar-right">
          <Button icon="history" text="History" active={historyPanelOpen} onClick={() => setHistoryPanelOpen((prev) => !prev)} />
          <Tag minimal intent={isValid ? Intent.SUCCESS : Intent.DANGER} icon={isValid ? "tick-circle" : "error"}>
            {isValid ? "Valid JSON" : "Invalid JSON"}
          </Tag>
        </div>
      </div>

      {loadError && (
        <Callout intent={Intent.DANGER} icon="error" className="json-load-error">
          {loadError}
        </Callout>
      )}

      <div className={mainClassName} ref={mainRef} style={mainStyle}>
        {treePanelCollapsed ? (
          <div className="json-tree-rail">
            <button
              type="button"
              className="json-panel-collapse"
              aria-label="Expand JSON tree panel"
              title="Expand JSON tree panel"
              onClick={() => setTreePanelCollapsed(false)}
            >
              <Icon icon="chevron-right" size={12} />
            </button>
          </div>
        ) : (
          <section className="json-panel json-tree-panel">
            <div className="json-panel-header">
              <strong>JSON Tree</strong>
              <button
                type="button"
                className="json-panel-collapse"
                aria-label="Collapse JSON tree panel"
                title="Collapse JSON tree panel"
                onClick={() => setTreePanelCollapsed(true)}
              >
                <Icon icon="chevron-left" size={12} />
              </button>
            </div>
            <div className="json-tree-tools">
              <InputGroup
                small
                leftIcon="search"
                placeholder="Search tree..."
                value={treeSearch}
                onChange={(event) => setTreeSearch(event.currentTarget.value)}
              />
              <span className="json-path-pill" title={selectedPath}>Path: {selectedLabel}</span>
            </div>
            {treeSearchActive && (
              <div className="json-tree-search-meta">
                {searchMatchCount.toLocaleString()} match{searchMatchCount === 1 ? "" : "es"}
              </div>
            )}
            <div className="json-tree-column-header" aria-hidden="true">
              <span />
              <span>Key</span>
              <span>Value</span>
              <span>Type</span>
            </div>
            <div className="json-tree-scroll">
              {loading && <div className="json-loading"><Spinner size={18} /> Loading JSON...</div>}
              {!loading && isValid && treeSearchActive && !rootMatches && (
                <div className="json-tree-empty">
                  <Icon icon="search" size={18} />
                  <span>No matches for "{treeSearch.trim()}"</span>
                </div>
              )}
              {!loading && isValid && (!treeSearchActive || rootMatches) && (
                <JsonTreeRow
                  name="root"
                  path="$"
                  value={parsed.value}
                  depth={0}
                  expanded={expanded}
                  selectedPath={selectedPath}
                  search={treeSearch}
                  onToggle={togglePath}
                  onSelect={setSelectedPath}
                />
              )}
              {!loading && parsed.error && (
                <div className="json-tree-empty">
                  <Icon icon="warning-sign" size={18} />
                  <span>{parsed.error}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {!treePanelCollapsed && (
          <div
            className="json-split-resizer"
            role="separator"
            aria-label="Resize JSON tree and raw editor panels"
            aria-orientation="vertical"
            title="Drag to resize. Double-click to reset."
            onMouseDown={handleResizeMouseDown}
            onDoubleClick={() => setTreePanelWidthPercent(DEFAULT_JSON_TREE_WIDTH_PERCENT)}
          />
        )}

        <section className="json-panel json-editor-panel">
          <div className="json-panel-header">
            <strong>Raw Editor</strong>
            <span className="json-editor-meta">
              {lineCount.toLocaleString()} lines · UTF-8 · {extension.toUpperCase() || "JSON"}
            </span>
          </div>
          <div className={`json-editor${parsed.error ? " has-error" : ""}`}>
            <div className="json-line-numbers">
              <div className="json-line-numbers-inner" style={{ transform: `translateY(-${rawScrollTop}px)` }}>
                {lineNumbers.map((n) => <span key={n}>{n}</span>)}
              </div>
            </div>
            <textarea
              ref={editorRef}
              className="json-code-input"
              value={rawText}
              aria-label="Raw JSON editor"
              spellCheck={false}
              wrap="off"
              onChange={handleRawChange}
              onScroll={(event) => setRawScrollTop(event.currentTarget.scrollTop)}
            />
          </div>
          <div className={`json-editor-status${parsed.error ? " error" : ""}`}>
            {parsed.error ? (
              <>
                <Icon icon="error" size={13} />
                <span>Error: {parsed.error}</span>
              </>
            ) : (
              <>
                <Icon icon="tick-circle" size={13} />
                <span>{statusMessage || "Ready"}</span>
              </>
            )}
          </div>
        </section>

        {historyPanelOpen && (
          <section className="json-panel json-history-panel">
            <div className="json-panel-header">
              <strong>History</strong>
              <button
                type="button"
                className="json-panel-collapse"
                aria-label="Close history panel"
                title="Close history panel"
                onClick={() => setHistoryPanelOpen(false)}
              >
                <Icon icon="cross" size={12} />
              </button>
            </div>
            <div className="json-history-scroll">
              {history.entries.length === 0 ? (
                <div className="json-tree-empty">
                  <Icon icon="history" size={18} />
                  <span>No history yet</span>
                </div>
              ) : (
                history.entries
                  .map((entry, index) => ({ entry, index }))
                  .reverse()
                  .map(({ entry, index }) => {
                  const isCurrent = index === history.index;
                  return (
                    <button
                      key={index}
                      type="button"
                      className={`json-history-row${isCurrent ? " current" : ""}${index > history.index ? " ahead" : ""}`}
                      onClick={() => handleJump(index)}
                      title={`Restore: ${entry.label}`}
                    >
                      <span className="json-history-marker" />
                      <span className="json-history-step">{index + 1}</span>
                      <span className="json-history-label">{entry.label}</span>
                      {isCurrent && <Tag minimal intent={Intent.PRIMARY}>current</Tag>}
                    </button>
                  );
                })
              )}
            </div>
            <div className="json-panel-footer">
              <span>{history.index + 1} / {history.entries.length}</span>
              <span>{canRedo ? `${history.entries.length - 1 - history.index} ahead` : "latest"}</span>
            </div>
          </section>
        )}
      </div>

      <div className={`json-flatten-panel${flattenCollapsed ? " collapsed" : ""}`}>
        <div className="json-flatten-header">
          <div className="json-flatten-title">
            <button
              type="button"
              className="json-panel-collapse"
              aria-label={flattenCollapsed ? "Expand flatten preview" : "Collapse flatten preview"}
              aria-expanded={!flattenCollapsed}
              title={flattenCollapsed ? "Expand flatten preview" : "Collapse flatten preview"}
              onClick={() => setFlattenCollapsed((prev) => !prev)}
            >
              <Icon icon={flattenCollapsed ? "chevron-up" : "chevron-down"} size={12} />
            </button>
            <div>
              <strong>Flatten Preview</strong>
              <span>
                {flattened.rows.length.toLocaleString()} rows · {flattened.columns.length.toLocaleString()} columns · {flattened.recordPath}
                {previewTruncated && ` · showing first ${previewRows.length}`}
              </span>
            </div>
          </div>
          <div className="json-flatten-options">
            <label>
              <span>Array mode:</span>
              <HTMLSelect
                value={flattenOptions.arrayMode}
                onChange={(event) => {
                  const arrayMode = event.currentTarget.value as FlattenOptions["arrayMode"];
                  setFlattenOptions((prev) => ({ ...prev, arrayMode }));
                }}
              >
                <option value="unwind">Unwind rows</option>
                <option value="stringify">Stringify arrays</option>
              </HTMLSelect>
            </label>
            <label>
              <span>Delimiter:</span>
              <InputGroup
                small
                value={flattenOptions.delimiter}
                onChange={(event) => {
                  const delimiter = event.currentTarget.value || ".";
                  setFlattenOptions((prev) => ({ ...prev, delimiter }));
                }}
              />
            </label>
            <Switch
              checked={flattenOptions.includeArrayIndex}
              label="Include array index"
              onChange={(event) => {
                const includeArrayIndex = (event.currentTarget as HTMLInputElement).checked;
                setFlattenOptions((prev) => ({ ...prev, includeArrayIndex }));
              }}
            />
            <span className="json-toolbar-divider" />
            <Button
              icon={exporting ? <Spinner size={14} /> : "export"}
              text="Export CSV"
              intent={Intent.PRIMARY}
              disabled={!isValid || flattened.rows.length === 0 || exporting}
              onClick={handleExportCsv}
            />
          </div>
        </div>
        {!flattenCollapsed && (
        <div className="json-preview-scroll">
          {flattened.columns.length === 0 ? (
            <div className="json-preview-empty">No flattened columns</div>
          ) : (
            <table className="json-preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  {flattened.columns.map((column) => <th key={column}>{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <td>{rowIndex + 1}</td>
                    {flattened.columns.map((column) => (
                      <td key={column}>{String(row[column] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        )}
        <div className="json-status-strip">
          <span>Size: {formatFileSize(fileSize)}</span>
          <span>Rows: {table.rowCount.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
