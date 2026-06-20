import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const RAW_EDITOR_LINE_HEIGHT = 22;

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

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function flattenPathForLabel(path: string): string {
  return path.replace(/\[(\d+)\]/g, ".$1").replace(/^\$\./, "");
}

function nodeMatches(value: JsonValue, name: string, path: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (name.toLowerCase().includes(q) || path.toLowerCase().includes(q)) return true;
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
  const type = getJsonType(value);
  const scalar = formatJsonScalar(value);
  const isSelected = selectedPath === path;

  let children: React.ReactNode = null;
  if (expandable && isExpanded) {
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
        onClick={() => onSelect(path)}
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
            aria-label={isExpanded ? "Collapse JSON node" : "Expand JSON node"}
          >
            <Icon icon={isExpanded ? "chevron-down" : "chevron-right"} size={12} />
          </button>
        ) : (
          <span className="json-tree-toggle-spacer" />
        )}
        <span className={`json-tree-kind json-tree-kind-${type}`}>
          {type === "array" ? "[]" : type === "object" ? "{}" : type === "string" ? "ABC" : type === "number" ? "123" : type === "boolean" ? "BOOL" : "NULL"}
        </span>
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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["$", "$.customers", "$.customers[0]"]));
  const [rawScrollTop, setRawScrollTop] = useState(0);
  const [flattenOptions, setFlattenOptions] = useState<FlattenOptions>({
    arrayMode: "unwind",
    delimiter: ".",
    includeArrayIndex: false,
  });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [editorSyncKey, setEditorSyncKey] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);

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
  const lineCount = useMemo(() => rawText.split(/\r\n|\r|\n/).length, [rawText]);
  const lineNumbers = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1), [lineCount]);
  const editorContentHeight = Math.max(120, lineCount * RAW_EDITOR_LINE_HEIGHT + 16);
  const editorContentWidth = useMemo(() => {
    const maxLineLength = rawText
      .split(/\r\n|\r|\n/)
      .reduce((max, line) => Math.max(max, line.length), 0);
    return Math.min(32000, Math.max(760, maxLineLength * 8 + 40));
  }, [rawText]);

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
        setEditorSyncKey((key) => key + 1);
        setFileSize(new Blob([text]).size);
        setSelectedPath("$");
        setExpanded(new Set(["$", "$.customers", "$.customers[0]"]));
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

  useEffect(() => {
    const code = codeRef.current;
    if (!code) return;
    if (code.textContent !== rawText) {
      code.textContent = rawText;
    }
  }, [editorSyncKey, rawText]);

  useEffect(() => {
    const editor = editorRef.current;
    const scrollEl = editorScrollRef.current;
    const code = codeRef.current;
    if (!editor || !scrollEl || !code) return;

    const onWheel = (event: WheelEvent) => {
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? RAW_EDITOR_LINE_HEIGHT
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? scrollEl.clientHeight
          : 1;
      const nextTop = scrollEl.scrollTop + event.deltaY * multiplier;
      const nextLeft = scrollEl.scrollLeft + event.deltaX * multiplier;
      const maxTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      const maxLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);

      scrollEl.scrollTop = Math.min(maxTop, Math.max(0, nextTop));
      scrollEl.scrollLeft = Math.min(maxLeft, Math.max(0, nextLeft));
      setRawScrollTop(scrollEl.scrollTop);

      event.preventDefault();
      event.stopPropagation();
    };

    editor.addEventListener("wheel", onWheel, { passive: false });
    code.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      editor.removeEventListener("wheel", onWheel);
      code.removeEventListener("wheel", onWheel);
    };
  }, [rawText]);

  const togglePath = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleFormat = useCallback(() => {
    if (!isValid) return;
    setRawText(JSON.stringify(parsed.value, null, 2));
    setEditorSyncKey((key) => key + 1);
    setStatusMessage("Formatted JSON");
  }, [isValid, parsed.value]);

  const handleMinify = useCallback(() => {
    if (!isValid) return;
    setRawText(JSON.stringify(parsed.value));
    setEditorSyncKey((key) => key + 1);
    setStatusMessage("Minified JSON");
  }, [isValid, parsed.value]);

  const handleRawInput = useCallback((event: React.FormEvent<HTMLDivElement>) => {
    setRawText(event.currentTarget.textContent ?? "");
  }, []);

  const handleRawPaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }, []);

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

  const selectedLabel = flattenPathForLabel(selectedPath) || "$";

  return (
    <div className="json-workspace">
      <div className="json-file-tabbar">
        <div className="json-file-tab active">
          <Icon icon="code" size={14} />
          <span>{fileName}</span>
          {isDirty && <Tag minimal intent={Intent.WARNING}>Edited</Tag>}
        </div>
      </div>

      <div className="json-toolbar">
        <div className="json-toolbar-actions">
          <Button icon="folder-open" text="Open JSON" onClick={onOpenFiles} />
          <Button icon="floppy-disk" text="Save" onClick={handleSave} disabled={!isDirty || !isValid || saving} loading={saving} />
          <Button icon="align-left" text="Format" onClick={handleFormat} disabled={!isValid} />
          <Button icon="minimize" text="Minify" onClick={handleMinify} disabled={!isValid} />
          <Button icon="tick-circle" text="Validate" intent={isValid ? Intent.SUCCESS : Intent.DANGER} onClick={() => setStatusMessage(isValid ? "Valid JSON" : "Invalid JSON")} />
          <Button icon="th" text="Flatten" disabled={!isValid} onClick={() => setStatusMessage(`${flattened.rows.length.toLocaleString()} rows ready`)} />
          <Button icon={exporting ? <Spinner size={14} /> : "export"} text="Export CSV" intent={Intent.PRIMARY} disabled={!isValid || flattened.rows.length === 0 || exporting} onClick={handleExportCsv} />
        </div>
        <Tag minimal intent={isValid ? Intent.SUCCESS : Intent.DANGER} icon={isValid ? "tick-circle" : "error"}>
          {isValid ? "Valid JSON" : "Invalid JSON"}
        </Tag>
      </div>

      {loadError && (
        <Callout intent={Intent.DANGER} icon="error" className="json-load-error">
          {loadError}
        </Callout>
      )}

      <div className="json-main">
        <section className="json-panel json-tree-panel">
          <div className="json-panel-header">
            <strong>JSON Tree</strong>
            <button type="button" className="json-panel-collapse" aria-label="Collapse JSON tree">
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
          <div className="json-tree-column-header" aria-hidden="true">
            <span />
            <span />
            <span>Key</span>
            <span>Value</span>
            <span>Type</span>
          </div>
          <div className="json-tree-scroll">
            {loading && <div className="json-loading"><Spinner size={18} /> Loading JSON...</div>}
            {!loading && isValid && (
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
          <div className="json-panel-footer">
            <span>Path: {selectedPath}</span>
            <span>{flattened.rows.length.toLocaleString()} rows</span>
          </div>
        </section>

        <section className="json-panel json-editor-panel">
          <div className="json-panel-header">
            <strong>Raw Editor</strong>
            <span className="json-editor-meta">
              Scroll pane | Ln {lineCount.toLocaleString()} | UTF-8 | {extension.toUpperCase() || "JSON"}
            </span>
          </div>
          <div className={`json-editor${parsed.error ? " has-error" : ""}`} ref={editorRef}>
            <div className="json-line-numbers" style={{ transform: `translateY(-${rawScrollTop}px)` }}>
              {lineNumbers.map((n) => <span key={n}>{n}</span>)}
            </div>
            <div
              className="json-editor-scroll"
              ref={editorScrollRef}
              onScroll={(event) => setRawScrollTop(event.currentTarget.scrollTop)}
            >
              <div
                ref={codeRef}
                className="json-code-input"
                contentEditable="plaintext-only"
                suppressContentEditableWarning
                role="textbox"
                aria-label="Raw JSON editor"
                spellCheck={false}
                tabIndex={0}
                style={{
                  minHeight: editorContentHeight,
                  width: editorContentWidth,
                }}
                onInput={handleRawInput}
                onPaste={handleRawPaste}
              />
            </div>
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
      </div>

      <div className="json-flatten-panel">
        <div className="json-flatten-header">
          <div>
            <strong>Flatten Preview</strong>
            <span>{flattened.rows.length.toLocaleString()} rows | {flattened.columns.length.toLocaleString()} columns | {flattened.recordPath}</span>
          </div>
          <div className="json-flatten-options">
            <label>
              <span>Array mode:</span>
              <HTMLSelect
                value={flattenOptions.arrayMode}
                onChange={(event) => setFlattenOptions((prev) => ({ ...prev, arrayMode: event.currentTarget.value as FlattenOptions["arrayMode"] }))}
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
                onChange={(event) => setFlattenOptions((prev) => ({ ...prev, delimiter: event.currentTarget.value || "." }))}
              />
            </label>
            <Switch
              checked={flattenOptions.includeArrayIndex}
              label="Include array index"
              onChange={(event) => setFlattenOptions((prev) => ({ ...prev, includeArrayIndex: (event.currentTarget as HTMLInputElement).checked }))}
            />
          </div>
        </div>
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
        <div className="json-status-strip">
          <span>File: {fileName}</span>
          <span>Size: {formatFileSize(fileSize)}</span>
          <span>Rows: {table.rowCount.toLocaleString()}</span>
          <span>Flattened: {flattened.rows.length.toLocaleString()} x {flattened.columns.length.toLocaleString()}</span>
          <span>Validation: {isValid ? "Valid" : "Invalid"}</span>
          <span>Mode: JSON</span>
        </div>
      </div>
    </div>
  );
}
