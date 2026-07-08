import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, Icon, Intent } from "@blueprintjs/core";
import { convertFileSrc } from "@tauri-apps/api/core";
// html2canvas-pro's package root can resolve to a non-callable shape in the webpack dev bundle.
// Import the browser ESM build directly so Markdown PDF export uses the intended renderer.
// @ts-expect-error The package does not publish typings for this bundled browser entrypoint.
import * as html2canvasPro from "../../node_modules/html2canvas-pro/dist/html2canvas-pro.esm.js";
import { jsPDF } from "jspdf";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { DocumentWorkspaceFileActions, LoadedTable } from "../types";
import { SearchInput } from "./SearchInput";

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

interface TextSearchMatch {
  start: number;
  end: number;
}

interface MarkdownHastNode {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownHastNode[];
}

type MarkdownScrollSyncSource = "source" | "preview";

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
const MARKDOWN_SCROLL_SYNC_RELEASE_MS = 120;
const MARKDOWN_PDF_ASSET_TIMEOUT_MS = 3000;
const MARKDOWN_PDF_EXPORT_ROOT_ID = "markdown-pdf-export-root";
const MARKDOWN_PDF_MARGIN_IN = 0.55;
const MARKDOWN_SEARCH_MARK_CLASS = "markdown-search-mark";
const MARKDOWN_SEARCH_SKIP_TAGS = new Set(["script", "style"]);
const MARKDOWN_PDF_EXPORT_STYLES = `
  #${MARKDOWN_PDF_EXPORT_ROOT_ID} {
    position: fixed;
    left: -10000px;
    top: 0;
    z-index: -1;
    width: 816px;
    min-height: 1056px;
    padding: 0;
    overflow: visible;
    background: #ffffff;
    color: #25384a;
    pointer-events: none;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} .markdown-rendered {
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    padding: 0;
    color: #25384a;
    background: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} h1,
  #${MARKDOWN_PDF_EXPORT_ROOT_ID} h2,
  #${MARKDOWN_PDF_EXPORT_ROOT_ID} h3,
  #${MARKDOWN_PDF_EXPORT_ROOT_ID} h4,
  #${MARKDOWN_PDF_EXPORT_ROOT_ID} h5,
  #${MARKDOWN_PDF_EXPORT_ROOT_ID} h6 {
    color: #10161a;
    letter-spacing: 0;
    page-break-after: avoid;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} h1 {
    margin: 0 0 14px;
    font-size: 28px;
    line-height: 1.15;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} h2 {
    margin: 22px 0 9px;
    padding-top: 14px;
    border-top: 1px solid #d8e1e8;
    font-size: 18px;
    line-height: 1.25;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} h3 {
    margin: 18px 0 7px;
    color: #25384a;
    font-size: 15px;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} h4,
  #${MARKDOWN_PDF_EXPORT_ROOT_ID} h5,
  #${MARKDOWN_PDF_EXPORT_ROOT_ID} h6 {
    margin: 14px 0 6px;
    color: #394b59;
    font-size: 13px;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} p {
    margin: 0 0 10px;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} details,
  #${MARKDOWN_PDF_EXPORT_ROOT_ID} .markdown-pdf-details {
    display: block;
    margin: 12px 0 16px;
    padding: 0;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} summary,
  #${MARKDOWN_PDF_EXPORT_ROOT_ID} .markdown-pdf-summary {
    display: block;
    margin: 0 0 8px;
    color: #25384a;
    font-weight: 700;
    list-style: none;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} a {
    color: #106ba3;
    text-decoration: none;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 12px 0 16px;
    page-break-inside: avoid;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} ul,
  #${MARKDOWN_PDF_EXPORT_ROOT_ID} ol {
    margin: 8px 0 12px;
    padding-left: 22px;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} li + li {
    margin-top: 4px;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} input[type="checkbox"] {
    width: 12px;
    height: 12px;
    margin: 0 6px 0 0;
    border: 1px solid #8a9ba8;
    border-radius: 3px;
    appearance: none;
    background: #ffffff;
    vertical-align: -2px;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} input[type="checkbox"]:checked {
    border-color: #137cbd;
    background: #137cbd;
    box-shadow: inset 0 0 0 2px #ffffff;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} blockquote {
    margin: 14px 0;
    padding: 9px 12px;
    border-left: 3px solid #137cbd;
    background: #f7fbff;
    color: #394b59;
    page-break-inside: avoid;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} blockquote p:last-child {
    margin-bottom: 0;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} code {
    padding: 1px 4px;
    border: 1px solid #f1cdd2;
    border-radius: 4px;
    background: #fff4f6;
    color: #9f2b2b;
    font-family: "SF Mono", Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} pre {
    margin: 12px 0 16px;
    padding: 12px 14px;
    border: 1px solid #c5d0da;
    border-radius: 6px;
    background: #f5f8fa;
    color: #182026;
    white-space: pre-wrap;
    word-break: break-word;
    page-break-inside: avoid;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} pre code {
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font-size: 12px;
    line-height: 1.55;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} .markdown-table-scroll {
    max-width: 100%;
    margin: 12px 0 16px;
    overflow: visible;
    border: 1px solid #d8e1e8;
    border-radius: 6px;
    page-break-inside: avoid;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} table {
    width: 100%;
    margin: 0;
    border: 0;
    border-collapse: collapse;
    font-size: 13px;
    table-layout: fixed;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} th,
  #${MARKDOWN_PDF_EXPORT_ROOT_ID} td {
    padding: 6px 8px;
    border-right: 1px solid #d8e1e8;
    border-bottom: 1px solid #d8e1e8;
    text-align: left;
    vertical-align: top;
    white-space: normal;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} th {
    background: #f5f8fa;
    color: #30404d;
    font-weight: 700;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} tr:last-child td {
    border-bottom: 0;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} th:last-child,
  #${MARKDOWN_PDF_EXPORT_ROOT_ID} td:last-child {
    border-right: 0;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} hr {
    height: 1px;
    margin: 22px 0;
    border: 0;
    background: #d8e1e8;
  }

  #${MARKDOWN_PDF_EXPORT_ROOT_ID} .bp4-icon {
    display: none;
  }
`;

