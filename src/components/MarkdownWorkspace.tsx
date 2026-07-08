import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, Icon, Intent } from "@blueprintjs/core";
import { convertFileSrc } from "@tauri-apps/api/core";
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

const markdownSanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: Array.from(new Set([...(defaultSchema.protocols?.src ?? []), "data", "blob", "asset", "file"])),
  },
};

const WEB_IMAGE_SRC_PATTERN = /^(?:https?:|data:|blob:|asset:|tauri:)/i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;
const MARKDOWN_SPLIT_DIVIDER_PX = 8;
const MARKDOWN_SPLIT_EDITOR_MIN_PX = 240;
const MARKDOWN_SPLIT_PREVIEW_MIN_PX = 280;
const MARKDOWN_SPLIT_KEY_STEP = 4;
const MARKDOWN_SPLIT_MIN_PERCENT = 22;
const MARKDOWN_SPLIT_MAX_PERCENT = 78;
const MARKDOWN_DEFAULT_ZOOM = 1;
const MARKDOWN_ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const MARKDOWN_BODY_FONT_SIZE_PX = 14.5;
const MARKDOWN_H1_FONT_SIZE_PX = 28;
const MARKDOWN_H2_FONT_SIZE_PX = 18;
const MARKDOWN_H3_FONT_SIZE_PX = 15;
const MARKDOWN_SMALL_HEADING_FONT_SIZE_PX = 13;
const MARKDOWN_CODE_FONT_SIZE_PX = 12;
const MARKDOWN_TABLE_FONT_SIZE_PX = 13;
const MARKDOWN_WHEEL_ZOOM_THROTTLE_MS = 80;

function getFileExtension(filePath: string): string {
  return filePath.split(".").pop()?.toUpperCase() || "MD";
}

function getFileDirectory(filePath: string): string {
  const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return separatorIndex >= 0 ? filePath.slice(0, separatorIndex) : "";
}

function splitPathSuffix(src: string): { path: string; suffix: string } {
  const suffixIndex = src.search(/[?#]/);
  return suffixIndex === -1
    ? { path: src, suffix: "" }
    : { path: src.slice(0, suffixIndex), suffix: src.slice(suffixIndex) };
}

function safeDecodePath(filePath: string): string {
  try {
    return decodeURI(filePath);
  } catch {
    return filePath;
  }
}

function fileUrlToPath(src: string): string {
  try {
    const url = new URL(src);
    const decodedPath = decodeURIComponent(url.pathname);
    if (url.hostname) return `//${url.hostname}${decodedPath}`;
    return /^\/[a-zA-Z]:/.test(decodedPath) ? decodedPath.slice(1) : decodedPath;
  } catch {
    return src;
  }
}

function isAbsoluteLocalPath(filePath: string): boolean {
  return filePath.startsWith("/") || filePath.startsWith("\\\\") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(filePath);
}

function normalizeLocalPath(filePath: string): string {
  const useBackslash = filePath.includes("\\") && !filePath.includes("/");
  const normalized = filePath.replace(/\\/g, "/");
  const drive = /^[a-zA-Z]:/.exec(normalized)?.[0] ?? "";
  const isUnc = normalized.startsWith("//");
  const isRooted = normalized.startsWith("/");
  const prefix = drive ? `${drive}/` : isUnc ? "//" : isRooted ? "/" : "";
  const rest = drive
    ? normalized.slice(drive.length).replace(/^\/+/, "")
    : isUnc
      ? normalized.slice(2)
      : normalized.replace(/^\/+/, "");
  const parts: string[] = [];

  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!prefix) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }

  const path = `${prefix}${parts.join("/")}`;
  return useBackslash ? path.replace(/\//g, "\\") : path;
}

function resolveLocalImagePath(markdownFilePath: string, imagePath: string): string {
  const localPath = /^file:/i.test(imagePath) ? fileUrlToPath(imagePath) : safeDecodePath(imagePath);
  if (isAbsoluteLocalPath(localPath)) return normalizeLocalPath(localPath);

  const directory = getFileDirectory(markdownFilePath);
  if (!directory) return normalizeLocalPath(localPath);

  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  const joined = `${directory}${directory.endsWith("/") || directory.endsWith("\\") ? "" : separator}${localPath}`;
  return normalizeLocalPath(joined);
}

function canConvertFileSrc(): boolean {
  return typeof (window as any).__TAURI_INTERNALS__?.convertFileSrc === "function";
}

function resolveMarkdownImageSrc(src: string | undefined, markdownFilePath: string): string | undefined {
  if (!src) return src;

  const trimmed = src.trim();
  if (!trimmed || WEB_IMAGE_SRC_PATTERN.test(trimmed) || trimmed.startsWith("//")) return src;
  if (!canConvertFileSrc()) return src;

  const { path, suffix } = splitPathSuffix(trimmed);
  if (!path) return src;

  const localPath = resolveLocalImagePath(markdownFilePath, path);
  return `${convertFileSrc(localPath)}${suffix}`;
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

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform);
}

