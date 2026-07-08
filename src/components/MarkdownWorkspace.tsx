import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, Icon, Intent } from "@blueprintjs/core";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { DocumentWorkspaceFileActions, LoadedTable } from "../types";

interface MarkdownWorkspaceProps {
  table: LoadedTable;
  onOpenFiles: () => void;
  onReloadTable: () => void;
  onFileActionsChange?: (actions: DocumentWorkspaceFileActions | null) => void;
}

interface MarkdownHeading {
  id: string;
  level: number;
  text: string;
  line: number;
}

interface MarkdownHistoryEntry {
  id: number;
  label: string;
  text: string;
  timestamp: number;
}

function getFileExtension(filePath: string): string {
  return filePath.split(".").pop()?.toUpperCase() || "MD";
}

function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function extractHeadings(text: string): MarkdownHeading[] {
  const counts = new Map<string, number>();
  return text.split(/\r\n|\r|\n/).flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) return [];

    const plainText = match[2].replace(/[`*_~[\]()]/g, "").trim();
    if (!plainText) return [];

    const base = slugify(plainText);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);

    return [{
      id: count === 0 ? base : `${base}-${count + 1}`,
      level: match[1].length,
      text: plainText,
      line: index + 1,
    }];
  });
}

function countWords(text: string): number {
  const stripped = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[#>*_[\]()`~-]/g, " ");
  return stripped.trim().split(/\s+/).filter(Boolean).length;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function collectText(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (React.isValidElement<{ children?: React.ReactNode }>(child)) return collectText(child.props.children);
      return "";
    })
    .join("");
}

function buildHeadingIdQueues(headings: MarkdownHeading[]): Map<string, string[]> {
  const queues = new Map<string, string[]>();
  for (const heading of headings) {
    const key = `${heading.level}:${heading.text}`;
    queues.set(key, [...(queues.get(key) ?? []), heading.id]);
  }
  return queues;
}