type Html2CanvasRenderer = (
  element: HTMLElement,
  options?: Record<string, unknown>,
) => Promise<HTMLCanvasElement>;

function getHtml2CanvasRenderer(): Html2CanvasRenderer {
  const moduleValue = html2canvasPro as unknown;
  const moduleObject = moduleValue as {
    default?: unknown;
    html2canvas?: unknown;
  };
  const defaultObject = moduleObject.default as {
    default?: unknown;
    html2canvas?: unknown;
  } | undefined;
  const candidates = [
    moduleValue,
    moduleObject.default,
    moduleObject.html2canvas,
    defaultObject?.default,
    defaultObject?.html2canvas,
  ];
  const renderer = candidates.find((candidate): candidate is Html2CanvasRenderer => typeof candidate === "function");

  if (!renderer) {
    throw new Error("Markdown PDF renderer failed to load.");
  }

  return renderer;
}

function getFileExtension(filePath: string): string {
  return filePath.split(".").pop()?.toUpperCase() || "MD";
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || "Markdown";
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

function findTextSearchMatches(text: string, query: string): TextSearchMatch[] {
  const needle = query.trim();
  if (!needle) return [];

  const matches: TextSearchMatch[] = [];
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let start = 0;

  while (start < lowerText.length) {
    const index = lowerText.indexOf(lowerNeedle, start);
    if (index === -1) break;
    matches.push({ start: index, end: index + needle.length });
    start = index + needle.length;
  }

  return matches;
}

function renderHighlightedSearchText(text: string, query: string): React.ReactNode {
  const matches = findTextSearchMatches(text, query);
  if (matches.length === 0) return text;

  const fragments: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.start > cursor) fragments.push(text.slice(cursor, match.start));
    fragments.push(
      <mark className="markdown-heading-search-mark" key={`${match.start}-${match.end}`}>
        {text.slice(match.start, match.end)}
      </mark>
    );
    cursor = match.end;
  }

  if (cursor < text.length) fragments.push(text.slice(cursor));
  return fragments;
}