function getMarkdownShortcutModifierLabel(): string {
  return isApplePlatform() ? "Cmd" : "Ctrl";
}

function hasPlatformZoomModifier(event: KeyboardEvent): boolean {
  return isApplePlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

function hasWheelZoomModifier(event: WheelEvent): boolean {
  if (event.altKey) return false;
  if (event.ctrlKey && !event.metaKey) return true;
  return isApplePlatform() ? event.metaKey && !event.ctrlKey : false;
}

function getMarkdownZoomShortcutAction(event: KeyboardEvent): "in" | "out" | "reset" | null {
  if (event.altKey || !hasPlatformZoomModifier(event)) return null;

  const key = event.key.toLowerCase();
  if (key === "+" || key === "=" || event.code === "Equal" || event.code === "NumpadAdd") {
    return "in";
  }
  if (key === "-" || key === "_" || event.code === "Minus" || event.code === "NumpadSubtract") {
    return "out";
  }
  if (!event.shiftKey && (key === "0" || event.code === "Digit0" || event.code === "Numpad0")) {
    return "reset";
  }
  return null;
}

function getMarkdownWheelZoomDirection(event: WheelEvent): 1 | -1 | null {
  if (!hasWheelZoomModifier(event)) return null;
  if (event.deltaY < 0) return 1;
  if (event.deltaY > 0) return -1;
  return null;
}

function getNextMarkdownZoom(currentZoom: number, direction: 1 | -1): number {
  if (direction > 0) {
    return MARKDOWN_ZOOM_LEVELS.find((level) => level > currentZoom + 0.001) ?? currentZoom;
  }

  for (let i = MARKDOWN_ZOOM_LEVELS.length - 1; i >= 0; i--) {
    if (MARKDOWN_ZOOM_LEVELS[i] < currentZoom - 0.001) return MARKDOWN_ZOOM_LEVELS[i];
  }
  return currentZoom;
}

function formatMarkdownZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
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

const MarkdownPreview = React.memo(function MarkdownPreview({
  text,
  headings,
  filePath,
}: {
  text: string;
  headings: MarkdownHeading[];
  filePath: string;
}): React.ReactElement {
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
      rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
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
        img: ({ src, alt, ...props }) => (
          <img
            src={resolveMarkdownImageSrc(src, filePath)}
            alt={alt ?? ""}
            loading="lazy"
            {...props}
          />
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
});

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
  const [markdownSplitPercent, setMarkdownSplitPercent] = useState(34);
  const [markdownSplitResizing, setMarkdownSplitResizing] = useState(false);
  const [markdownZoom, setMarkdownZoom] = useState(MARKDOWN_DEFAULT_ZOOM);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const nextHistoryId = useRef(1);
  const markdownLayoutRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const lineNumbersInnerRef = useRef<HTMLDivElement>(null);
  const lineNumberScrollTopRef = useRef(0);
  const lineNumberScrollFrameRef = useRef<number | null>(null);
  const splitPointerIdRef = useRef<number | null>(null);
  const wheelZoomLastAtRef = useRef(0);

  const extension = getFileExtension(table.filePath);
  const isDirty = rawText !== savedText;
  const lineCount = rawText.length === 0 ? 0 : rawText.split(/\r\n|\r|\n/).length;
  const wordCount = useMemo(() => countWords(rawText), [rawText]);
  const deferredRawText = useDeferredValue(rawText);
  const previewText = isEditing ? deferredRawText : rawText;
  const headings = useMemo(() => extractHeadings(previewText), [previewText]);
  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(lineCount, 1) }, (_, index) => index + 1),
    [lineCount]
  );
  const markdownZoomPercent = formatMarkdownZoom(markdownZoom);
  const markdownZoomAdjusted = markdownZoom !== MARKDOWN_DEFAULT_ZOOM;
  const markdownZoomStatus = markdownZoom > MARKDOWN_DEFAULT_ZOOM
    ? `Zoomed in ${markdownZoomPercent}`
    : markdownZoom < MARKDOWN_DEFAULT_ZOOM
      ? `Zoomed out ${markdownZoomPercent}`
      : `Zoom ${markdownZoomPercent}`;
  const markdownZoomIcon = markdownZoom > MARKDOWN_DEFAULT_ZOOM
    ? "zoom-in"
    : markdownZoom < MARKDOWN_DEFAULT_ZOOM
      ? "zoom-out"
      : "search";
  const markdownZoomShortcutModifier = useMemo(() => getMarkdownShortcutModifierLabel(), []);
  const zoomInTitle = `Zoom in (${markdownZoomShortcutModifier}+Plus, ${markdownZoomShortcutModifier}+=, or ${markdownZoomShortcutModifier}+scroll up)`;
  const zoomOutTitle = `Zoom out (${markdownZoomShortcutModifier}+Minus or ${markdownZoomShortcutModifier}+scroll down)`;
  const resetZoomTitle = `Reset zoom (${markdownZoomShortcutModifier}+0)`;
  const canZoomIn = markdownZoom < MARKDOWN_ZOOM_LEVELS[MARKDOWN_ZOOM_LEVELS.length - 1];
  const canZoomOut = markdownZoom > MARKDOWN_ZOOM_LEVELS[0];

  const updateLineNumbersScroll = useCallback((scrollTop: number) => {
    lineNumberScrollTopRef.current = scrollTop;
    if (lineNumberScrollFrameRef.current !== null) return;

    lineNumberScrollFrameRef.current = window.requestAnimationFrame(() => {
      lineNumberScrollFrameRef.current = null;
      if (lineNumbersInnerRef.current) {
        lineNumbersInnerRef.current.style.transform = `translateY(-${lineNumberScrollTopRef.current}px)`;
      }
    });
  }, []);

  useEffect(() => () => {
    if (lineNumberScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(lineNumberScrollFrameRef.current);
    }
  }, []);

  useEffect(() => {
    lineNumberScrollTopRef.current = 0;
    if (lineNumbersInnerRef.current) {
      lineNumbersInnerRef.current.style.transform = "translateY(0px)";
    }
  }, [isEditing, table.filePath, table.reloadVersion]);

  useEffect(() => {
    if (!markdownSplitResizing) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [markdownSplitResizing]);

  const getMarkdownSplitBounds = useCallback(() => {
    const container = markdownLayoutRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return null;

    const outline = container.querySelector<HTMLElement>(".markdown-outline");
    const outlineWidth = outline && window.getComputedStyle(outline).display !== "none"
      ? outline.getBoundingClientRect().width
      : 0;
    const availableMaxLeftPx = rect.width - MARKDOWN_SPLIT_DIVIDER_PX - outlineWidth - MARKDOWN_SPLIT_PREVIEW_MIN_PX;
    const minLeftPx = Math.min(MARKDOWN_SPLIT_EDITOR_MIN_PX, Math.max(0, availableMaxLeftPx));
    const maxLeftPx = Math.max(minLeftPx, availableMaxLeftPx);

    return { rect, minLeftPx, maxLeftPx };
  }, []);

  const updateMarkdownSplitFromPointer = useCallback((clientX: number) => {
    const bounds = getMarkdownSplitBounds();
    if (!bounds) return;

    const leftPx = Math.min(
      bounds.maxLeftPx,
      Math.max(bounds.minLeftPx, clientX - bounds.rect.left)
    );
    setMarkdownSplitPercent((leftPx / bounds.rect.width) * 100);
  }, [getMarkdownSplitBounds]);

  const finishMarkdownSplitResize = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    if (event && splitPointerIdRef.current !== event.pointerId) return;
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    splitPointerIdRef.current = null;
    setMarkdownSplitResizing(false);
  }, []);

  const handleMarkdownSplitPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    splitPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setMarkdownSplitResizing(true);
    updateMarkdownSplitFromPointer(event.clientX);
  }, [updateMarkdownSplitFromPointer]);

  const handleMarkdownSplitPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (splitPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    updateMarkdownSplitFromPointer(event.clientX);
  }, [updateMarkdownSplitFromPointer]);

  const handleMarkdownSplitKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();

    const direction = event.key === "ArrowLeft" ? -1 : 1;
    setMarkdownSplitPercent((prev) => {
      const target = prev + direction * MARKDOWN_SPLIT_KEY_STEP;
      const bounds = getMarkdownSplitBounds();
      if (!bounds) {
        return Math.min(MARKDOWN_SPLIT_MAX_PERCENT, Math.max(MARKDOWN_SPLIT_MIN_PERCENT, target));
      }

      const targetPx = (target / 100) * bounds.rect.width;
      const clampedPx = Math.min(bounds.maxLeftPx, Math.max(bounds.minLeftPx, targetPx));
      return (clampedPx / bounds.rect.width) * 100;
    });
  }, [getMarkdownSplitBounds]);

  const handleZoomIn = useCallback(() => {
    setMarkdownZoom((currentZoom) => getNextMarkdownZoom(currentZoom, 1));
  }, []);

  const handleZoomOut = useCallback(() => {
    setMarkdownZoom((currentZoom) => getNextMarkdownZoom(currentZoom, -1));
  }, []);

  const handleResetZoom = useCallback(() => {
    setMarkdownZoom(MARKDOWN_DEFAULT_ZOOM);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = getMarkdownZoomShortcutAction(event);
      if (!action) return;

      event.preventDefault();
      if (action === "in") {
        handleZoomIn();
      } else if (action === "out") {
        handleZoomOut();
      } else {
        handleResetZoom();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleResetZoom, handleZoomIn, handleZoomOut]);

  useEffect(() => {
    const layout = markdownLayoutRef.current;
    if (!layout) return;

    const handleWheel = (event: WheelEvent) => {
      const direction = getMarkdownWheelZoomDirection(event);
      if (!direction) return;

      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      if (now - wheelZoomLastAtRef.current < MARKDOWN_WHEEL_ZOOM_THROTTLE_MS) return;
      wheelZoomLastAtRef.current = now;

      if (direction > 0) {
        handleZoomIn();
      } else {
        handleZoomOut();
      }
    };

    const wheelOptions: AddEventListenerOptions = { passive: false, capture: true };
    layout.addEventListener("wheel", handleWheel, wheelOptions);
    return () => layout.removeEventListener("wheel", handleWheel, wheelOptions);
  }, [handleZoomIn, handleZoomOut]);

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
  }, [headings, previewText]);

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
  const markdownLayoutStyle = {
    "--markdown-edit-left": `${markdownSplitPercent}%`,
    "--markdown-body-font-size": `${MARKDOWN_BODY_FONT_SIZE_PX * markdownZoom}px`,
    "--markdown-h1-font-size": `${MARKDOWN_H1_FONT_SIZE_PX * markdownZoom}px`,
    "--markdown-h2-font-size": `${MARKDOWN_H2_FONT_SIZE_PX * markdownZoom}px`,
    "--markdown-h3-font-size": `${MARKDOWN_H3_FONT_SIZE_PX * markdownZoom}px`,
    "--markdown-small-heading-font-size": `${MARKDOWN_SMALL_HEADING_FONT_SIZE_PX * markdownZoom}px`,
    "--markdown-code-font-size": `${MARKDOWN_CODE_FONT_SIZE_PX * markdownZoom}px`,
    "--markdown-table-font-size": `${MARKDOWN_TABLE_FONT_SIZE_PX * markdownZoom}px`,
  } as React.CSSProperties;

  return (
    <div className={`markdown-workspace${isEditing ? " is-editing" : ""}`}>
      {loadError && (
        <Callout intent={Intent.DANGER} icon="error" className="markdown-load-error">
          {loadError}
        </Callout>
      )}

      <div
        ref={markdownLayoutRef}
        className={`markdown-layout${isEditing ? " editing" : ""}${markdownSplitResizing ? " markdown-split-resizing" : ""}`}
        style={markdownLayoutStyle}
      >
        {isEditing && (
          <>
            <section className="markdown-editor-pane">
              <div className="markdown-pane-header">
                <strong>Source</strong>
                <span>{lineCount.toLocaleString()} lines</span>
              </div>
              <div className="json-editor markdown-source-editor">
                <div className="json-line-numbers">
                  <div className="json-line-numbers-inner" ref={lineNumbersInnerRef}>
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
                  onScroll={(event) => updateLineNumbersScroll(event.currentTarget.scrollTop)}
                />
              </div>
            </section>
            <div
              className="markdown-edit-divider"
              role="separator"
              aria-label="Resize markdown editor and preview"
              aria-orientation="vertical"
              aria-valuemin={MARKDOWN_SPLIT_MIN_PERCENT}
              aria-valuemax={MARKDOWN_SPLIT_MAX_PERCENT}
              aria-valuenow={Math.round(markdownSplitPercent)}
              tabIndex={0}
              onPointerDown={handleMarkdownSplitPointerDown}
              onPointerMove={handleMarkdownSplitPointerMove}
              onPointerUp={finishMarkdownSplitResize}
              onPointerCancel={finishMarkdownSplitResize}
              onKeyDown={handleMarkdownSplitKeyDown}
            />
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
                <MarkdownPreview text={previewText} headings={headings} filePath={table.filePath} />
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
        <div
          className={`markdown-zoom-controls${markdownZoomAdjusted ? " is-adjusted" : ""}`}
          aria-label="Markdown zoom controls"
        >
          <Button
            minimal
            small
            icon="zoom-out"
            title={zoomOutTitle}
            aria-label="Zoom out"
            disabled={!canZoomOut}
            onClick={handleZoomOut}
          />
          <span
            className={`markdown-zoom-readout${markdownZoom > MARKDOWN_DEFAULT_ZOOM ? " zoomed-in" : markdownZoom < MARKDOWN_DEFAULT_ZOOM ? " zoomed-out" : ""}`}
            aria-live="polite"
            title={markdownZoomStatus}
          >
            <Icon icon={markdownZoomIcon} size={13} />
            {markdownZoomStatus}
          </span>
          <Button
            minimal
            small
            icon="zoom-in"
            title={zoomInTitle}
            aria-label="Zoom in"
            disabled={!canZoomIn}
            onClick={handleZoomIn}
          />
          <Button
            minimal
            small
            icon="reset"
            title={resetZoomTitle}
            aria-label="Reset zoom"
            disabled={!markdownZoomAdjusted}
            onClick={handleResetZoom}
          />
        </div>
      </div>
    </div>
  );
}