function MarkdownPreview({ text, headings }: { text: string; headings: MarkdownHeading[] }): React.ReactElement {
  const headingIdQueues = buildHeadingIdQueues(headings);
  const makeHeading = (TagName: keyof JSX.IntrinsicElements, level: number) => {
    return ({ children, ...props }: any) => {
      const label = collectText(children).replace(/\s+/g, " ").trim();
      const key = `${level}:${label}`;
      const queue = headingIdQueues.get(key);
      const id = queue && queue.length > 0 ? queue.shift() : slugify(label);
      return <TagName id={id} {...props}>{children}</TagName>;
    };
  };

  if (!text.trim()) {
    return (
      <div className="markdown-empty">
        <Icon icon="document" size={18} />
      </div>
    );
  }

  return (
    <ReactMarkdown
      rehypePlugins={[rehypeRaw, [rehypeSanitize, defaultSchema]]}
      remarkPlugins={[remarkGfm]}
      components={{
        h1: makeHeading("h1", 1),
        h2: makeHeading("h2", 2),
        h3: makeHeading("h3", 3),
        h4: makeHeading("h4", 4),
        h5: makeHeading("h5", 5),
        h6: makeHeading("h6", 6),
        a: ({ href, children, ...props }) => (
          <a
            href={href}
            {...props}
            onClick={(event) => {
              if (!href || !/^https?:\/\//i.test(href)) return;
              event.preventDefault();
              void window.api.openExternal(href);
            }}
          >
            {children}
          </a>
        ),
        table: ({ children, ...props }) => (
          <div className="markdown-table-scroll">
            <table {...props}>{children}</table>
          </div>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export function MarkdownWorkspace({
  table,
  onOpenFiles,
  onReloadTable,
  onFileActionsChange,
}: MarkdownWorkspaceProps): React.ReactElement {
  const [rawText, setRawText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<MarkdownHistoryEntry[]>([]);
  const [rawScrollTop, setRawScrollTop] = useState(0);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const nextHistoryId = useRef(1);
  const previewScrollRef = useRef<HTMLDivElement>(null);

  const extension = getFileExtension(table.filePath);
  const isDirty = rawText !== savedText;
  const lineCount = rawText.length === 0 ? 0 : rawText.split(/\r\n|\r|\n/).length;
  const wordCount = useMemo(() => countWords(rawText), [rawText]);
  const headings = useMemo(() => extractHeadings(rawText), [rawText]);
  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(lineCount, 1) }, (_, index) => index + 1),
    [lineCount]
  );

  useEffect(() => {
    if (headings.length === 0) {
      setActiveHeadingId(null);
      return;
    }
    setActiveHeadingId((current) =>
      current && headings.some((heading) => heading.id === current)
        ? current
        : headings[0].id
    );
  }, [headings]);

  useEffect(() => {
    const root = previewScrollRef.current;
    if (!root || headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) {
          setActiveHeadingId(visible.target.id);
        }
      },
      { root, rootMargin: "0px 0px -72% 0px", threshold: 0.01 }
    );

    for (const heading of headings) {
      const element = document.getElementById(heading.id);
      if (element) observer.observe(element);
    }

    return () => observer.disconnect();
  }, [headings, rawText]);

  const pushHistory = useCallback((label: string, text: string) => {
    setHistory((prev) => [
      {
        id: nextHistoryId.current++,
        label,
        text,
        timestamp: Date.now(),
      },
      ...prev,
    ].slice(0, 50));
  }, []);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setLoadError(null);
    setIsEditing(false);
    setHistoryOpen(false);

    window.api.readTextFile(table.filePath)
      .then((text) => {
        if (disposed) return;
        setRawText(text);
        setSavedText(text);
        nextHistoryId.current = 2;
        setHistory([{ id: 1, label: "Opened", text, timestamp: Date.now() }]);
      })
      .catch((err) => {
        if (disposed) return;
        setLoadError(String(err));
        setRawText("");
        setSavedText("");
        setHistory([]);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [table.filePath, table.reloadVersion]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await window.api.writeTextFile(table.filePath, rawText);
      setSavedText(rawText);
      pushHistory("Saved", rawText);
      onReloadTable();
    } finally {
      setSaving(false);
    }
  }, [onReloadTable, pushHistory, rawText, table.filePath]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const path = await window.api.saveFileDialog(extension.toLowerCase() === "markdown" ? "markdown" : "md");
      if (!path) return;
      await window.api.writeTextFile(path, rawText);
      pushHistory("Exported copy", rawText);
    } finally {
      setExporting(false);
    }
  }, [extension, pushHistory, rawText]);

  const handleRevert = useCallback(() => {
    setRawText(savedText);
    setIsEditing(false);
    pushHistory("Reverted", savedText);
  }, [pushHistory, savedText]);

  const handleRestoreHistory = useCallback((entry: MarkdownHistoryEntry) => {
    setRawText(entry.text);
    setIsEditing(true);
    setHistoryOpen(false);
    pushHistory(`Restored ${entry.label.toLowerCase()}`, entry.text);
  }, [pushHistory]);

  const scrollToHeading = useCallback((id: string) => {
    const element = document.getElementById(id);
    if (!element) return;
    setActiveHeadingId(id);
    element.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  useEffect(() => () => {
    onFileActionsChange?.(null);
  }, [onFileActionsChange]);

  useEffect(() => {
    const documentReady = !loading && !loadError;
    onFileActionsChange?.({
      workspaceKind: "markdown",
      isDirty,
      isValid: documentReady,
      saving,
      exporting,
      canExport: documentReady && !exporting,
      historyOpen,
      onOpenFiles,
      onSave: handleSave,
      onRevert: handleRevert,
      onToggleHistory: () => setHistoryOpen((open) => !open),
      onExport: handleExport,
      exportLabel: "Export",
      exportTitle: "Export Markdown copy",
      exportDisabledReason: loadError ? "Resolve the load error before exporting." : loading ? "Markdown is still loading." : null,
      onToggleEdit: () => setIsEditing((editing) => !editing),
      editActive: isEditing,
      editLabel: isEditing ? "Done" : "Edit",
    });
  }, [
    exporting,
    handleExport,
    handleRevert,
    handleSave,
    historyOpen,
    isDirty,
    isEditing,
    loadError,
    loading,
    onFileActionsChange,
    onOpenFiles,
    saving,
  ]);

  const historyPanel = historyOpen ? (
    <aside className="markdown-history-panel">
      <div className="markdown-history-header">
        <strong>History</strong>
        <Button minimal small icon="cross" onClick={() => setHistoryOpen(false)} title="Close history" />
      </div>
      <div className="markdown-history-scroll">
        {history.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="markdown-history-row"
            onClick={() => handleRestoreHistory(entry)}
          >
            <Icon icon="time" size={12} />
            <span>{entry.label}</span>
            <time>{formatTime(entry.timestamp)}</time>
          </button>
        ))}
      </div>
    </aside>
  ) : null;

  return (
    <div className={`markdown-workspace${isEditing ? " is-editing" : ""}`}>
      {loadError && (
        <Callout intent={Intent.DANGER} icon="error" className="markdown-load-error">
          {loadError}
        </Callout>
      )}

      <div className={`markdown-layout${isEditing ? " editing" : ""}`}>
        {isEditing && (
          <>
            <section className="markdown-editor-pane">
              <div className="markdown-pane-header">
                <strong>Source</strong>
                <span>{lineCount.toLocaleString()} lines</span>
              </div>
              <div className="json-editor markdown-source-editor">
                <div className="json-line-numbers">
                  <div className="json-line-numbers-inner" style={{ transform: `translateY(-${rawScrollTop}px)` }}>
                    {lineNumbers.map((n) => <span key={n}>{n}</span>)}
                  </div>
                </div>
                <textarea
                  className="json-code-input"
                  value={rawText}
                  aria-label="Markdown source editor"
                  spellCheck={false}
                  wrap="off"
                  onChange={(event) => setRawText(event.currentTarget.value)}
                  onScroll={(event) => setRawScrollTop(event.currentTarget.scrollTop)}
                />
              </div>
            </section>
            <div className="markdown-edit-divider" aria-hidden="true" />
          </>
        )}

        <section className="markdown-preview-pane">
          <div className="markdown-preview-scroll" ref={previewScrollRef}>
            {loading ? (
              <div className="markdown-empty">
                <Icon icon="refresh" size={18} />
              </div>
            ) : (
              <article className="markdown-rendered">
                <MarkdownPreview text={rawText} headings={headings} />
              </article>
            )}
          </div>
        </section>

        <aside className="markdown-outline">
          <div className="markdown-outline-header">
            <strong>Outline</strong>
            <span>{headings.length.toLocaleString()}</span>
          </div>
          <div className="markdown-outline-scroll">
            {headings.length === 0 ? (
              <div className="markdown-outline-empty" aria-label="No headings" />
            ) : (
              headings.map((heading) => (
                <button
                  key={heading.id}
                  type="button"
                  className={`markdown-outline-row level-${Math.min(heading.level, 4)}${heading.id === activeHeadingId ? " active" : ""}`}
                  onClick={() => scrollToHeading(heading.id)}
                  title={heading.text}
                >
                  <span>{heading.text}</span>
                  <em>{heading.line}</em>
                </button>
              ))
            )}
          </div>
          <div className="markdown-outline-footer">
            {headings.length.toLocaleString()} headings
          </div>
        </aside>
        {historyPanel}
      </div>

      <div className="markdown-status-strip">
        <span>
          <Icon icon={isDirty ? "edit" : "tick-circle"} size={13} />
          {isDirty ? "Unsaved" : "Saved"}
        </span>
        <span>{wordCount.toLocaleString()} words</span>
        <span>{lineCount.toLocaleString()} lines</span>
        <span>{headings.length.toLocaleString()} headings</span>
      </div>
    </div>
  );
}