function splitHastTextBySearch(value: string, query: string, activeIndex: number, nextIndex: { current: number }): MarkdownHastNode[] {
  const matches = findTextSearchMatches(value, query);
  if (matches.length === 0) return [{ type: "text", value }];

  const nodes: MarkdownHastNode[] = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.start > cursor) nodes.push({ type: "text", value: value.slice(cursor, match.start) });

    const searchIndex = nextIndex.current++;
    nodes.push({
      type: "element",
      tagName: "mark",
      properties: {
        className: searchIndex === activeIndex
          ? [MARKDOWN_SEARCH_MARK_CLASS, "current"]
          : [MARKDOWN_SEARCH_MARK_CLASS],
        "data-search-index": String(searchIndex),
      },
      children: [{ type: "text", value: value.slice(match.start, match.end) }],
    });

    cursor = match.end;
  }

  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes;
}

function createMarkdownSearchRehypePlugin(query: string, activeIndex: number) {
  const trimmedQuery = query.trim();

  return () => (tree: MarkdownHastNode) => {
    if (!trimmedQuery) return;

    const nextIndex = { current: 0 };
    const visit = (node: MarkdownHastNode) => {
      if (!node.children || MARKDOWN_SEARCH_SKIP_TAGS.has(node.tagName ?? "")) return;

      const nextChildren: MarkdownHastNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && typeof child.value === "string") {
          nextChildren.push(...splitHastTextBySearch(child.value, trimmedQuery, activeIndex, nextIndex));
        } else {
          visit(child);
          nextChildren.push(child);
        }
      }
      node.children = nextChildren;
    };

    visit(tree);
  };
}

function getTextareaLineHeightPx(textarea: HTMLTextAreaElement): number {
  const style = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;

  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.4 : 18;
}

function scrollTextareaToMatch(textarea: HTMLTextAreaElement, text: string, start: number): void {
  const lineIndex = text.slice(0, start).split(/\r\n|\r|\n/).length - 1;
  const lineHeight = getTextareaLineHeightPx(textarea);
  const targetTop = lineIndex * lineHeight - textarea.clientHeight / 2;
  textarea.scrollTop = Math.max(0, targetTop);
}

function getScrollProgress(element: HTMLElement): number {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  if (maxScrollTop === 0) return 0;
  return Math.min(1, Math.max(0, element.scrollTop / maxScrollTop));
}

function applyScrollProgress(element: HTMLElement, progress: number): boolean {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  const targetTop = maxScrollTop * Math.min(1, Math.max(0, progress));
  if (Math.abs(element.scrollTop - targetTop) <= 1) return false;

  element.scrollTo({ top: targetTop, behavior: "smooth" });
  return true;
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

function isMarkdownFindShortcut(event: KeyboardEvent): boolean {
  return !event.altKey
    && !event.shiftKey
    && hasPlatformZoomModifier(event)
    && event.key.toLowerCase() === "f";
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

function ensurePdfExtension(filePath: string): string {
  return /\.pdf$/i.test(filePath) ? filePath : `${filePath}.pdf`;
}

function normalizeMarkdownPdfTables(article: HTMLElement): void {
  const tables = Array.from(article.querySelectorAll("table"));
  for (const table of tables) {
    if (table.parentElement?.classList.contains("markdown-table-scroll")) continue;
    const wrapper = document.createElement("div");
    wrapper.className = "markdown-table-scroll";
    table.replaceWith(wrapper);
    wrapper.appendChild(table);
  }
}

function normalizeMarkdownPdfDetails(article: HTMLElement): void {
  const detailsElements = Array.from(article.querySelectorAll("details"));
  for (const details of detailsElements) {
    const section = document.createElement("section");
    section.className = "markdown-pdf-details";
    const summary = Array.from(details.children).find((child) => child.tagName.toLowerCase() === "summary");

    if (summary) {
      const summaryBlock = document.createElement("div");
      summaryBlock.className = "markdown-pdf-summary";
      summaryBlock.innerHTML = summary.innerHTML;
      section.appendChild(summaryBlock);
    }

    if (details.open || details.hasAttribute("open")) {
      for (const child of Array.from(details.childNodes)) {
        if (child === summary) continue;
        section.appendChild(child.cloneNode(true));
      }
    }

    details.replaceWith(section);
  }
}

function normalizeMarkdownPdfExportArticle(article: HTMLElement): void {
  normalizeMarkdownPdfDetails(article);
  normalizeMarkdownPdfTables(article);
}

function createMarkdownPdfExportRoot(contentHtml: string): { root: HTMLElement; article: HTMLElement } {
  document.getElementById(MARKDOWN_PDF_EXPORT_ROOT_ID)?.remove();

  const root = document.createElement("div");
  root.id = MARKDOWN_PDF_EXPORT_ROOT_ID;

  const style = document.createElement("style");
  style.textContent = MARKDOWN_PDF_EXPORT_STYLES;

  const article = document.createElement("article");
  article.className = "markdown-rendered";
  article.innerHTML = contentHtml;
  normalizeMarkdownPdfExportArticle(article);

  root.append(style, article);
  document.body.appendChild(root);
  return { root, article };
}

async function waitForPdfAssets(container: ParentNode): Promise<void> {
  const pendingImages = Array.from(container.querySelectorAll("img")).filter((image) => !image.complete);
  await document.fonts?.ready.catch(() => undefined);
  if (pendingImages.length === 0) return;

  await Promise.race([
    Promise.all(pendingImages.map((image) => new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.onerror = () => resolve();
    }))),
    new Promise<void>((resolve) => window.setTimeout(resolve, MARKDOWN_PDF_ASSET_TIMEOUT_MS)),
  ]);
}

