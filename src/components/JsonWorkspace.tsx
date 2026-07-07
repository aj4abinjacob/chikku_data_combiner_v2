import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import ReactDOM from "react-dom";
import {
  Button,
  Callout,
  Icon,
  InputGroup,
  Intent,
  Spinner,
  Switch,
  Tag,
} from "@blueprintjs/core";
import { SoftSelect } from "./SoftSelect";
import { JsonWorkspaceFileActions, LoadedTable } from "../types";
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

const JSON_HISTORY_LIMIT = 100;
const JSON_TYPING_PUSH_DELAY = 700;
const JSON_SPLIT_DIVIDER_PX = 8;
const JSON_SPLIT_LEFT_MIN_PX = 240;
const JSON_SPLIT_RIGHT_MIN_PX = 280;
const JSON_SPLIT_KEY_STEP = 4;
const JSON_COMMAND_FEEDBACK_MS = 1400;
const JSON_TREE_MENU_WIDTH_PX = 180;
const JSON_TREE_MENU_HEIGHT_PX = 118;
const JSON_TREE_MENU_MARGIN_PX = 8;

type JsonCommandFeedbackKey = "copy" | "minify" | "format" | "wrap";

interface JsonTreeContextItem {
  name: string;
  path: string;
  value: JsonValue;
}

interface JsonTreeContextMenuState extends JsonTreeContextItem {
  x: number;
  y: number;
}

interface JsonCommandFeedback {
  key: JsonCommandFeedbackKey;
  label: string;
}

interface JsonHistoryEntry {
  text: string;
  label: string;
  wrapEditorContent: boolean;
}

interface JsonHistoryState {
  entries: JsonHistoryEntry[];
  index: number;
}

type JsonHistoryAction =
  | { type: "reset"; text: string; label: string; wrapEditorContent: boolean }
  | { type: "push"; text: string; label: string; wrapEditorContent: boolean }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "jump"; index: number };

