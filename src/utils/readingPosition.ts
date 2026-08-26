export interface PdfReadingPosition {
  pageNumber: number;
  top: number;
}

type ReadingPositionKind = "pdf" | "markdown";

const READING_POSITION_STORAGE_PREFIX = "chikku:rpos:v1";
const MARKDOWN_PROGRESS_SCALE = 1_000_000;
const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const FNV64_MASK = 0xffffffffffffffffn;

export const READING_POSITION_SAVE_DELAY_MS = 250;

function normalizeReadingPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function hashReadingFilePath(filePath: string): string {
  const bytes = new TextEncoder().encode(normalizeReadingPath(filePath));
  let hash = FNV64_OFFSET_BASIS;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

export function getReadingPositionStorageKey(filePath: string, kind: ReadingPositionKind): string {
  const kindCode = kind === "pdf" ? "p" : "m";
  return `${READING_POSITION_STORAGE_PREFIX}:${kindCode}:${hashReadingFilePath(filePath)}`;
}

export function serializePdfReadingPosition(position: PdfReadingPosition): string | null {
  const pageNumber = Math.round(position.pageNumber);
  const top = Math.round(position.top);
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || !Number.isSafeInteger(top)) return null;
  return `${pageNumber},${top}`;
}

export function parsePdfReadingPosition(value: string | null, pageCount?: number): PdfReadingPosition | null {
  if (!value) return null;
  const match = /^(\d+),(-?\d+)$/.exec(value);
  if (!match) return null;

  const storedPageNumber = Number(match[1]);
  const top = Number(match[2]);
  if (!Number.isSafeInteger(storedPageNumber) || storedPageNumber < 1 || !Number.isSafeInteger(top)) return null;

  const validPageCount = pageCount === undefined
    ? null
    : Math.max(1, Math.round(pageCount));
  const pageNumber = validPageCount === null
    ? storedPageNumber
    : Math.min(validPageCount, storedPageNumber);
  return { pageNumber, top };
}

export function serializeMarkdownReadingPosition(progress: number): string | null {
  if (!Number.isFinite(progress)) return null;
  const clamped = Math.min(1, Math.max(0, progress));
  return String(Math.round(clamped * MARKDOWN_PROGRESS_SCALE));
}

export function parseMarkdownReadingPosition(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const encoded = Number(value);
  if (!Number.isSafeInteger(encoded) || encoded < 0 || encoded > MARKDOWN_PROGRESS_SCALE) return null;
  return encoded / MARKDOWN_PROGRESS_SCALE;
}

export function getScrollProgress(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  if (maxScrollTop === 0) return 0;
  return Math.min(1, Math.max(0, scrollTop / maxScrollTop));
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadPdfReadingPosition(filePath: string, pageCount?: number): PdfReadingPosition | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    return parsePdfReadingPosition(
      storage.getItem(getReadingPositionStorageKey(filePath, "pdf")),
      pageCount
    );
  } catch {
    return null;
  }
}

export function savePdfReadingPosition(filePath: string, position: PdfReadingPosition): void {
  const storage = getLocalStorage();
  const serialized = serializePdfReadingPosition(position);
  if (!storage || serialized === null) return;
  try {
    storage.setItem(getReadingPositionStorageKey(filePath, "pdf"), serialized);
  } catch {
    // Reading progress is best-effort when app storage is unavailable or full.
  }
}

export function loadMarkdownReadingPosition(filePath: string): number | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    return parseMarkdownReadingPosition(
      storage.getItem(getReadingPositionStorageKey(filePath, "markdown"))
    );
  } catch {
    return null;
  }
}

export function saveMarkdownReadingPosition(filePath: string, progress: number): void {
  const storage = getLocalStorage();
  const serialized = serializeMarkdownReadingPosition(progress);
  if (!storage || serialized === null) return;
  try {
    storage.setItem(getReadingPositionStorageKey(filePath, "markdown"), serialized);
  } catch {
    // Reading progress is best-effort when app storage is unavailable or full.
  }
}