function createPdfBytesFromCanvas(canvas: HTMLCanvasElement): Uint8Array {
  const pdf = new jsPDF({ unit: "in", format: "letter", orientation: "portrait" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARKDOWN_PDF_MARGIN_IN * 2;
  const contentHeight = pageHeight - MARKDOWN_PDF_MARGIN_IN * 2;
  const sliceHeight = Math.max(1, Math.floor((contentHeight / contentWidth) * canvas.width));
  const pageCanvas = document.createElement("canvas");
  const pageContext = pageCanvas.getContext("2d");

  if (!pageContext) {
    throw new Error("Unable to prepare PDF canvas.");
  }

  pageCanvas.width = canvas.width;

  for (let sourceY = 0, pageIndex = 0; sourceY < canvas.height; sourceY += sliceHeight, pageIndex += 1) {
    const currentSliceHeight = Math.min(sliceHeight, canvas.height - sourceY);
    pageCanvas.height = currentSliceHeight;
    pageContext.fillStyle = "#ffffff";
    pageContext.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    pageContext.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      currentSliceHeight,
      0,
      0,
      canvas.width,
      currentSliceHeight,
    );

    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(
      pageCanvas.toDataURL("image/jpeg", 0.98),
      "JPEG",
      MARKDOWN_PDF_MARGIN_IN,
      MARKDOWN_PDF_MARGIN_IN,
      contentWidth,
      (currentSliceHeight / canvas.width) * contentWidth,
    );
  }

  return new Uint8Array(pdf.output("arraybuffer"));
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
  searchQuery,
  activeSearchIndex,
}: {
  text: string;
  headings: MarkdownHeading[];
  filePath: string;
  searchQuery: string;
  activeSearchIndex: number;
}): React.ReactElement {
  const headingIdQueues = buildHeadingIdQueues(headings);
  const rehypePlugins = useMemo(() => {
    const plugins: any[] = [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]];
    if (searchQuery.trim()) {
      plugins.push(createMarkdownSearchRehypePlugin(searchQuery, activeSearchIndex));
    }
    return plugins;
  }, [activeSearchIndex, searchQuery]);
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
      rehypePlugins={rehypePlugins}
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
  const [exportingPdf, setExportingPdf] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<MarkdownHistoryEntry[]>([]);
  const [markdownSplitPercent, setMarkdownSplitPercent] = useState(34);
  const [markdownSplitResizing, setMarkdownSplitResizing] = useState(false);
  const [markdownZoom, setMarkdownZoom] = useState(MARKDOWN_DEFAULT_ZOOM);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [contentSearch, setContentSearch] = useState("");
  const [contentSearchIndex, setContentSearchIndex] = useState(0);
  const [renderedSearchMatchCount, setRenderedSearchMatchCount] = useState(0);
  const [headingSearch, setHeadingSearch] = useState("");
  const nextHistoryId = useRef(1);
  const markdownLayoutRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const renderedArticleRef = useRef<HTMLElement>(null);
  const previewSearchInputRef = useRef<HTMLInputElement>(null);
  const sourceSearchInputRef = useRef<HTMLInputElement>(null);
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersInnerRef = useRef<HTMLDivElement>(null);
  const lineNumberScrollTopRef = useRef(0);
  const lineNumberScrollFrameRef = useRef<number | null>(null);
  const splitPointerIdRef = useRef<number | null>(null);
  const wheelZoomLastAtRef = useRef(0);
  const scrollSyncSourceRef = useRef<MarkdownScrollSyncSource | null>(null);
  const scrollSyncIgnoredSourceRef = useRef<MarkdownScrollSyncSource | null>(null);
  const scrollSyncReleaseTimeoutRef = useRef<number | null>(null);
  const wasEditingRef = useRef(false);

  const extension = getFileExtension(table.filePath);
  const isDirty = rawText !== savedText;
  const lineCount = rawText.length === 0 ? 0 : rawText.split(/\r\n|\r|\n/).length;
  const wordCount = useMemo(() => countWords(rawText), [rawText]);
  const deferredRawText = useDeferredValue(rawText);
  const previewText = isEditing ? deferredRawText : rawText;
  const headings = useMemo(() => extractHeadings(previewText), [previewText]);
  const trimmedContentSearch = contentSearch.trim();
  const trimmedHeadingSearch = headingSearch.trim();
  const sourceSearchMatches = useMemo(
    () => findTextSearchMatches(rawText, trimmedContentSearch),
    [rawText, trimmedContentSearch]
  );
  const filteredHeadings = useMemo(() => {
    if (!trimmedHeadingSearch) return headings;

    const query = trimmedHeadingSearch.toLowerCase();
    return headings.filter((heading) =>
      heading.text.toLowerCase().includes(query) || String(heading.line).includes(query)
    );
  }, [headings, trimmedHeadingSearch]);
  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(lineCount, 1) }, (_, index) => index + 1),
    [lineCount]
  );
  const contentSearchMatchCount = isEditing ? sourceSearchMatches.length : renderedSearchMatchCount;
  const activeContentSearchIndex = contentSearchMatchCount === 0
    ? 0
    : Math.min(contentSearchIndex, contentSearchMatchCount - 1);
  const contentSearchCountLabel = !trimmedContentSearch
    ? ""
    : contentSearchMatchCount === 0
      ? "0"
      : `${activeContentSearchIndex + 1}/${contentSearchMatchCount}`;
  const headingSearchActive = trimmedHeadingSearch.length > 0;
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
    if (scrollSyncReleaseTimeoutRef.current !== null) {
      window.clearTimeout(scrollSyncReleaseTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    lineNumberScrollTopRef.current = 0;
    if (lineNumbersInnerRef.current) {
      lineNumbersInnerRef.current.style.transform = "translateY(0px)";
    }
  }, [isEditing, table.filePath, table.reloadVersion]);

  const scheduleScrollSyncRelease = useCallback(() => {
    if (scrollSyncReleaseTimeoutRef.current !== null) {
      window.clearTimeout(scrollSyncReleaseTimeoutRef.current);
    }
    scrollSyncReleaseTimeoutRef.current = window.setTimeout(() => {
      scrollSyncReleaseTimeoutRef.current = null;
      scrollSyncSourceRef.current = null;
      scrollSyncIgnoredSourceRef.current = null;
    }, MARKDOWN_SCROLL_SYNC_RELEASE_MS);
  }, []);

  const syncMarkdownScroll = useCallback((source: MarkdownScrollSyncSource) => {
    if (!isEditing) return;

    const textarea = sourceTextareaRef.current;
    const preview = previewScrollRef.current;
    if (!textarea || !preview) return;

    if (scrollSyncIgnoredSourceRef.current === source) {
      scrollSyncIgnoredSourceRef.current = null;
      scheduleScrollSyncRelease();
      return;
    }

    const activeSource = scrollSyncSourceRef.current;
    if (activeSource && activeSource !== source) {
      scheduleScrollSyncRelease();
      return;
    }

    const from = source === "source" ? textarea : preview;
    const to = source === "source" ? preview : textarea;
    const syncedSource: MarkdownScrollSyncSource = source === "source" ? "preview" : "source";

    scrollSyncSourceRef.current = source;
    if (applyScrollProgress(to, getScrollProgress(from))) {
      scrollSyncIgnoredSourceRef.current = syncedSource;
    }
    if (source === "preview") {
      updateLineNumbersScroll(textarea.scrollTop);
    }

    scheduleScrollSyncRelease();
  }, [isEditing, scheduleScrollSyncRelease, updateLineNumbersScroll]);

  const handleSourceScroll = useCallback((event: React.UIEvent<HTMLTextAreaElement>) => {
    updateLineNumbersScroll(event.currentTarget.scrollTop);
    syncMarkdownScroll("source");
  }, [syncMarkdownScroll, updateLineNumbersScroll]);

  const handlePreviewScroll = useCallback(() => {
    syncMarkdownScroll("preview");
  }, [syncMarkdownScroll]);

  useEffect(() => {
    if (!isEditing) {
      wasEditingRef.current = false;
      scrollSyncSourceRef.current = null;
      scrollSyncIgnoredSourceRef.current = null;
      if (scrollSyncReleaseTimeoutRef.current !== null) {
        window.clearTimeout(scrollSyncReleaseTimeoutRef.current);
        scrollSyncReleaseTimeoutRef.current = null;
      }
      return;
    }

    const syncSource: MarkdownScrollSyncSource = wasEditingRef.current ? "source" : "preview";
    wasEditingRef.current = true;

    const frame = window.requestAnimationFrame(() => {
      syncMarkdownScroll(syncSource);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isEditing, markdownZoom, previewText, syncMarkdownScroll]);

  const handleContentSearchChange = useCallback((value: string) => {
    setContentSearch(value);
    setContentSearchIndex(0);
  }, []);

  const revealSourceSearchMatch = useCallback((index: number) => {
    const textarea = sourceTextareaRef.current;
    if (!textarea || sourceSearchMatches.length === 0) return;

    const normalizedIndex = ((index % sourceSearchMatches.length) + sourceSearchMatches.length) % sourceSearchMatches.length;
    const match = sourceSearchMatches[normalizedIndex];
    textarea.setSelectionRange(match.start, match.end);
    scrollTextareaToMatch(textarea, rawText, match.start);
    updateLineNumbersScroll(textarea.scrollTop);
    syncMarkdownScroll("source");
  }, [rawText, sourceSearchMatches, syncMarkdownScroll, updateLineNumbersScroll]);

  const revealRenderedSearchMatch = useCallback((index: number) => {
    const marks = renderedArticleRef.current?.querySelectorAll<HTMLElement>(`.${MARKDOWN_SEARCH_MARK_CLASS}`);
    if (!marks || marks.length === 0) return;

    const normalizedIndex = ((index % marks.length) + marks.length) % marks.length;
    marks[normalizedIndex]?.scrollIntoView({ block: "center", inline: "nearest" });
  }, []);

  const revealContentSearchMatch = useCallback((index: number) => {
    if (isEditing) {
      revealSourceSearchMatch(index);
    } else {
      revealRenderedSearchMatch(index);
    }
  }, [isEditing, revealRenderedSearchMatch, revealSourceSearchMatch]);

  const moveContentSearch = useCallback((direction: 1 | -1) => {
    if (!trimmedContentSearch || contentSearchMatchCount === 0) return;

    setContentSearchIndex((current) => {
      const next = ((current + direction) % contentSearchMatchCount + contentSearchMatchCount) % contentSearchMatchCount;
      window.requestAnimationFrame(() => revealContentSearchMatch(next));
      return next;
    });
  }, [contentSearchMatchCount, revealContentSearchMatch, trimmedContentSearch]);

  const handleContentSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    moveContentSearch(event.shiftKey ? -1 : 1);
  }, [moveContentSearch]);

  const focusMarkdownFindSearch = useCallback(() => {
    window.requestAnimationFrame(() => {
      const input = isEditing ? sourceSearchInputRef.current : previewSearchInputRef.current;
      input?.focus();
      input?.select();
    });
  }, [isEditing]);

  useEffect(() => {
    setContentSearchIndex(0);
  }, [isEditing, trimmedContentSearch]);

  useEffect(() => {
    if (!trimmedContentSearch) {
      if (contentSearchIndex !== 0) setContentSearchIndex(0);
      return;
    }

    if (contentSearchMatchCount > 0 && contentSearchIndex >= contentSearchMatchCount) {
      setContentSearchIndex(0);
    }
  }, [contentSearchIndex, contentSearchMatchCount, trimmedContentSearch]);

  useEffect(() => {
    if (isEditing || !trimmedContentSearch) {
      setRenderedSearchMatchCount(0);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setRenderedSearchMatchCount(
        renderedArticleRef.current?.querySelectorAll(`.${MARKDOWN_SEARCH_MARK_CLASS}`).length ?? 0
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isEditing, previewText, trimmedContentSearch]);

  useEffect(() => {
    if (isEditing || !trimmedContentSearch || renderedSearchMatchCount === 0) return;

    const frame = window.requestAnimationFrame(() => {
      revealRenderedSearchMatch(activeContentSearchIndex);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeContentSearchIndex,
    isEditing,
    renderedSearchMatchCount,
    revealRenderedSearchMatch,
    trimmedContentSearch,
  ]);

  useEffect(() => {
    if (!isEditing || !trimmedContentSearch || sourceSearchMatches.length === 0) return;
    if (document.activeElement === sourceTextareaRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      revealSourceSearchMatch(activeContentSearchIndex);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeContentSearchIndex,
    isEditing,
    revealSourceSearchMatch,
    sourceSearchMatches.length,
    trimmedContentSearch,
  ]);

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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isMarkdownFindShortcut(event)) return;

      event.preventDefault();
      focusMarkdownFindSearch();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusMarkdownFindSearch]);

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

  const handleExportPdf = useCallback(async () => {
    const article = renderedArticleRef.current;
    if (!article) return;

    let exportRoot: HTMLElement | null = null;
    setExportingPdf(true);

    try {
      const path = await window.api.saveFileDialog("pdf");
      if (!path) return;

      const exportDom = createMarkdownPdfExportRoot(article.innerHTML);
      exportRoot = exportDom.root;
      for (const image of Array.from(exportRoot.querySelectorAll("img"))) {
        image.loading = "eager";
      }

      await waitForPdfAssets(exportRoot);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

      const renderHtmlToCanvas = getHtml2CanvasRenderer();
      const canvas = await renderHtmlToCanvas(exportDom.article, {
        backgroundColor: "#ffffff",
        imageTimeout: MARKDOWN_PDF_ASSET_TIMEOUT_MS,
        logging: false,
        scale: Math.min(2, Math.max(1.5, window.devicePixelRatio || 1)),
        scrollX: 0,
        scrollY: 0,
        useCORS: true,
        windowHeight: exportRoot.scrollHeight,
        windowWidth: exportRoot.scrollWidth,
      });

      const bytes = createPdfBytesFromCanvas(canvas);
      await window.api.writeBinaryFile(ensurePdfExtension(path), bytes);
      pushHistory("Exported PDF", rawText);
    } finally {
      setExportingPdf(false);
      exportRoot?.remove();
    }
  }, [pushHistory, rawText, table.filePath]);

  const handleRevert = useCallback(() => {
    setRawText(savedText);
    setIsEditing(false);
    pushHistory("Undo to saved", savedText);
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
      exportingPdf,
      canExport: documentReady && !exporting && !exportingPdf,
      canExportPdf: documentReady && !exporting && !exportingPdf,
      historyOpen,
      onOpenFiles,
      onSave: handleSave,
      onRevert: handleRevert,
      onToggleHistory: () => setHistoryOpen((open) => !open),
      onExport: handleExport,
      onExportPdf: handleExportPdf,
      exportLabel: "Export",
      exportTitle: "Export Markdown copy",
      exportDisabledReason: loadError ? "Resolve the load error before exporting." : loading ? "Markdown is still loading." : null,
      exportPdfLabel: "PDF",
      exportPdfTitle: "Export rendered Markdown as PDF",
      exportPdfDisabledReason: loadError ? "Resolve the load error before exporting PDF." : loading ? "Markdown is still loading." : null,
      onToggleEdit: () => setIsEditing((editing) => !editing),
      editActive: isEditing,
      editLabel: isEditing ? "Done" : "Edit",
    });
  }, [
    exporting,
    exportingPdf,
    handleExport,
    handleExportPdf,
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
      <div className="markdown-history-footer">
        <span>{history.length.toLocaleString()} entries</span>
        <div className="markdown-history-actions">
          <Button
            minimal
            small
            icon="undo"
            text="Undo"
            onClick={handleRevert}
            disabled={!isDirty}
            title="Undo to saved"
          />
        </div>
      </div>
    </aside>
  ) : null;
  const renderContentSearchControl = (
    inputRef: React.RefObject<HTMLInputElement>,
    placeholder: string,
    ariaLabel: string
  ) => (
    <div className="markdown-pane-search">
      <SearchInput
        inputRef={inputRef}
        small
        value={contentSearch}
        onChange={handleContentSearchChange}
        onKeyDown={handleContentSearchKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        clearAriaLabel="Clear markdown search"
      />
      <span className="markdown-search-count" aria-live="polite">
        {contentSearchCountLabel}
      </span>
      <div className="markdown-search-actions">
        <Button
          minimal
          small
          icon="chevron-up"
          aria-label="Previous match"
          title="Previous match"
          disabled={!trimmedContentSearch || contentSearchMatchCount === 0}
          onClick={() => moveContentSearch(-1)}
        />
        <Button
          minimal
          small
          icon="chevron-down"
          aria-label="Next match"
          title="Next match"
          disabled={!trimmedContentSearch || contentSearchMatchCount === 0}
          onClick={() => moveContentSearch(1)}
        />
      </div>
    </div>
  );
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
              <div className="markdown-pane-header markdown-pane-header-with-search">
                <div className="markdown-pane-title">
                  <strong>Source</strong>
                  <span>{lineCount.toLocaleString()} lines</span>
                </div>
                {renderContentSearchControl(sourceSearchInputRef, "Search source...", "Search markdown source")}
              </div>
              <div className="json-editor markdown-source-editor">
                <div className="json-line-numbers">
                  <div className="json-line-numbers-inner" ref={lineNumbersInnerRef}>
                    {lineNumbers.map((n) => <span key={n}>{n}</span>)}
                  </div>
                </div>
                <textarea
                  ref={sourceTextareaRef}
                  className="json-code-input"
                  value={rawText}
                  aria-label="Markdown source editor"
                  spellCheck={false}
                  wrap="off"
                  onChange={(event) => setRawText(event.currentTarget.value)}
                  onScroll={handleSourceScroll}
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
          {!isEditing && (
            <div className="markdown-pane-header markdown-pane-header-with-search">
              <div className="markdown-pane-title">
                <strong>Preview</strong>
                <span>{wordCount.toLocaleString()} words</span>
              </div>
              {renderContentSearchControl(previewSearchInputRef, "Search content...", "Search rendered markdown")}
            </div>
          )}
          <div className="markdown-preview-scroll" ref={previewScrollRef} onScroll={handlePreviewScroll}>
            {loading ? (
              <div className="markdown-empty">
                <Icon icon="refresh" size={18} />
              </div>
            ) : (
              <article className="markdown-rendered" ref={renderedArticleRef}>
                <MarkdownPreview
                  text={previewText}
                  headings={headings}
                  filePath={table.filePath}
                  searchQuery={isEditing ? "" : contentSearch}
                  activeSearchIndex={activeContentSearchIndex}
                />
              </article>
            )}
          </div>
        </section>

        <aside className="markdown-outline">
          <div className="markdown-outline-header">
            <strong>Outline</strong>
            <span>
              {headingSearchActive
                ? `${filteredHeadings.length.toLocaleString()}/${headings.length.toLocaleString()}`
                : headings.length.toLocaleString()}
            </span>
          </div>
          <div className="markdown-outline-tools">
            <SearchInput
              small
              value={headingSearch}
              onChange={setHeadingSearch}
              placeholder="Search headings..."
              aria-label="Search headings"
              clearAriaLabel="Clear heading search"
            />
          </div>
          <div className="markdown-outline-scroll">
            {headings.length === 0 ? (
              <div className="markdown-outline-empty" aria-label="No headings" />
            ) : filteredHeadings.length === 0 ? (
              <div className="markdown-outline-empty">No headings match</div>
            ) : (
              filteredHeadings.map((heading) => (
                <button
                  key={heading.id}
                  type="button"
                  className={`markdown-outline-row level-${Math.min(heading.level, 4)}${heading.id === activeHeadingId ? " active" : ""}`}
                  onClick={() => scrollToHeading(heading.id)}
                  title={heading.text}
                >
                  <span>{renderHighlightedSearchText(heading.text, headingSearch)}</span>
                  <em>{heading.line}</em>
                </button>
              ))
            )}
          </div>
          <div className="markdown-outline-footer">
            {headingSearchActive
              ? `${filteredHeadings.length.toLocaleString()} of ${headings.length.toLocaleString()} headings`
              : `${headings.length.toLocaleString()} headings`}
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