function jsonHistoryReducer(state: JsonHistoryState, action: JsonHistoryAction): JsonHistoryState {
  switch (action.type) {
    case "reset":
      return {
        entries: [{
          text: action.text,
          label: action.label,
          wrapEditorContent: action.wrapEditorContent,
        }],
        index: 0,
      };
    case "push": {
      const current = state.entries[state.index];
      if (
        current
        && current.text === action.text
        && current.wrapEditorContent === action.wrapEditorContent
      ) {
        return state;
      }
      const kept = state.entries.slice(0, state.index + 1);
      const next = [...kept, {
        text: action.text,
        label: action.label,
        wrapEditorContent: action.wrapEditorContent,
      }];
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
  jsonTables: LoadedTable[];
  onOpenFiles: () => void;
  onReloadTable: () => Promise<void>;
  onFileActionsChange?: (actions: JsonWorkspaceFileActions | null) => void;
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

function stringifyJsonInline(value: JsonValue | null): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyJsonInline(item)).join(", ")}]`;
  }
  return `{${Object.entries(value)
    .map(([key, child]) => `${JSON.stringify(key)}: ${stringifyJsonInline(child)}`)
    .join(", ")}}`;
}

function isStandaloneJsonDocument(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function serializeJsonForFile(
  value: JsonValue | null,
  extension: string,
  pretty: boolean,
  sourceText: string
): string {
  if (isJsonLinesExtension(extension)) {
    if (isStandaloneJsonDocument(sourceText)) {
      return JSON.stringify(value, null, pretty ? 2 : undefined);
    }
    const records = Array.isArray(value) ? value : [value];
    const text = records
      .map((record) => pretty ? stringifyJsonInline(record) : JSON.stringify(record))
      .join("\n");
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

function formatJsonValueForClipboard(value: JsonValue): string {
  if (value === null || typeof value !== "object") return formatJsonScalar(value);
  return JSON.stringify(value, null, 2);
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
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>, item: JsonTreeContextItem) => void;
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
  onContextMenu,
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
          onContextMenu={onContextMenu}
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
            onContextMenu={onContextMenu}
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
        onContextMenu={(event) => onContextMenu(event, { name, path, value })}
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
  jsonTables,
  onOpenFiles,
  onReloadTable,
  onFileActionsChange,
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
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [structuredView, setStructuredView] = useState<"tree" | "table">("tree");
  const [compareMode, setCompareMode] = useState(false);
  const [compareTableName, setCompareTableName] = useState("");
  const [compareText, setCompareText] = useState("");
  const [compareFileSize, setCompareFileSize] = useState<number | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareLoadError, setCompareLoadError] = useState<string | null>(null);
  const [compareView, setCompareView] = useState<"tree" | "table">("tree");
  const [compareSearch, setCompareSearch] = useState("");
  const [compareSelectedPath, setCompareSelectedPath] = useState("$");
  const [compareExpanded, setCompareExpanded] = useState<Set<string>>(() => new Set(["$"]));
  const [history, dispatchHistory] = useReducer(jsonHistoryReducer, { entries: [], index: 0 });
  const [rawScrollTop, setRawScrollTop] = useState(0);
  const [flattenOptions, setFlattenOptions] = useState<FlattenOptions>({
    arrayMode: "unwind",
    delimiter: ".",
    includeArrayIndex: false,
  });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [jsonSplitPercent, setJsonSplitPercent] = useState(50);
  const [jsonSplitResizing, setJsonSplitResizing] = useState(false);
  const [wrapEditorContent, setWrapEditorContent] = useState(false);
  const [commandFeedback, setCommandFeedback] = useState<JsonCommandFeedback | null>(null);
  const [treeContextMenu, setTreeContextMenu] = useState<JsonTreeContextMenuState | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const treeContextMenuRef = useRef<HTMLDivElement>(null);
  const rawTextRef = useRef(rawText);
  const wrapEditorContentRef = useRef(wrapEditorContent);
  const pushTimerRef = useRef<number | null>(null);
  const splitPointerIdRef = useRef<number | null>(null);
  const commandFeedbackFrameRef = useRef<number | null>(null);
  const commandFeedbackTimerRef = useRef<number | null>(null);

  const canUndo = history.index > 0;
  const canRedo = history.index < history.entries.length - 1;

  const fileName = getFileName(table.filePath);
  const extension = getFileExtension(table.filePath);
  const parsed = useMemo(() => parseJsonText(rawText, extension), [rawText, extension]);
  const isDirty = rawText !== originalText;
  const isValid = parsed.error === null && rawText.trim().length > 0;
  const isTableView = structuredView === "table";

  const flattened = useMemo(() => {
    if (!isValid) return { rows: [], columns: [], recordPath: "$" };
    return flattenJson(parsed.value, flattenOptions);
  }, [isValid, parsed.value, flattenOptions]);
  const canExportCsv = isTableView
    && isValid
    && flattened.rows.length > 0
    && flattened.columns.length > 0
    && !exporting;

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
  const selectedLabel = flattenPathForLabel(selectedPath) || "$";
  const comparisonCandidates = useMemo(
    () => jsonTables.filter((candidate) => candidate.tableName !== table.tableName),
    [jsonTables, table.tableName]
  );
  const canCompare = comparisonCandidates.length > 0;
  const compareTable = useMemo(
    () => comparisonCandidates.find((candidate) => candidate.tableName === compareTableName) ?? comparisonCandidates[0] ?? null,
    [comparisonCandidates, compareTableName]
  );
  const compareExtension = compareTable ? getFileExtension(compareTable.filePath) : "";
  const compareParsed = useMemo(() => parseJsonText(compareText, compareExtension), [compareText, compareExtension]);
  const compareIsValid = compareParsed.error === null && compareText.trim().length > 0;
  const compareFlattened = useMemo(() => {
    if (!compareIsValid) return { rows: [], columns: [], recordPath: "$" };
    return flattenJson(compareParsed.value, flattenOptions);
  }, [compareIsValid, compareParsed.value, flattenOptions]);
  const comparePreviewRows = compareFlattened.rows.slice(0, 120);
  const comparePreviewTruncated = compareFlattened.rows.length > comparePreviewRows.length;
  const compareLineCount = useMemo(() => compareText.split(/\r\n|\r|\n/).length, [compareText]);
  const compareSelectedLabel = flattenPathForLabel(compareSelectedPath) || "$";

  useLayoutEffect(() => {
    rawTextRef.current = rawText;
    wrapEditorContentRef.current = wrapEditorContent;
  });

  useEffect(() => () => {
    if (pushTimerRef.current !== null) window.clearTimeout(pushTimerRef.current);
    if (commandFeedbackFrameRef.current !== null) window.cancelAnimationFrame(commandFeedbackFrameRef.current);
    if (commandFeedbackTimerRef.current !== null) window.clearTimeout(commandFeedbackTimerRef.current);
  }, []);

  const clearCommandFeedback = useCallback(() => {
    if (commandFeedbackFrameRef.current !== null) {
      window.cancelAnimationFrame(commandFeedbackFrameRef.current);
      commandFeedbackFrameRef.current = null;
    }
    if (commandFeedbackTimerRef.current !== null) {
      window.clearTimeout(commandFeedbackTimerRef.current);
      commandFeedbackTimerRef.current = null;
    }
    setCommandFeedback(null);
  }, []);

  const showCommandFeedback = useCallback((key: JsonCommandFeedbackKey, label: string) => {
    clearCommandFeedback();
    commandFeedbackFrameRef.current = window.requestAnimationFrame(() => {
      commandFeedbackFrameRef.current = null;
      setCommandFeedback({ key, label });
      commandFeedbackTimerRef.current = window.setTimeout(() => {
        commandFeedbackTimerRef.current = null;
        setCommandFeedback(null);
      }, JSON_COMMAND_FEEDBACK_MS);
    });
  }, [clearCommandFeedback]);

  useEffect(() => {
    if (!treeContextMenu) return;

    const closeIfOutside = (event: MouseEvent) => {
      if (treeContextMenuRef.current?.contains(event.target as Node)) return;
      setTreeContextMenu(null);
    };
    const closeMenu = () => setTreeContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    document.addEventListener("mousedown", closeIfOutside);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("mousedown", closeIfOutside);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [treeContextMenu]);

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
        dispatchHistory({
          type: "reset",
          text,
          label: "Opened",
          wrapEditorContent: wrapEditorContentRef.current,
        });
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
  }, [table.filePath, table.reloadVersion]);

  useEffect(() => {
    if (comparisonCandidates.length === 0) {
      setCompareMode(false);
      setCompareTableName("");
      return;
    }

    if (!comparisonCandidates.some((candidate) => candidate.tableName === compareTableName)) {
      setCompareTableName(comparisonCandidates[0].tableName);
    }
  }, [comparisonCandidates, compareTableName]);

  useEffect(() => {
    if (!compareMode || !compareTable) return;

    let cancelled = false;
    setCompareLoading(true);
    setCompareLoadError(null);
    window.api.readTextFile(compareTable.filePath)
      .then((text) => {
        if (cancelled) return;
        setCompareText(text);
        setCompareFileSize(new Blob([text]).size);
        setCompareSelectedPath("$");
        setCompareExpanded(new Set(["$"]));
        setCompareSearch("");
      })
      .catch((err) => {
        if (!cancelled) {
          setCompareText("");
          setCompareFileSize(null);
          setCompareLoadError(String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setCompareLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [compareMode, compareTable?.filePath, compareTable?.reloadVersion]);

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
      dispatchHistory({
        type: "push",
        text: rawTextRef.current,
        label: "Edited",
        wrapEditorContent: wrapEditorContentRef.current,
      });
    }
  }, []);

  // Apply editor state when the user navigates history (undo / redo / jump).
  useEffect(() => {
    const entry = history.entries[history.index];
    if (!entry) return;
    if (entry.text !== rawTextRef.current) {
      if (pushTimerRef.current) {
        window.clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
      setRawText(entry.text);
    }
    if (entry.wrapEditorContent !== wrapEditorContentRef.current) {
      setWrapEditorContent(entry.wrapEditorContent);
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

  const toggleComparePath = useCallback((path: string) => {
    setCompareExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const applyTransformedText = useCallback((nextText: string, label: string, unchangedLabel: string) => {
    flushPendingHistory();
    if (nextText === rawText) {
      setStatusMessage(unchangedLabel);
      return;
    }
    setRawText(nextText);
    dispatchHistory({
      type: "push",
      text: nextText,
      label,
      wrapEditorContent: wrapEditorContentRef.current,
    });
    setStatusMessage(label);
  }, [flushPendingHistory, rawText]);

  const handleFormat = useCallback(() => {
    if (!isValid) return;
    const formatted = serializeJsonForFile(parsed.value, extension, true, rawText);
    const formatsAsJsonDocument = isJsonLinesExtension(extension) && isStandaloneJsonDocument(rawText);
    const label = !isJsonLinesExtension(extension) || formatsAsJsonDocument ? "Formatted JSON" : "Formatted JSON Lines";
    const unchangedLabel = !isJsonLinesExtension(extension) || formatsAsJsonDocument ? "JSON already formatted" : "JSON Lines already formatted";
    applyTransformedText(formatted, label, unchangedLabel);
    showCommandFeedback("format", "Formatted");
  }, [applyTransformedText, extension, isValid, parsed.value, rawText, showCommandFeedback]);

  const handleMinify = useCallback(() => {
    if (!isValid) return;
    const minified = serializeJsonForFile(parsed.value, extension, false, rawText);
    const minifiesAsJsonDocument = isJsonLinesExtension(extension) && isStandaloneJsonDocument(rawText);
    const label = !isJsonLinesExtension(extension) || minifiesAsJsonDocument ? "Minified JSON" : "Minified JSON Lines";
    const unchangedLabel = !isJsonLinesExtension(extension) || minifiesAsJsonDocument ? "JSON already minified" : "JSON Lines already minified";
    applyTransformedText(minified, label, unchangedLabel);
    showCommandFeedback("minify", "Minified");
  }, [applyTransformedText, extension, isValid, parsed.value, rawText, showCommandFeedback]);

  const handleRawChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    setRawText(value);
    if (pushTimerRef.current) window.clearTimeout(pushTimerRef.current);
    pushTimerRef.current = window.setTimeout(() => {
      pushTimerRef.current = null;
      dispatchHistory({
        type: "push",
        text: rawTextRef.current,
        label: "Edited",
        wrapEditorContent: wrapEditorContentRef.current,
      });
    }, JSON_TYPING_PUSH_DELAY);
  }, []);

  const handleRevert = useCallback(() => {
    if (rawText === originalText) return;
    flushPendingHistory();
    setRawText(originalText);
    dispatchHistory({
      type: "push",
      text: originalText,
      label: "Reverted to saved",
      wrapEditorContent: wrapEditorContentRef.current,
    });
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
    if (!isTableView || flattened.rows.length === 0 || flattened.columns.length === 0) return;
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
  }, [flattened.columns, flattened.rows, isTableView]);

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

  useEffect(() => () => {
    onFileActionsChange?.(null);
  }, [onFileActionsChange]);

  const writeClipboard = useCallback(async (text: string, successMessage: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setStatusMessage(successMessage);
      return true;
    } catch (err) {
      setStatusMessage(`Copy failed: ${String(err)}`);
      return false;
    }
  }, []);

  const handleCopySource = useCallback(async () => {
    const copied = await writeClipboard(rawText, "Copied source JSON");
    if (copied) showCommandFeedback("copy", "Copied");
    else clearCommandFeedback();
  }, [clearCommandFeedback, rawText, showCommandFeedback, writeClipboard]);

  const handleCopyPath = useCallback((path: string) => {
    writeClipboard(path, `Copied path ${flattenPathForLabel(path) || "$"}`);
  }, [writeClipboard]);

  const openTreeContextMenu = useCallback((
    event: React.MouseEvent<HTMLDivElement>,
    item: JsonTreeContextItem,
    onSelectedChange: React.Dispatch<React.SetStateAction<string>>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectedChange(item.path);

    const maxLeft = Math.max(
      JSON_TREE_MENU_MARGIN_PX,
      window.innerWidth - JSON_TREE_MENU_WIDTH_PX - JSON_TREE_MENU_MARGIN_PX
    );
    const maxTop = Math.max(
      JSON_TREE_MENU_MARGIN_PX,
      window.innerHeight - JSON_TREE_MENU_HEIGHT_PX - JSON_TREE_MENU_MARGIN_PX
    );
    const x = Math.min(
      Math.max(JSON_TREE_MENU_MARGIN_PX, event.clientX),
      maxLeft
    );
    const y = Math.min(
      Math.max(JSON_TREE_MENU_MARGIN_PX, event.clientY),
      maxTop
    );
    setTreeContextMenu({ ...item, x, y });
  }, []);

  const copyTreeContextValue = useCallback(async (kind: "key" | "value" | "path") => {
    if (!treeContextMenu) return;

    const text = kind === "key"
      ? treeContextMenu.name
      : kind === "value"
        ? formatJsonValueForClipboard(treeContextMenu.value)
        : treeContextMenu.path;
    const labelPath = flattenPathForLabel(treeContextMenu.path) || "$";
    await writeClipboard(text, `Copied ${kind} ${labelPath}`);
    setTreeContextMenu(null);
  }, [treeContextMenu, writeClipboard]);

  const handleToggleWrap = useCallback(() => {
    const nextWrapped = !wrapEditorContent;
    flushPendingHistory();
    setWrapEditorContent(nextWrapped);
    dispatchHistory({
      type: "push",
      text: rawTextRef.current,
      label: nextWrapped ? "Wrapped" : "Unwrapped",
      wrapEditorContent: nextWrapped,
    });
    showCommandFeedback("wrap", nextWrapped ? "Wrapped" : "Unwrapped");
  }, [flushPendingHistory, showCommandFeedback, wrapEditorContent]);

  useEffect(() => {
    onFileActionsChange?.({
      isDirty,
      isValid,
      isTableView,
      saving,
      exporting,
      canExportCsv,
      canCompare,
      historyOpen: historyPanelOpen,
      onOpenFiles,
      onSave: handleSave,
      onSaveAs: handleSaveAs,
      onRevert: handleRevert,
      onToggleHistory: () => setHistoryPanelOpen((prev) => !prev),
      onExportCsv: handleExportCsv,
      onCopyPath: () => handleCopyPath(selectedPath),
      onCompare: () => setCompareMode(true),
    });
  }, [
    canCompare,
    canExportCsv,
    exporting,
    handleCopyPath,
    handleExportCsv,
    handleRevert,
    handleSave,
    handleSaveAs,
    historyPanelOpen,
    isDirty,
    isValid,
    isTableView,
    onFileActionsChange,
    onOpenFiles,
    saving,
    selectedPath,
  ]);

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

  useEffect(() => {
    if (!jsonSplitResizing) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [jsonSplitResizing]);

  const updateJsonSplitFromPointer = useCallback((clientX: number) => {
    const container = splitContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;

    const maxLeftPx = Math.max(
      JSON_SPLIT_LEFT_MIN_PX,
      rect.width - JSON_SPLIT_DIVIDER_PX - JSON_SPLIT_RIGHT_MIN_PX
    );
    const leftPx = Math.min(maxLeftPx, Math.max(JSON_SPLIT_LEFT_MIN_PX, clientX - rect.left));
    setJsonSplitPercent((leftPx / rect.width) * 100);
  }, []);

  const finishJsonSplitResize = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    if (event && splitPointerIdRef.current !== event.pointerId) return;
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    splitPointerIdRef.current = null;
    setJsonSplitResizing(false);
  }, []);

  const handleJsonSplitPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    splitPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setJsonSplitResizing(true);
    updateJsonSplitFromPointer(event.clientX);
  }, [updateJsonSplitFromPointer]);

  const handleJsonSplitPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (splitPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    updateJsonSplitFromPointer(event.clientX);
  }, [updateJsonSplitFromPointer]);

  const handleJsonSplitKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    setJsonSplitPercent((prev) => {
      const target = prev + direction * JSON_SPLIT_KEY_STEP;
      const container = splitContainerRef.current;
      if (!container) return Math.min(78, Math.max(22, target));

      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return Math.min(78, Math.max(22, target));

      const minPercent = (JSON_SPLIT_LEFT_MIN_PX / rect.width) * 100;
      const maxPercent = Math.max(
        minPercent,
        ((rect.width - JSON_SPLIT_DIVIDER_PX - JSON_SPLIT_RIGHT_MIN_PX) / rect.width) * 100
      );
      return Math.min(maxPercent, Math.max(minPercent, target));
    });
  }, []);

  const renderStructuredDocument = ({
    className,
    title,
    filePath,
    extensionLabel,
    parsedResult,
    isValidDocument,
    lineTotal,
    loadingDocument,
    loadErrorMessage,
    fileSizeValue,
    rowCount,
    view,
    onViewChange,
    search,
    onSearchChange,
    selected,
    onSelectedChange,
    expandedPaths,
    onTogglePath,
    flattenedData,
    previewRowsData,
    previewTruncatedValue,
    titleActions,
  }: {
    className: string;
    title: string;
    filePath: string;
    extensionLabel: string;
    parsedResult: typeof parsed;
    isValidDocument: boolean;
    lineTotal: number;
    loadingDocument: boolean;
    loadErrorMessage: string | null;
    fileSizeValue: number | null;
    rowCount: number;
    view: "tree" | "table";
    onViewChange: React.Dispatch<React.SetStateAction<"tree" | "table">>;
    search: string;
    onSearchChange: React.Dispatch<React.SetStateAction<string>>;
    selected: string;
    onSelectedChange: React.Dispatch<React.SetStateAction<string>>;
    expandedPaths: Set<string>;
    onTogglePath: (path: string) => void;
    flattenedData: typeof flattened;
    previewRowsData: typeof previewRows;
    previewTruncatedValue: boolean;
    titleActions?: React.ReactNode;
  }) => {
    const searchActive = search.trim().length > 0;
    const matchesRoot = isValidDocument ? nodeMatches(parsedResult.value as JsonValue, "root", "$", search) : false;
    const matchCount = isValidDocument && searchActive
      ? countSelfMatches(parsedResult.value as JsonValue, "root", "$", search)
      : 0;
    const paneSelectedLabel = flattenPathForLabel(selected) || "$";
    const errorMessage = loadErrorMessage || parsedResult.error;

    return (
      <section className={className}>
        <div className="json-document-titlebar">
          <span className="json-file-name" title={filePath}>{title}</span>
          {titleActions && <div className="json-document-actions">{titleActions}</div>}
        </div>

        <div className="json-document-subbar">
          <div className="json-mode-tabs" aria-label={`${title} view mode`}>
            <button
              type="button"
              className={`json-mode-tab${view === "tree" ? " active" : ""}`}
              onClick={() => onViewChange("tree")}
            >
              <Icon icon="list" size={12} />
              tree
            </button>
            <button
              type="button"
              className={`json-mode-tab${view === "table" ? " active" : ""}`}
              onClick={() => onViewChange("table")}
            >
              <Icon icon="th" size={12} />
              table
            </button>
          </div>
          <span className="json-editor-meta">
            {lineTotal.toLocaleString()} lines · UTF-8 · {extensionLabel || "JSON"}
          </span>
        </div>

        {view === "tree" ? (
          <div className="json-structured-body">
            <div className="json-tree-tools">
              <InputGroup
                small
                leftIcon="search"
                placeholder="Search tree..."
                value={search}
                onChange={(event) => onSearchChange(event.currentTarget.value)}
              />
              <span className="json-path-pill" title={selected}>
                <Icon icon="path" size={12} />
                <span>Selected path:</span>
                <strong>{paneSelectedLabel}</strong>
              </span>
            </div>
            {searchActive && (
              <div className="json-tree-search-meta">
                {matchCount.toLocaleString()} match{matchCount === 1 ? "" : "es"}
              </div>
            )}
            <div className="json-tree-column-header" aria-hidden="true">
              <span />
              <span>Key</span>
              <span>Value</span>
              <span>Type</span>
            </div>
            <div className="json-tree-scroll">
              {loadingDocument && <div className="json-loading"><Spinner size={18} /> Loading JSON...</div>}
              {!loadingDocument && isValidDocument && searchActive && !matchesRoot && (
                <div className="json-tree-empty">
                  <Icon icon="search" size={18} />
                  <span>No matches for "{search.trim()}"</span>
                </div>
              )}
              {!loadingDocument && isValidDocument && (!searchActive || matchesRoot) && (
                <JsonTreeRow
                  name="root"
                  path="$"
                  value={parsedResult.value as JsonValue}
                  depth={0}
                  expanded={expandedPaths}
                  selectedPath={selected}
                  search={search}
                  onToggle={onTogglePath}
                  onSelect={onSelectedChange}
                  onContextMenu={(event, item) => openTreeContextMenu(event, item, onSelectedChange)}
                />
              )}
              {!loadingDocument && errorMessage && (
                <div className="json-tree-empty">
                  <Icon icon="warning-sign" size={18} />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="json-structured-body json-table-body">
            <div className="json-flatten-header">
              <div className="json-flatten-title">
                <div>
                  <strong>Flatten Preview</strong>
                  <span className="json-flatten-summary">
                    <span>{flattenedData.rows.length.toLocaleString()} rows</span>
                    <span>{flattenedData.columns.length.toLocaleString()} columns</span>
                    <span title={flattenedData.recordPath}>{flattenedData.recordPath}</span>
                    {previewTruncatedValue && ` · showing first ${previewRowsData.length}`}
                  </span>
                </div>
              </div>
              <div className="json-flatten-options">
                <label>
                  <span>Array mode:</span>
                  <SoftSelect
                    value={flattenOptions.arrayMode}
                    onChange={(event) => {
                      const arrayMode = event.currentTarget.value as FlattenOptions["arrayMode"];
                      setFlattenOptions((prev) => ({ ...prev, arrayMode }));
                    }}
                  >
                    <option value="unwind">Unwind rows</option>
                    <option value="stringify">Stringify arrays</option>
                  </SoftSelect>
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
              </div>
            </div>
            <div className="json-preview-scroll">
              {flattenedData.columns.length === 0 ? (
                <div className="json-preview-empty">
                  {loadingDocument ? "Loading JSON..." : "No flattened columns"}
                </div>
              ) : (
                <table className="json-preview-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      {flattenedData.columns.map((column) => <th key={column}>{column}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRowsData.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        <td>{rowIndex + 1}</td>
                        {flattenedData.columns.map((column) => (
                          <td key={column}>{String(row[column] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        <div className="json-status-strip">
          <span>Size: {formatFileSize(fileSizeValue)}</span>
          <span>Rows: {rowCount.toLocaleString()}</span>
        </div>
      </section>
    );
  };

  const compareSourceActions = (
    <>
      <Tag minimal intent={isValid ? Intent.SUCCESS : Intent.DANGER} icon={isValid ? "tick-circle" : "error"}>
        {isValid ? "Valid JSON" : "Invalid JSON"}
      </Tag>
      <Button minimal small icon="path" text="Copy Path" onClick={() => handleCopyPath(selectedPath)} disabled={!isValid} />
      <Button minimal small icon="cross" text="Exit Compare" onClick={() => setCompareMode(false)} />
    </>
  );

  const compareTargetActions = compareTable ? (
    <>
      <label className="json-compare-target-select">
        <span>Compare with</span>
        <SoftSelect
          small
          value={compareTable.tableName}
          onChange={(event) => setCompareTableName(event.currentTarget.value)}
        >
          {comparisonCandidates.map((candidate) => (
            <option key={candidate.tableName} value={candidate.tableName}>
              {getFileName(candidate.filePath)}
            </option>
          ))}
        </SoftSelect>
      </label>
      <Tag minimal intent={compareIsValid ? Intent.SUCCESS : Intent.DANGER} icon={compareIsValid ? "tick-circle" : "error"}>
        {compareIsValid ? "Valid JSON" : "Invalid JSON"}
      </Tag>
      <Button minimal small icon="path" text="Copy Path" onClick={() => handleCopyPath(compareSelectedPath)} disabled={!compareIsValid} />
    </>
  ) : null;

  const jsonSplitStyle = {
    "--json-split-left": `${jsonSplitPercent}%`,
  } as React.CSSProperties;
  const copyCommandConfirmed = commandFeedback?.key === "copy";
  const minifyCommandConfirmed = commandFeedback?.key === "minify";
  const formatCommandConfirmed = commandFeedback?.key === "format";
  const wrapCommandConfirmed = commandFeedback?.key === "wrap";

  const jsonSplitDivider = (
    <div
      className="json-split-divider"
      role="separator"
      aria-label="Resize JSON panes"
      aria-orientation="vertical"
      aria-valuemin={22}
      aria-valuemax={78}
      aria-valuenow={Math.round(jsonSplitPercent)}
      tabIndex={0}
      onPointerDown={handleJsonSplitPointerDown}
      onPointerMove={handleJsonSplitPointerMove}
      onPointerUp={finishJsonSplitResize}
      onPointerCancel={finishJsonSplitResize}
      onKeyDown={handleJsonSplitKeyDown}
    />
  );

  const historyPane = (
    <section className="json-panel json-history-panel json-history-overlay">
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
  );

  const treeContextMenuElement = treeContextMenu
    ? ReactDOM.createPortal(
        <div
          ref={treeContextMenuRef}
          className="json-tree-context-menu"
          role="menu"
          style={{ left: treeContextMenu.x, top: treeContextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" onClick={() => copyTreeContextValue("key")}>
            <Icon icon="key" size={13} />
            <span>Copy key</span>
          </button>
          <button type="button" role="menuitem" onClick={() => copyTreeContextValue("value")}>
            <Icon icon="variable" size={13} />
            <span>Copy value</span>
          </button>
          <button type="button" role="menuitem" onClick={() => copyTreeContextValue("path")}>
            <Icon icon="path" size={13} />
            <span>Copy path</span>
          </button>
        </div>,
        document.body
      )
    : null;

  return (
    <div className={`json-workspace${compareMode ? " compare-enabled" : ""}`}>
      {treeContextMenuElement}
      {loadError && (
        <Callout intent={Intent.DANGER} icon="error" className="json-load-error">
          {loadError}
        </Callout>
      )}

      <div
        ref={splitContainerRef}
        className={`json-compare-layout${compareMode ? " json-comparison-layout" : " json-single-layout"}${jsonSplitResizing ? " json-split-resizing" : ""}`}
        style={jsonSplitStyle}
      >
        {compareMode ? (
          <>
            {renderStructuredDocument({
              className: "json-document-pane json-source-document json-compare-pane",
              title: fileName,
              filePath: table.filePath,
              extensionLabel: extension.toUpperCase() || "JSON",
              parsedResult: parsed,
              isValidDocument: isValid,
              lineTotal: lineCount,
              loadingDocument: loading,
              loadErrorMessage: loadError,
              fileSizeValue: fileSize,
              rowCount: table.rowCount,
              view: structuredView,
              onViewChange: setStructuredView,
              search: treeSearch,
              onSearchChange: setTreeSearch,
              selected: selectedPath,
              onSelectedChange: setSelectedPath,
              expandedPaths: expanded,
              onTogglePath: togglePath,
              flattenedData: flattened,
              previewRowsData: previewRows,
              previewTruncatedValue: previewTruncated,
              titleActions: compareSourceActions,
            })}
            {jsonSplitDivider}
            {compareTable && renderStructuredDocument({
              className: "json-document-pane json-structured-document json-compare-pane",
              title: getFileName(compareTable.filePath),
              filePath: compareTable.filePath,
              extensionLabel: compareExtension.toUpperCase() || "JSON",
              parsedResult: compareParsed,
              isValidDocument: compareIsValid,
              lineTotal: compareLineCount,
              loadingDocument: compareLoading,
              loadErrorMessage: compareLoadError,
              fileSizeValue: compareFileSize,
              rowCount: compareTable.rowCount,
              view: compareView,
              onViewChange: setCompareView,
              search: compareSearch,
              onSearchChange: setCompareSearch,
              selected: compareSelectedPath,
              onSelectedChange: setCompareSelectedPath,
              expandedPaths: compareExpanded,
              onTogglePath: toggleComparePath,
              flattenedData: compareFlattened,
              previewRowsData: comparePreviewRows,
              previewTruncatedValue: comparePreviewTruncated,
              titleActions: compareTargetActions,
            })}
          </>
        ) : (
          <>
            <section className="json-document-pane json-source-document">
              <div className="json-document-titlebar">
                <span className="json-file-name" title={table.filePath}>
                  {fileName}
                  {isDirty && <span className="json-dirty-dot" title="Unsaved changes">●</span>}
                </span>
              </div>

              <div className="json-document-subbar">
                <span className="json-source-mode-label">
                  <Icon icon="code" size={12} />
                  Text editor
                </span>
                <div className="json-icon-actions">
                  <Button minimal small icon="undo" text="Undo" onClick={handleUndo} disabled={!canUndo} />
                  <Button minimal small icon="redo" text="Redo" onClick={handleRedo} disabled={!canRedo} />
                  <Button
                    minimal
                    small
                    className={`json-command-feedback-button${copyCommandConfirmed ? " is-confirmed" : ""}`}
                    icon={copyCommandConfirmed ? "tick" : "clipboard"}
                    intent={copyCommandConfirmed ? Intent.SUCCESS : undefined}
                    text={copyCommandConfirmed ? commandFeedback.label : "Copy JSON"}
                    onClick={handleCopySource}
                    disabled={!rawText}
                  />
                  <Button
                    minimal
                    small
                    className={`json-command-feedback-button${minifyCommandConfirmed ? " is-confirmed" : ""}`}
                    icon={minifyCommandConfirmed ? "tick" : "minimize"}
                    intent={minifyCommandConfirmed ? Intent.SUCCESS : undefined}
                    text={minifyCommandConfirmed ? commandFeedback.label : "Minify"}
                    onClick={handleMinify}
                    disabled={!isValid}
                  />
                  <Button
                    minimal
                    small
                    className={`json-command-feedback-button${formatCommandConfirmed ? " is-confirmed" : ""}`}
                    icon={formatCommandConfirmed ? "tick" : "align-left"}
                    intent={formatCommandConfirmed ? Intent.SUCCESS : undefined}
                    text={formatCommandConfirmed ? commandFeedback.label : "Format"}
                    onClick={handleFormat}
                    disabled={!isValid}
                  />
                  <Button
                    minimal
                    small
                    className={`json-command-feedback-button${wrapCommandConfirmed ? " is-confirmed" : ""}`}
                    icon={wrapCommandConfirmed ? "tick" : "align-justify"}
                    intent={wrapCommandConfirmed ? Intent.SUCCESS : undefined}
                    text={wrapCommandConfirmed ? commandFeedback.label : "Wrap"}
                    active={wrapEditorContent}
                    onClick={handleToggleWrap}
                  />
                </div>
              </div>

              <div className="json-document-body">
                <div className={`json-editor${parsed.error ? " has-error" : ""}${wrapEditorContent ? " is-wrapped" : ""}`}>
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
                    wrap={wrapEditorContent ? "soft" : "off"}
                    onChange={handleRawChange}
                    onScroll={(event) => setRawScrollTop(event.currentTarget.scrollTop)}
                  />
                </div>

                <div className={`json-editor-status${parsed.error ? " error" : ""}`}>
                  {parsed.error ? (
                    <>
                      <Icon icon="error" size={13} />
                      <span>Invalid JSON: {parsed.error}</span>
                    </>
                  ) : (
                    <>
                      <Icon icon="tick-circle" size={13} />
                      <span>{statusMessage || "Valid JSON"}</span>
                    </>
                  )}
                </div>

              </div>
            </section>

            {jsonSplitDivider}
            {renderStructuredDocument({
              className: "json-document-pane json-structured-document",
              title: "Parsed view",
              filePath: table.filePath,
              extensionLabel: extension.toUpperCase() || "JSON",
              parsedResult: parsed,
              isValidDocument: isValid,
              lineTotal: lineCount,
              loadingDocument: loading,
              loadErrorMessage: loadError,
              fileSizeValue: fileSize,
              rowCount: table.rowCount,
              view: structuredView,
              onViewChange: setStructuredView,
              search: treeSearch,
              onSearchChange: setTreeSearch,
              selected: selectedPath,
              onSelectedChange: setSelectedPath,
              expandedPaths: expanded,
              onTogglePath: togglePath,
              flattenedData: flattened,
              previewRowsData: previewRows,
              previewTruncatedValue: previewTruncated,
            })}
            {historyPanelOpen && historyPane}
          </>
        )}
      </div>
    </div>
  );
}
