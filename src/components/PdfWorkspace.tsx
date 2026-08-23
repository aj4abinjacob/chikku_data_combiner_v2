import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Classes, Dialog, Icon, InputGroup, Intent, ProgressBar, Spinner, Tag } from "@blueprintjs/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { DocumentWorkspaceFileActions, LoadedTable } from "../types";
import {
  ensurePdfImageExtension,
  getPdfImageDimensions,
  getPdfImageMimeType,
  getPdfImagePagePath,
  PDF_IMAGE_PAPER_OPTIONS,
  PdfImageCustomSize,
  PdfImageCustomUnit,
  PdfImageFormat,
  PdfImageOrientation,
  PdfImagePaperSize,
  PdfImageResolution,
} from "../utils/pdfImageExport";

type PdfJsModule = typeof import("pdfjs-dist");

interface PdfWorkspaceProps {
  table: LoadedTable;
  onOpenFiles: () => void;
  onPageCountChange: (pageCount: number) => void;
  onFileActionsChange?: (actions: DocumentWorkspaceFileActions | null) => void;
}

interface ViewerRuntime {
  eventBus: any;
  findController: any;
  linkService: any;
  pdfViewer: any;
  annotationEditorUIManager: any | null;
  findState: Record<string, number>;
}

interface PasswordRequest {
  incorrect: boolean;
  submit: (password: string) => void;
  cancel: () => void;
}

interface PdfOutlineItem {
  title: string;
  dest: string | any[] | null;
  url: string | null;
  items: PdfOutlineItem[];
}

interface FindMatchesCount {
  current: number;
  total: number;
}

interface PdfStampEditor {
  id: string;
  annotationElementId: string | null;
  pageIndex: number;
  div: HTMLElement;
  rotation: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pageDimensions: [number, number];
  pageTranslation: [number, number];
  getPDFRect: () => [number, number, number, number];
  fixAndSetPosition: (rotation?: number) => void;
  addCommands: (params: {
    cmd: () => void;
    undo: () => void;
    mustExec: boolean;
  }) => void;
  serialize: (isForCopying?: boolean, context?: any) => any;
}

interface PdfLayerEditor {
  id: string;
  annotationElementId: string | null;
  pageIndex: number;
  div: HTMLElement;
}

interface PdfAnnotationStorage {
  [Symbol.iterator](): IterableIterator<[string, unknown]>;
  remove: (key: string) => void;
  setValue: (key: string, value: unknown) => void;
}

interface ImageTransformState {
  flipHorizontal: boolean;
  flipVertical: boolean;
  originalSerialize: PdfStampEditor["serialize"] | null;
}

interface ImageContextMenuState {
  editorId: string;
  x: number;
  y: number;
}

type PdfPhase = "loading" | "ready" | "error";
type SidePanel = "closed" | "thumbnails" | "outline";
type PdfImagePageSelection = "current" | "all";

const PDF_RANGE_CHUNK_SIZE = 256 * 1024;
const PDF_MAX_CANVAS_PIXELS = 3_600_000;
const PDF_KEEP_PAGE_RADIUS = 2;
const PDF_MAX_DIRECT_PRINT_PAGES = 50;
const PDF_MAX_ESTIMATED_PRINT_BYTES = 400 * 1024 * 1024;
const PDF_PRINT_DPI = 150;
const PDF_LOW_QUALITY_PRINT_DPI = 96;
const PDF_IMAGE_EXPORT_MAX_PIXELS = 40_000_000;
const PDF_IMAGE_EXPORT_MAX_DIMENSION = 16384;
const PDF_IMAGE_PREVIEW_MAX_WIDTH = 470;
const PDF_IMAGE_PREVIEW_MAX_HEIGHT = 390;
const PDF_IMAGE_MIME_TYPES = [
  "image/apng",
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "image/x-icon",
];
const PDF_IMAGE_EXTENSIONS = ["apng", "avif", "bmp", "gif", "ico", "jpg", "jpeg", "png", "svg", "webp"];
const PDF_IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const ZOOM_OPTIONS = [
  { value: "page-width", label: "Fit width" },
  { value: "page-fit", label: "Fit page" },
  { value: "page-actual", label: "Actual size" },
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.25", label: "125%" },
  { value: "1.5", label: "150%" },
  { value: "2", label: "200%" },
  { value: "3", label: "300%" },
];

const PDF_IMAGE_FORMAT_OPTIONS: { value: PdfImageFormat; label: string; detail: string }[] = [
  { value: "png", label: "PNG", detail: "Sharp text and lossless quality" },
  { value: "jpeg", label: "JPEG", detail: "Smaller files for sharing" },
  { value: "webp", label: "WebP", detail: "Compact files with high quality" },
];

const PDF_IMAGE_RESOLUTION_OPTIONS: { value: PdfImageResolution; label: string }[] = [
  { value: 96, label: "96 DPI · Screen" },
  { value: 150, label: "150 DPI · Standard" },
  { value: 300, label: "300 DPI · Print" },
];

function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function ensurePdfExtension(path: string): string {
  return /\.pdf$/i.test(path) ? path : `${path}.pdf`;
}

function isSupportedPdfImage(file: File): boolean {
  if (PDF_IMAGE_MIME_TYPES.includes(file.type.toLowerCase())) return true;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return !!extension && PDF_IMAGE_EXTENSIONS.includes(extension);
}

function getPdfImageMimeTypeFromPath(filePath: string): string {
  const extension = filePath.split(".").pop()?.toLowerCase() || "";
  return PDF_IMAGE_MIME_BY_EXTENSION[extension] || "application/octet-stream";
}

function getRotatedImagePosition(editor: PdfStampEditor, rotation: number): { x: number; y: number } {
  const [pageWidth, pageHeight] = editor.pageDimensions;
  const [pageX, pageY] = editor.pageTranslation;
  const [left, bottom, right, top] = editor.getPDFRect();
  const centerX = (left + right) / 2 - pageX;
  const centerY = (bottom + top) / 2 - pageY;
  const width = editor.width * pageWidth;
  const height = editor.height * pageHeight;

  switch (rotation) {
    case 90:
      return {
        x: (centerX - height / 2) / pageWidth,
        y: (pageHeight + width / 2 - centerY) / pageHeight,
      };
    case 180:
      return {
        x: (centerX + width / 2) / pageWidth,
        y: (pageHeight + height / 2 - centerY) / pageHeight,
      };
    case 270:
      return {
        x: (centerX + height / 2) / pageWidth,
        y: (pageHeight - width / 2 - centerY) / pageHeight,
      };
    default:
      return {
        x: (centerX - width / 2) / pageWidth,
        y: (pageHeight - centerY - height / 2) / pageHeight,
      };
  }
}

function flipSerializedBitmap(bitmap: ImageBitmap, flipHorizontal: boolean, flipVertical: boolean): ImageBitmap {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image transformation is not available in this webview");
  context.translate(flipHorizontal ? bitmap.width : 0, flipVertical ? bitmap.height : 0);
  context.scale(flipHorizontal ? -1 : 1, flipVertical ? -1 : 1);
  context.drawImage(bitmap, 0, 0);
  return canvas.transferToImageBitmap();
}

function isInsertedLayerEditor(value: unknown, pageIndex: number): value is PdfLayerEditor {
  if (!value || typeof value !== "object") return false;
  const editor = value as Partial<PdfLayerEditor>;
  return (
    editor.annotationElementId === null
    && editor.pageIndex === pageIndex
    && typeof editor.id === "string"
    && editor.div instanceof HTMLElement
  );
}

function getInsertedLayerEntries(
  annotationStorage: PdfAnnotationStorage,
  pageIndex: number
): [string, PdfLayerEditor][] {
  return Array.from(annotationStorage).filter(
    (entry): entry is [string, PdfLayerEditor] => isInsertedLayerEditor(entry[1], pageIndex)
  );
}

function syncInsertedLayerOrder(annotationStorage: PdfAnnotationStorage, pageIndex: number): void {
  const layerEditors = getInsertedLayerEntries(annotationStorage, pageIndex);
  layerEditors.forEach(([, editor], index) => {
    editor.div.style.zIndex = String(1000 + index);
  });
}

function getPdfAssetBase(): string {
  return new URL("pdfjs/", window.location.href).toString();
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch (_) {
    return false;
  }
}

function PdfThumbnail({
  document,
  pageNumber,
  active,
  onSelect,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;

    void document.getPage(pageNumber).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const cssWidth = 132;
      const outputScale = Math.min(window.devicePixelRatio || 1, 1.5);
      const viewport = page.getViewport({ scale: (cssWidth / baseViewport.width) * outputScale });
      const canvas = canvasRef.current;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${Math.ceil(viewport.height / outputScale)}px`;
      renderTask = page.render({ canvas, viewport });
      return renderTask.promise;
    }).catch((error) => {
      if (!cancelled && error?.name !== "RenderingCancelledException") {
        console.warn(`Failed to render PDF thumbnail ${pageNumber}`, error);
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [document, pageNumber]);

  return (
    <button
      type="button"
      className={`pdf-thumbnail${active ? " active" : ""}`}
      onClick={onSelect}
      aria-label={`Go to page ${pageNumber}`}
    >
      <canvas ref={canvasRef} />
      <span>{pageNumber}</span>
    </button>
  );
}

function PdfThumbnailList({
  document,
  currentPage,
  onSelect,
}: {
  document: PDFDocumentProxy;
  currentPage: number;
  onSelect: (page: number) => void;
}): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: document.numPages,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 194,
    overscan: 3,
  });

  useEffect(() => {
    virtualizer.scrollToIndex(Math.max(0, currentPage - 1), { align: "auto" });
  }, [currentPage, virtualizer]);

  return (
    <div ref={scrollRef} className="pdf-thumbnail-list">
      <div className="pdf-thumbnail-list-inner" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            className="pdf-thumbnail-slot"
            style={{ transform: `translateY(${item.start}px)`, height: item.size }}
          >
            <PdfThumbnail
              document={document}
              pageNumber={item.index + 1}
              active={currentPage === item.index + 1}
              onSelect={() => onSelect(item.index + 1)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function PdfOutline({
  items,
  onActivate,
}: {
  items: PdfOutlineItem[];
  onActivate: (item: PdfOutlineItem) => void;
}): React.ReactElement {
  return (
    <ul className="pdf-outline-list">
      {items.map((item, index) => (
        <li key={`${item.title}-${index}`}>
          <button type="button" onClick={() => onActivate(item)} title={item.title}>
            {item.items?.length > 0 && <Icon icon="caret-right" size={10} />}
            <span>{item.title || "Untitled section"}</span>
          </button>
          {item.items?.length > 0 && <PdfOutline items={item.items} onActivate={onActivate} />}
        </li>
      ))}
    </ul>
  );
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Unable to prepare a PDF page for printing"));
    }, "image/png");
  });
}

interface PdfImageRenderSettings {
  paperSize: PdfImagePaperSize;
  resolution: PdfImageResolution;
  orientation: PdfImageOrientation;
  customSize?: PdfImageCustomSize;
}

interface RenderedPdfImage {
  canvas: HTMLCanvasElement;
  dimensions: { width: number; height: number };
}

function getPreviewDimensions(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(PDF_IMAGE_PREVIEW_MAX_WIDTH / width, PDF_IMAGE_PREVIEW_MAX_HEIGHT / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function renderPdfPageImage(
  pdfDocument: PDFDocumentProxy,
  pdfjsLib: PdfJsModule,
  pageNumber: number,
  settings: PdfImageRenderSettings,
  preview = false,
  printAnnotationStorage: any = null
): Promise<RenderedPdfImage> {
  const page = await pdfDocument.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const exportDimensions = getPdfImageDimensions(
    baseViewport.width,
    baseViewport.height,
    settings.paperSize,
    settings.resolution,
    settings.orientation,
    settings.customSize
  );
  if (
    !preview
    && (exportDimensions.width * exportDimensions.height > PDF_IMAGE_EXPORT_MAX_PIXELS
      || exportDimensions.width > PDF_IMAGE_EXPORT_MAX_DIMENSION
      || exportDimensions.height > PDF_IMAGE_EXPORT_MAX_DIMENSION)
  ) {
    throw new Error(
      `The selected output size (${exportDimensions.width.toLocaleString()} × ${exportDimensions.height.toLocaleString()} px) is too large. Choose a lower DPI or smaller paper size.`
    );
  }

  const canvasDimensions = preview
    ? getPreviewDimensions(exportDimensions.width, exportDimensions.height)
    : exportDimensions;
  const contentScale = Math.min(
    canvasDimensions.width / baseViewport.width,
    canvasDimensions.height / baseViewport.height
  );
  const viewport = page.getViewport({ scale: contentScale });
  const offsetX = Math.max(0, (canvasDimensions.width - viewport.width) / 2);
  const offsetY = Math.max(0, (canvasDimensions.height - viewport.height) / 2);
  const canvas = window.document.createElement("canvas");
  canvas.width = canvasDimensions.width;
  canvas.height = canvasDimensions.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Image rendering is not available in this webview");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvas,
    viewport,
    transform: [1, 0, 0, 1, offsetX, offsetY],
    background: "#ffffff",
    intent: preview ? "display" : "print",
    annotationMode: pdfjsLib.AnnotationMode.ENABLE_STORAGE,
    printAnnotationStorage,
  }).promise;

  return { canvas, dimensions: exportDimensions };
}

async function canvasToImageBytes(
  canvas: HTMLCanvasElement,
  format: PdfImageFormat,
  quality: number
): Promise<Uint8Array> {
  const mimeType = getPdfImageMimeType(format);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error(`Unable to encode the page as ${format.toUpperCase()}`));
        } else if (result.type !== mimeType) {
          reject(new Error(`${format.toUpperCase()} export is not supported by this webview`));
        } else {
          resolve(result);
        }
      },
      mimeType,
      format === "png" ? undefined : quality / 100
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}

async function switchPdfEditorMode(runtime: ViewerRuntime, mode: number): Promise<void> {
  if (runtime.pdfViewer.annotationEditorMode === mode) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("The PDF image editor did not become ready"));
    }, 8000);
    const handleModeChanged = (event: { mode: number }) => {
      if (event.mode !== mode) return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timeout);
      runtime.eventBus.off("annotationeditormodechanged", handleModeChanged);
    };

    runtime.eventBus.on("annotationeditormodechanged", handleModeChanged);
    try {
      runtime.pdfViewer.annotationEditorMode = { mode };
    } catch (modeError) {
      cleanup();
      reject(modeError);
    }
  });
}

async function waitForAnnotationEditor(runtime: ViewerRuntime): Promise<void> {
  if (runtime.annotationEditorUIManager) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Image editing is not available for this PDF"));
    }, 8000);
    const handleManagerReady = (event: { uiManager: any }) => {
      runtime.annotationEditorUIManager = event.uiManager;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timeout);
      runtime.eventBus.off("annotationeditoruimanager", handleManagerReady);
    };

    runtime.eventBus.on("annotationeditoruimanager", handleManagerReady);
  });
}

async function waitForInsertedImage(viewer: HTMLElement, previousImageCount: number): Promise<void> {
  if (viewer.querySelectorAll(".stampEditor canvas").length > previousImageCount) return;

  await new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (viewer.querySelectorAll(".stampEditor canvas").length <= previousImageCount) return;
      cleanup();
      resolve();
    });
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("The selected image could not be prepared"));
    }, 10000);
    const cleanup = () => {
      clearTimeout(timeout);
      observer.disconnect();
    };

    observer.observe(viewer, { childList: true, subtree: true });
  });
}

export function PdfWorkspace({
  table,
  onOpenFiles,
  onPageCountChange,
  onFileActionsChange,
}: PdfWorkspaceProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const imageExportPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const pdfjsModuleRef = useRef<PdfJsModule | null>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const pruneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageTransformsRef = useRef<WeakMap<PdfStampEditor, ImageTransformState>>(new WeakMap());
  const imageTransformRevisionRef = useRef(0);

  const [phase, setPhase] = useState<PdfPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageCount, setPageCount] = useState(0);
  const [zoomValue, setZoomValue] = useState("page-width");
  const [rotation, setRotation] = useState(0);
  const [sidePanel, setSidePanel] = useState<SidePanel>("thumbnails");
  const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [matches, setMatches] = useState<FindMatchesCount>({ current: 0, total: 0 });
  const [findNotFound, setFindNotFound] = useState(false);
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null);
  const [password, setPassword] = useState("");
  const [canPrint, setCanPrint] = useState(true);
  const [canModify, setCanModify] = useState(false);
  const [highQualityPrint, setHighQualityPrint] = useState(true);
  const [signatureCount, setSignatureCount] = useState(0);
  const [imageEditing, setImageEditing] = useState(false);
  const [insertingImage, setInsertingImage] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [imageContextMenu, setImageContextMenu] = useState<ImageContextMenuState | null>(null);
  const [imageExportOpen, setImageExportOpen] = useState(false);
  const [imageExportFormat, setImageExportFormat] = useState<PdfImageFormat>("png");
  const [imageExportPaperSize, setImageExportPaperSize] = useState<PdfImagePaperSize>("a4");
  const [imageExportResolution, setImageExportResolution] = useState<PdfImageResolution>(150);
  const [imageExportOrientation, setImageExportOrientation] = useState<PdfImageOrientation>("auto");
  const [imageExportCustomWidth, setImageExportCustomWidth] = useState("210");
  const [imageExportCustomHeight, setImageExportCustomHeight] = useState("297");
  const [imageExportCustomUnit, setImageExportCustomUnit] = useState<PdfImageCustomUnit>("mm");
  const [imageExportPageSelection, setImageExportPageSelection] = useState<PdfImagePageSelection>("current");
  const [imageExportPreviewPage, setImageExportPreviewPage] = useState(1);
  const [imageExportQuality, setImageExportQuality] = useState(90);
  const [imageExportDimensions, setImageExportDimensions] = useState<{ width: number; height: number } | null>(null);
  const [imageExportPreviewing, setImageExportPreviewing] = useState(false);
  const [imageExporting, setImageExporting] = useState(false);
  const [imageExportProgress, setImageExportProgress] = useState(0);
  const [imageExportStatus, setImageExportStatus] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  const fileName = useMemo(() => getFileName(table.filePath), [table.filePath]);
  const imageExportCustomSize = useMemo<PdfImageCustomSize | null>(() => {
    const width = Number(imageExportCustomWidth);
    const height = Number(imageExportCustomHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height, unit: imageExportCustomUnit };
  }, [imageExportCustomHeight, imageExportCustomUnit, imageExportCustomWidth]);
  const imageExportCustomSizeValid = imageExportPaperSize !== "custom" || imageExportCustomSize !== null;

  const pruneDistantPages = useCallback((current: number) => {
    if (pruneTimerRef.current) clearTimeout(pruneTimerRef.current);
    pruneTimerRef.current = setTimeout(() => {
      const viewer = runtimeRef.current?.pdfViewer;
      if (!viewer) return;
      for (let index = 0; index < viewer.pagesCount; index++) {
        if (Math.abs(index + 1 - current) <= PDF_KEEP_PAGE_RADIUS) continue;
        const pageView = viewer.getPageView(index);
        if (pageView?.renderingState === 3) pageView.reset();
      }
    }, 180);
  }, []);

  useEffect(() => {
    let disposed = false;
    let runtime: ViewerRuntime | null = null;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    setPhase("loading");
    setError(null);
    setProgress(null);
    setDocument(null);
    setPageNumber(1);
    setPageInput("1");
    setPageCount(0);
    setOutline([]);
    setMatches({ current: 0, total: 0 });
    setFindNotFound(false);
    setSignatureCount(0);
    setCanModify(false);
    setImageEditing(false);
    setInsertingImage(false);
    setHasUnsavedChanges(false);
    setSaving(false);
    setFeedback(null);
    setImageContextMenu(null);
    setImageExportOpen(false);
    setImageExporting(false);
    setImageExportProgress(0);
    setImageExportStatus(null);
    imageTransformsRef.current = new WeakMap();

    const openPdf = async () => {
      if (!containerRef.current || !viewerRef.current) return;

      const canonicalPath = await window.api.allowPdfAsset(table.filePath);
      const assetBase = getPdfAssetBase();
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${assetBase}pdf.worker.min.mjs`;
      pdfjsModuleRef.current = pdfjsLib;
      (globalThis as typeof globalThis & { pdfjsLib?: PdfJsModule }).pdfjsLib = pdfjsLib;

      const viewerModule = await import("pdfjs-dist/web/pdf_viewer.mjs");
      if (disposed || !containerRef.current || !viewerRef.current) return;

      const eventBus = new viewerModule.EventBus();
      const linkService = new viewerModule.PDFLinkService({
        eventBus,
        externalLinkTarget: viewerModule.LinkTarget.BLANK,
        externalLinkRel: "noopener noreferrer nofollow",
      });
      const findController = new viewerModule.PDFFindController({ eventBus, linkService });
      const pdfViewer = new viewerModule.PDFViewer({
        container: containerRef.current,
        viewer: viewerRef.current,
        eventBus,
        linkService,
        findController,
        annotationMode: pdfjsLib.AnnotationMode.ENABLE,
        annotationEditorMode: pdfjsLib.AnnotationEditorType.NONE,
        enablePermissions: true,
        enableAutoLinking: false,
        maxCanvasPixels: PDF_MAX_CANVAS_PIXELS,
        maxCanvasDim: 16384,
        capCanvasAreaFactor: 100,
        enableDetailCanvas: true,
        imagesRightClickMinSize: -1,
      });
      linkService.setViewer(pdfViewer);

      runtime = {
        eventBus,
        findController,
        linkService,
        pdfViewer,
        annotationEditorUIManager: null,
        findState: viewerModule.FindState,
      };
      runtimeRef.current = runtime;

      eventBus.on("pagesinit", () => {
        pdfViewer.currentScaleValue = "page-width";
        setZoomValue("page-width");
      });
      eventBus.on("pagechanging", (event: { pageNumber: number }) => {
        setPageNumber(event.pageNumber);
        setPageInput(String(event.pageNumber));
        pruneDistantPages(event.pageNumber);
      });
      eventBus.on("scalechanging", (event: { presetValue?: string; scale: number }) => {
        setZoomValue(event.presetValue || String(Math.round(event.scale * 100) / 100));
      });
      eventBus.on("rotationchanging", (event: { pagesRotation: number }) => {
        setRotation(event.pagesRotation);
      });
      eventBus.on("annotationeditoruimanager", (event: { uiManager: any }) => {
        if (runtime) runtime.annotationEditorUIManager = event.uiManager;
      });
      eventBus.on("annotationeditormodechanged", (event: { mode: number }) => {
        setImageEditing(event.mode === pdfjsLib.AnnotationEditorType.STAMP);
      });
      eventBus.on("updatefindmatchescount", (event: { matchesCount: FindMatchesCount }) => {
        setMatches(event.matchesCount);
      });
      eventBus.on("updatefindcontrolstate", (event: { state: number; matchesCount: FindMatchesCount }) => {
        setMatches(event.matchesCount);
        setFindNotFound(event.state === viewerModule.FindState.NOT_FOUND);
      });

      const sourceUrl = convertFileSrc(canonicalPath);
      const nextLoadingTask = pdfjsLib.getDocument({
        url: sourceUrl,
        cMapUrl: `${assetBase}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assetBase}standard_fonts/`,
        wasmUrl: `${assetBase}wasm/`,
        iccUrl: `${assetBase}iccs/`,
        rangeChunkSize: PDF_RANGE_CHUNK_SIZE,
        disableRange: false,
        disableStream: true,
        disableAutoFetch: true,
        enableXfa: false,
        useWasm: true,
      });
      loadingTask = nextLoadingTask;
      nextLoadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
        if (!disposed) setProgress(total > 0 ? Math.min(1, loaded / total) : null);
      };
      nextLoadingTask.onPassword = (updatePassword: (value: string) => void, reason: number) => {
        if (disposed) return;
        setPassword("");
        setPasswordRequest({
          incorrect: reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD,
          submit: (value) => {
            setPasswordRequest(null);
            updatePassword(value);
          },
          cancel: () => {
            setPasswordRequest(null);
            setError("PDF opening was cancelled.");
            setPhase("error");
            void nextLoadingTask.destroy();
          },
        });
      };

      const pdfDocument = await nextLoadingTask.promise;
      if (disposed) {
        await nextLoadingTask.destroy();
        return;
      }

      documentRef.current = pdfDocument;
      const annotationStorage = pdfDocument.annotationStorage as any;
      annotationStorage.onSetModified = () => {
        if (!disposed) setHasUnsavedChanges(true);
      };
      annotationStorage.onResetModified = () => {
        if (!disposed) setHasUnsavedChanges(false);
      };
      setDocument(pdfDocument);
      setPageCount(pdfDocument.numPages);
      onPageCountChange(pdfDocument.numPages);

      linkService.setDocument(pdfDocument);
      findController.setDocument(pdfDocument);
      pdfViewer.setDocument(pdfDocument);

      const [loadedOutline, permissions, signatures] = await Promise.all([
        pdfDocument.getOutline().catch(() => []),
        pdfDocument.getPermissions().catch(() => null),
        pdfDocument.getSignatures().catch(() => null),
      ]);
      if (disposed) return;

      const printAllowed = permissions === null
        || permissions.includes(pdfjsLib.PermissionFlag.PRINT)
        || permissions.includes(pdfjsLib.PermissionFlag.PRINT_HIGH_QUALITY);
      const modifyAllowed = permissions === null
        || permissions.includes(pdfjsLib.PermissionFlag.MODIFY_CONTENTS);
      setCanPrint(printAllowed);
      setCanModify(modifyAllowed);
      setHighQualityPrint(
        permissions === null || permissions.includes(pdfjsLib.PermissionFlag.PRINT_HIGH_QUALITY)
      );
      setOutline((loadedOutline || []) as PdfOutlineItem[]);
      setSignatureCount(signatures?.length || 0);
      setPhase("ready");
      setProgress(1);
    };

    void openPdf().catch((openError) => {
      if (disposed) return;
      console.error(`Failed to open PDF ${table.filePath}`, openError);
      setError(openError instanceof Error ? openError.message : String(openError));
      setPhase("error");
    });

    return () => {
      disposed = true;
      if (pruneTimerRef.current) {
        clearTimeout(pruneTimerRef.current);
        pruneTimerRef.current = null;
      }
      runtime?.findController?.setDocument(null);
      runtime?.linkService?.setDocument(null);
      runtime?.pdfViewer?.setDocument(null);
      if (documentRef.current) {
        const annotationStorage = documentRef.current.annotationStorage as any;
        annotationStorage.onSetModified = null;
        annotationStorage.onResetModified = null;
      }
      runtimeRef.current = null;
      documentRef.current = null;
      pdfjsModuleRef.current = null;
      void loadingTask?.destroy();
      if (viewerRef.current) viewerRef.current.textContent = "";
    };
  }, [table.filePath, table.reloadVersion, retryVersion, onPageCountChange, pruneDistantPages]);

  useEffect(() => {
    if (phase !== "ready") return;
    const timer = setTimeout(() => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      if (!searchQuery.trim()) {
        setMatches({ current: 0, total: 0 });
        setFindNotFound(false);
      }
      runtime.eventBus.dispatch("find", {
        source: window,
        type: "",
        query: searchQuery,
        phraseSearch: true,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        findPrevious: false,
        matchDiacritics: false,
      });
    }, 220);
    return () => clearTimeout(timer);
  }, [phase, searchQuery]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = navigator.platform.toLowerCase().includes("mac") ? event.metaKey : event.ctrlKey;
      if (!modifier || event.altKey) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        runtimeRef.current?.pdfViewer?.increaseScale();
      } else if (event.key === "-") {
        event.preventDefault();
        runtimeRef.current?.pdfViewer?.decreaseScale();
      } else if (event.key === "0") {
        event.preventDefault();
        if (runtimeRef.current?.pdfViewer) runtimeRef.current.pdfViewer.currentScaleValue = "page-width";
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (phase === "ready" && !highQualityPrint && imageExportResolution !== 96) {
      setImageExportResolution(96);
    }
  }, [highQualityPrint, imageExportResolution, phase]);

  const goToPage = useCallback((nextPage: number) => {
    const viewer = runtimeRef.current?.pdfViewer;
    if (!viewer || pageCount === 0) return;
    const clamped = Math.max(1, Math.min(pageCount, Math.round(nextPage)));
    viewer.currentPageNumber = clamped;
    setPageInput(String(clamped));
  }, [pageCount]);

  const repeatSearch = useCallback((previous: boolean) => {
    const runtime = runtimeRef.current;
    if (!runtime || !searchQuery.trim()) return;
    runtime.eventBus.dispatch("find", {
      source: window,
      type: "again",
      query: searchQuery,
      phraseSearch: true,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
  }, [searchQuery]);

  const activateOutline = useCallback((item: PdfOutlineItem) => {
    if (item.dest) {
      void runtimeRef.current?.linkService?.goToDestination(item.dest);
      return;
    }
    if (!item.url) return;
    if (isHttpsUrl(item.url)) void window.api.openExternal(item.url);
    else setFeedback("Only secure HTTPS links can be opened from a PDF.");
  }, []);

  const openExternally = useCallback(async () => {
    try {
      await window.api.openPdfExternally(table.filePath);
    } catch (openError) {
      setFeedback(`Could not open the system PDF viewer: ${String(openError)}`);
    }
  }, [table.filePath]);

  const getStampEditor = useCallback((editorId: string): PdfStampEditor | null => {
    const editor = runtimeRef.current?.annotationEditorUIManager?.getEditor(editorId) as PdfStampEditor | undefined;
    return editor?.div?.classList.contains("stampEditor") ? editor : null;
  }, []);

  const markImageTransformModified = useCallback((editor: PdfStampEditor) => {
    const annotationStorage = documentRef.current?.annotationStorage as any;
    if (!annotationStorage) return;
    imageTransformRevisionRef.current += 1;
    annotationStorage.setValue(editor.id, {
      chikkuTransformRevision: imageTransformRevisionRef.current,
    });
  }, []);

  const getImageTransformState = useCallback((editor: PdfStampEditor): ImageTransformState => {
    let state = imageTransformsRef.current.get(editor);
    if (!state) {
      state = {
        flipHorizontal: false,
        flipVertical: false,
        originalSerialize: null,
      };
      imageTransformsRef.current.set(editor, state);
    }
    if (!state.originalSerialize) {
      const originalSerialize = editor.serialize.bind(editor);
      state.originalSerialize = originalSerialize;
      editor.serialize = (isForCopying = false, context = null) => {
        const serialized = originalSerialize(isForCopying, context);
        if (
          !serialized
          || isForCopying
          || (!state?.flipHorizontal && !state?.flipVertical)
          || !serialized.bitmap
        ) {
          return serialized;
        }
        const sourceBitmap = serialized.bitmap as ImageBitmap;
        serialized.bitmap = flipSerializedBitmap(
          sourceBitmap,
          !!state.flipHorizontal,
          !!state.flipVertical
        );
        sourceBitmap.close?.();
        return serialized;
      };
    }
    return state;
  }, []);

  const applyImageFlip = useCallback((editorId: string, axis: "horizontal" | "vertical") => {
    const editor = getStampEditor(editorId);
    if (!editor || editor.annotationElementId) {
      setFeedback("Flip is available for images inserted in Chikku.");
      return;
    }
    const transformState = getImageTransformState(editor);
    const before = {
      flipHorizontal: transformState.flipHorizontal,
      flipVertical: transformState.flipVertical,
    };
    const after = {
      flipHorizontal: axis === "horizontal" ? !before.flipHorizontal : before.flipHorizontal,
      flipVertical: axis === "vertical" ? !before.flipVertical : before.flipVertical,
    };
    const apply = (next: typeof before) => {
      transformState.flipHorizontal = next.flipHorizontal;
      transformState.flipVertical = next.flipVertical;
      const canvas = editor.div.querySelector(":scope > canvas") as HTMLCanvasElement | null;
      if (canvas) {
        canvas.style.transformOrigin = "center";
        canvas.style.transform = `scale(${next.flipHorizontal ? -1 : 1}, ${next.flipVertical ? -1 : 1})`;
      }
      markImageTransformModified(editor);
    };
    editor.addCommands({
      cmd: () => apply(after),
      undo: () => apply(before),
      mustExec: true,
    });
    setFeedback(`Image flipped ${axis}ly. Use Save As to keep the change.`);
  }, [getImageTransformState, getStampEditor, markImageTransformModified]);

  const rotateImageClockwise = useCallback((editorId: string) => {
    const editor = getStampEditor(editorId);
    if (!editor || editor.annotationElementId) {
      setFeedback("Rotation is available for images inserted in Chikku.");
      return;
    }
    const before = { rotation: editor.rotation, x: editor.x, y: editor.y };
    const nextRotation = (editor.rotation + 270) % 360;
    const nextPosition = getRotatedImagePosition(editor, nextRotation);
    const after = { rotation: nextRotation, ...nextPosition };
    const apply = (next: typeof before) => {
      editor.rotation = next.rotation;
      editor.x = next.x;
      editor.y = next.y;
      editor.div.setAttribute("data-editor-rotation", String((360 - next.rotation) % 360));
      editor.fixAndSetPosition(next.rotation);
      markImageTransformModified(editor);
    };
    editor.addCommands({
      cmd: () => apply(after),
      undo: () => apply(before),
      mustExec: true,
    });
    setFeedback("Image rotated 90° clockwise. Use Save As to keep the change.");
  }, [getStampEditor, markImageTransformModified]);

  const moveImageLayer = useCallback((editorId: string, direction: "forward" | "backward") => {
    const editor = getStampEditor(editorId);
    const annotationStorage = documentRef.current?.annotationStorage as unknown as PdfAnnotationStorage | undefined;
    if (!editor || editor.annotationElementId || !annotationStorage) {
      setFeedback("Layer ordering is available for images inserted in Chikku.");
      return;
    }

    const before = getInsertedLayerEntries(annotationStorage, editor.pageIndex);
    const currentIndex = before.findIndex(([, candidate]) => candidate === editor);
    const targetIndex = direction === "forward" ? currentIndex + 1 : currentIndex - 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= before.length) {
      setFeedback(direction === "forward" ? "Image is already at the front." : "Image is already at the back.");
      return;
    }

    const after = [...before];
    [after[currentIndex], after[targetIndex]] = [after[targetIndex], after[currentIndex]];
    const apply = (orderedEntries: [string, PdfLayerEditor][]) => {
      for (const [key] of getInsertedLayerEntries(annotationStorage, editor.pageIndex)) {
        annotationStorage.remove(key);
      }
      for (const [key, value] of orderedEntries) {
        annotationStorage.setValue(key, value);
      }
      syncInsertedLayerOrder(annotationStorage, editor.pageIndex);
    };
    editor.addCommands({
      cmd: () => apply(after),
      undo: () => apply(before),
      mustExec: true,
    });
    runtimeRef.current?.annotationEditorUIManager?.unselectAll();
    setFeedback(
      direction === "forward"
        ? "Image brought forward. Use Save As to keep the change."
        : "Image sent backward. Use Save As to keep the change."
    );
  }, [getStampEditor]);

  useEffect(() => {
    if (phase !== "ready" || !viewerRef.current) return;
    const viewer = viewerRef.current;
    const decorateStampEditors = () => {
      const manager = runtimeRef.current?.annotationEditorUIManager;
      if (!manager) return;
      const pageIndexes = new Set<number>();
      for (const stamp of viewer.querySelectorAll<HTMLElement>(".stampEditor")) {
        const editor = manager.getEditor(stamp.id) as PdfStampEditor | undefined;
        if (!editor || editor.annotationElementId) continue;
        pageIndexes.add(editor.pageIndex);
        const buttons = stamp.querySelector<HTMLElement>(":scope > .editToolbar .buttons");
        if (!buttons || buttons.querySelector(".chikku-image-rotate-button")) continue;
        const rotateButton = window.document.createElement("button");
        rotateButton.type = "button";
        rotateButton.className = "basic chikku-image-rotate-button";
        rotateButton.textContent = "↻";
        rotateButton.title = "Rotate image 90° clockwise";
        rotateButton.setAttribute("aria-label", "Rotate image 90° clockwise");
        rotateButton.addEventListener("pointerdown", (event) => event.stopPropagation());
        buttons.insertBefore(rotateButton, buttons.querySelector(".deleteButton"));
      }
      const annotationStorage = documentRef.current?.annotationStorage as unknown as PdfAnnotationStorage | undefined;
      if (annotationStorage) {
        for (const pageIndex of pageIndexes) syncInsertedLayerOrder(annotationStorage, pageIndex);
      }
    };
    const observer = new MutationObserver(decorateStampEditors);
    observer.observe(viewer, { childList: true, subtree: true });
    decorateStampEditors();
    return () => observer.disconnect();
  }, [phase, table.filePath]);

  const insertImage = useCallback(async (file: File) => {
    if (!canModify) {
      setFeedback("This PDF does not allow content changes.");
      return;
    }
    if (!isSupportedPdfImage(file)) {
      setFeedback("Choose a supported image: APNG, AVIF, BMP, GIF, ICO, JPEG, PNG, SVG, or WebP.");
      return;
    }

    const runtime = runtimeRef.current;
    const pdfjsLib = pdfjsModuleRef.current;
    if (!runtime || !pdfjsLib || phase !== "ready") return;

    setInsertingImage(true);
    setFeedback(null);
    try {
      await waitForAnnotationEditor(runtime);
      await switchPdfEditorMode(runtime, pdfjsLib.AnnotationEditorType.STAMP);
      await runtime.annotationEditorUIManager.waitForEditorsRendered(pageNumber);
      const editorLayer = runtime.annotationEditorUIManager.currentLayer?.div as HTMLElement | undefined;
      if (!editorLayer) throw new Error("The current PDF page is not ready for image editing");
      const previousImageCount = editorLayer.querySelectorAll(".stampEditor canvas").length;
      runtime.eventBus.dispatch("switchannotationeditorparams", {
        source: window,
        type: pdfjsLib.AnnotationEditorParamsType.CREATE,
        value: { bitmapFile: file },
      });
      await waitForInsertedImage(editorLayer, previousImageCount);
      setFeedback(`Image added to page ${pageNumber}. Drag or resize it, use ↻ to rotate, right-click to flip, or press Enter to finish selecting it.`);
    } catch (insertError) {
      console.error("Failed to insert image into PDF", insertError);
      setFeedback(`Could not add the image: ${insertError instanceof Error ? insertError.message : String(insertError)}`);
    } finally {
      setInsertingImage(false);
    }
  }, [canModify, pageNumber, phase]);

  const chooseImage = useCallback(async () => {
    try {
      const selected = await window.api.openPdfImageDialog();
      if (!selected) return;
      const imageBuffer = new ArrayBuffer(selected.bytes.byteLength);
      new Uint8Array(imageBuffer).set(selected.bytes);
      const file = new File(
        [imageBuffer],
        getFileName(selected.filePath),
        { type: getPdfImageMimeTypeFromPath(selected.filePath) }
      );
      await insertImage(file);
    } catch (selectionError) {
      console.error("Failed to choose a PDF image", selectionError);
      setFeedback(`Could not choose the image: ${selectionError instanceof Error ? selectionError.message : String(selectionError)}`);
    }
  }, [insertImage]);

  const finishImageEditing = useCallback(async () => {
    const runtime = runtimeRef.current;
    const pdfjsLib = pdfjsModuleRef.current;
    if (!runtime || !pdfjsLib) return;
    try {
      await switchPdfEditorMode(runtime, pdfjsLib.AnnotationEditorType.NONE);
      if (hasUnsavedChanges) setFeedback("Image placement is ready. Use Save As to create the edited PDF.");
    } catch (modeError) {
      setFeedback(`Could not finish image editing: ${modeError instanceof Error ? modeError.message : String(modeError)}`);
    }
  }, [hasUnsavedChanges]);

  const savePdfAs = useCallback(async () => {
    const pdfDocument = documentRef.current;
    if (!pdfDocument || !hasUnsavedChanges || insertingImage || saving) return;

    setSaving(true);
    setFeedback(null);
    try {
      const path = await window.api.saveFileDialog("pdf");
      if (!path) return;
      const pdfPath = ensurePdfExtension(path);
      if (pdfPath === table.filePath) {
        setFeedback("Choose a different filename so the original PDF remains unchanged.");
        return;
      }

      runtimeRef.current?.annotationEditorUIManager?.endCurrentEditing();
      const contents = await pdfDocument.saveDocument();
      await window.api.writeBinaryFile(pdfPath, contents);
      setHasUnsavedChanges(false);
      const runtime = runtimeRef.current;
      const pdfjsLib = pdfjsModuleRef.current;
      if (runtime && pdfjsLib) {
        await switchPdfEditorMode(runtime, pdfjsLib.AnnotationEditorType.NONE).catch((modeError) => {
          console.warn("The edited PDF was saved, but image editing could not be closed", modeError);
        });
      }
      setFeedback(`Saved the edited PDF as ${getFileName(pdfPath)}.`);
    } catch (saveError) {
      setHasUnsavedChanges(true);
      console.error("Failed to save edited PDF", saveError);
      setFeedback(`Save failed: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
    } finally {
      setSaving(false);
    }
  }, [hasUnsavedChanges, insertingImage, saving, table.filePath]);

  const openImageExport = useCallback(() => {
    if (phase !== "ready" || !documentRef.current || !canPrint) return;
    setImageExportPreviewPage(pageNumber);
    setImageExportProgress(0);
    setImageExportStatus(null);
    setImageExportOpen(true);
  }, [canPrint, pageNumber, phase]);

  useEffect(() => {
    if (!imageExportOpen || phase !== "ready" || !document || !pdfjsModuleRef.current) return;
    if (!imageExportCustomSizeValid) {
      setImageExportPreviewing(false);
      setImageExportDimensions(null);
      setImageExportStatus(null);
      return;
    }
    let disposed = false;
    setImageExportPreviewing(true);
    setImageExportStatus(null);

    void renderPdfPageImage(
      document,
      pdfjsModuleRef.current,
      imageExportPreviewPage,
      {
        paperSize: imageExportPaperSize,
        resolution: imageExportResolution,
        orientation: imageExportOrientation,
        customSize: imageExportPaperSize === "custom" ? imageExportCustomSize ?? undefined : undefined,
      },
      true
    ).then((rendered) => {
      if (disposed) {
        rendered.canvas.width = 1;
        rendered.canvas.height = 1;
        return;
      }
      const previewCanvas = imageExportPreviewCanvasRef.current;
      const previewContext = previewCanvas?.getContext("2d", { alpha: false });
      if (!previewCanvas || !previewContext) throw new Error("The image preview is unavailable");
      previewCanvas.width = rendered.canvas.width;
      previewCanvas.height = rendered.canvas.height;
      previewContext.drawImage(rendered.canvas, 0, 0);
      rendered.canvas.width = 1;
      rendered.canvas.height = 1;
      setImageExportDimensions(rendered.dimensions);
      setImageExportPreviewing(false);
    }).catch((previewError) => {
      if (disposed) return;
      setImageExportPreviewing(false);
      setImageExportStatus(`Preview failed: ${previewError instanceof Error ? previewError.message : String(previewError)}`);
    });

    return () => {
      disposed = true;
    };
  }, [
    document,
    imageExportOpen,
    imageExportOrientation,
    imageExportPaperSize,
    imageExportPreviewPage,
    imageExportResolution,
    imageExportCustomSize,
    imageExportCustomSizeValid,
    phase,
  ]);

  const exportPdfImages = useCallback(async () => {
    const pdfDocument = documentRef.current;
    const pdfjsLib = pdfjsModuleRef.current;
    if (!pdfDocument || !pdfjsLib || imageExporting || phase !== "ready" || !imageExportCustomSizeValid) return;

    setImageExporting(true);
    setImageExportProgress(0);
    setImageExportStatus(null);
    let completedPages = 0;
    try {
      const selectedPath = await window.api.saveFileDialog(imageExportFormat);
      if (!selectedPath) return;

      const pageNumbers = imageExportPageSelection === "all"
        ? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1)
        : [imageExportPreviewPage];
      const outputPaths = pageNumbers.map((outputPage) => imageExportPageSelection === "all"
        ? getPdfImagePagePath(selectedPath, imageExportFormat, outputPage, pdfDocument.numPages)
        : ensurePdfImageExtension(selectedPath, imageExportFormat));

      if (imageExportPageSelection === "all") {
        const existingPaths = (await Promise.all(outputPaths.map(async (outputPath) => (
          await window.api.fileExists(outputPath) ? outputPath : null
        )))).filter((outputPath): outputPath is string => outputPath !== null);
        if (existingPaths.length > 0) {
          throw new Error(
            `${existingPaths.length} numbered output file${existingPaths.length === 1 ? " already exists" : "s already exist"}. Choose a different base filename.`
          );
        }
      }

      runtimeRef.current?.annotationEditorUIManager?.endCurrentEditing();
      const printAnnotationStorage = pdfDocument.annotationStorage.print;
      for (let index = 0; index < pageNumbers.length; index++) {
        const rendered = await renderPdfPageImage(
          pdfDocument,
          pdfjsLib,
          pageNumbers[index],
          {
            paperSize: imageExportPaperSize,
            resolution: imageExportResolution,
            orientation: imageExportOrientation,
            customSize: imageExportPaperSize === "custom" ? imageExportCustomSize ?? undefined : undefined,
          },
          false,
          printAnnotationStorage
        );
        const contents = await canvasToImageBytes(rendered.canvas, imageExportFormat, imageExportQuality);
        rendered.canvas.width = 1;
        rendered.canvas.height = 1;
        await window.api.writeBinaryFile(outputPaths[index], contents);
        completedPages++;
        setImageExportProgress(completedPages / pageNumbers.length);
      }

      const formatLabel = PDF_IMAGE_FORMAT_OPTIONS.find((option) => option.value === imageExportFormat)?.label ?? imageExportFormat.toUpperCase();
      const successMessage = imageExportPageSelection === "all"
        ? `Exported ${completedPages} pages as numbered ${formatLabel} images.`
        : `Exported page ${imageExportPreviewPage} as ${getFileName(outputPaths[0])}.`;
      setFeedback(successMessage);
      setImageExportOpen(false);
    } catch (exportError) {
      const detail = exportError instanceof Error ? exportError.message : String(exportError);
      setImageExportStatus(completedPages > 0
        ? `Export stopped after ${completedPages} page${completedPages === 1 ? "" : "s"}: ${detail}`
        : `Export failed: ${detail}`);
    } finally {
      setImageExporting(false);
    }
  }, [
    imageExportFormat,
    imageExportCustomSize,
    imageExportCustomSizeValid,
    imageExportOrientation,
    imageExportPageSelection,
    imageExportPaperSize,
    imageExportPreviewPage,
    imageExportQuality,
    imageExportResolution,
    imageExporting,
    phase,
  ]);

  useEffect(() => () => {
    onFileActionsChange?.(null);
  }, [onFileActionsChange]);

  useEffect(() => {
    const documentReady = phase === "ready";
    onFileActionsChange?.({
      workspaceKind: "pdf",
      isDirty: hasUnsavedChanges,
      isValid: documentReady,
      saving,
      exportingImages: imageExporting,
      canExportImages: documentReady && canPrint && !imageExporting,
      onOpenFiles,
      onSave: savePdfAs,
      saveLabel: "Save PDF",
      saveTitle: "Save image changes to a new PDF",
      onExportImages: openImageExport,
      exportImagesLabel: "Export Images",
      exportImagesTitle: "Export PDF pages as images",
      exportImagesDisabledReason: !documentReady
        ? "The PDF is still loading."
        : !canPrint
          ? "Image export is restricted by this PDF."
          : null,
    });
  }, [
    canPrint,
    hasUnsavedChanges,
    imageExporting,
    onFileActionsChange,
    onOpenFiles,
    openImageExport,
    phase,
    savePdfAs,
    saving,
  ]);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      const modifier = navigator.platform.toLowerCase().includes("mac") ? event.metaKey : event.ctrlKey;
      if (!modifier || event.altKey || event.key.toLowerCase() !== "s" || !hasUnsavedChanges) return;
      event.preventDefault();
      void savePdfAs();
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [hasUnsavedChanges, savePdfAs]);

  useEffect(() => {
    const handleFinishSelection = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as Element | null;
      if (!target?.closest(".stampEditor.selectedEditor") || target.closest("button, input, textarea")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runtimeRef.current?.annotationEditorUIManager?.unselectAll();
      setImageContextMenu(null);
      setFeedback("Image placement finished. Click the image to select it again.");
    };
    window.addEventListener("keydown", handleFinishSelection, true);
    return () => window.removeEventListener("keydown", handleFinishSelection, true);
  }, []);

  useEffect(() => {
    if (!imageContextMenu) return;
    const closeMenu = (event: Event) => {
      const target = event.target as Element | null;
      if (!target?.closest(".pdf-image-context-menu")) setImageContextMenu(null);
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImageContextMenu(null);
    };
    window.addEventListener("pointerdown", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", closeMenuOnEscape);
    containerRef.current?.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", closeMenuOnEscape);
      containerRef.current?.removeEventListener("scroll", closeMenu, true);
    };
  }, [imageContextMenu]);

  const printPdf = useCallback(async () => {
    const pdfDocument = documentRef.current;
    if (!pdfDocument || !canPrint || printing) return;

    setPrinting(true);
    setFeedback(null);
    const objectUrls: string[] = [];
    let printRoot: HTMLDivElement | null = null;
    try {
      const firstPage = await pdfDocument.getPage(1);
      const estimateViewport = firstPage.getViewport({ scale: PDF_PRINT_DPI / 72 });
      const estimatedBytes = estimateViewport.width * estimateViewport.height * 4 * pdfDocument.numPages;
      if (
        pdfDocument.numPages > PDF_MAX_DIRECT_PRINT_PAGES
        || estimatedBytes > PDF_MAX_ESTIMATED_PRINT_BYTES
      ) {
        setFeedback("Large PDFs are opened in the system viewer for memory-safe printing.");
        await window.api.openPdfExternally(table.filePath);
        return;
      }

      const dpi = highQualityPrint ? PDF_PRINT_DPI : PDF_LOW_QUALITY_PRINT_DPI;
      printRoot = window.document.createElement("div");
      printRoot.id = "pdf-print-container";
      window.document.body.appendChild(printRoot);

      for (let pageIndex = 1; pageIndex <= pdfDocument.numPages; pageIndex++) {
        const page: PDFPageProxy = pageIndex === 1 ? firstPage : await pdfDocument.getPage(pageIndex);
        const viewport = page.getViewport({ scale: dpi / 72 });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({
          canvas,
          viewport,
          intent: "print",
          annotationMode: pdfjsModuleRef.current?.AnnotationMode.ENABLE ?? 1,
        }).promise;
        const blob = await canvasToBlob(canvas);
        canvas.width = 0;
        canvas.height = 0;
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.push(objectUrl);
        const pageElement = window.document.createElement("div");
        pageElement.className = "pdf-print-page";
        const image = window.document.createElement("img");
        image.src = objectUrl;
        image.alt = `PDF page ${pageIndex}`;
        pageElement.appendChild(image);
        printRoot.appendChild(pageElement);
        await image.decode().catch(() => {});
      }

      window.document.body.classList.add("pdf-printing");
      window.print();
    } catch (printError) {
      console.error("Failed to print PDF", printError);
      setFeedback(`Printing failed: ${printError instanceof Error ? printError.message : String(printError)}`);
    } finally {
      window.document.body.classList.remove("pdf-printing");
      printRoot?.remove();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      setPrinting(false);
    }
  }, [canPrint, highQualityPrint, printing, table.filePath]);

  const handleViewerClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    const rotateButton = target.closest(".chikku-image-rotate-button");
    if (rotateButton) {
      const stamp = rotateButton.closest<HTMLElement>(".stampEditor");
      event.preventDefault();
      event.stopPropagation();
      if (stamp) rotateImageClockwise(stamp.id);
      return;
    }
    setImageContextMenu(null);
    const anchor = target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#")) return;
    event.preventDefault();
    event.stopPropagation();
    if (isHttpsUrl(href)) void window.api.openExternal(href);
    else setFeedback("Only secure HTTPS links can be opened from a PDF.");
  }, [rotateImageClockwise]);

  const handleViewerContextMenuCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const stamp = (event.target as Element).closest<HTMLElement>(".stampEditor");
    if (!stamp) {
      setImageContextMenu(null);
      return;
    }
    const editor = getStampEditor(stamp.id);
    if (!editor || editor.annotationElementId) return;
    event.preventDefault();
    event.stopPropagation();
    runtimeRef.current?.annotationEditorUIManager?.setSelected(editor);
    setImageContextMenu({
      editorId: editor.id,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 212)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 184)),
    });
  }, [getStampEditor]);

  const progressPercent = progress === null ? null : Math.round(progress * 100);
  const imageExportSizeTooLarge = !!imageExportDimensions && (
    imageExportDimensions.width * imageExportDimensions.height > PDF_IMAGE_EXPORT_MAX_PIXELS
    || imageExportDimensions.width > PDF_IMAGE_EXPORT_MAX_DIMENSION
    || imageExportDimensions.height > PDF_IMAGE_EXPORT_MAX_DIMENSION
  );

  return (
    <div className="pdf-workspace">
      <div className="pdf-toolbar">
        <div className="pdf-toolbar-group pdf-file-identity" title={table.filePath}>
          <Icon icon="document" size={14} />
          <span>{fileName}</span>
          {pageCount > 0 && <Tag minimal>{pageCount} pages</Tag>}
          {hasUnsavedChanges && <Tag minimal intent={Intent.WARNING}>Unsaved</Tag>}
        </div>

        <div className="pdf-toolbar-group">
          <Button
            icon="menu-open"
            minimal
            small
            active={sidePanel !== "closed"}
            onClick={() => setSidePanel((current) => current === "closed" ? "thumbnails" : "closed")}
            title="Toggle PDF navigation panel"
          />
          <Button icon="chevron-left" minimal small disabled={pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)} />
          <input
            className="pdf-page-input"
            value={pageInput}
            inputMode="numeric"
            aria-label="Current PDF page"
            onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))}
            onBlur={() => goToPage(Number(pageInput) || pageNumber)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                goToPage(Number(pageInput) || pageNumber);
                event.currentTarget.blur();
              }
            }}
          />
          <span className="pdf-page-count">/ {pageCount || "–"}</span>
          <Button icon="chevron-right" minimal small disabled={pageNumber >= pageCount} onClick={() => goToPage(pageNumber + 1)} />
        </div>

        <div className="pdf-toolbar-group">
          <Button icon="zoom-out" minimal small onClick={() => runtimeRef.current?.pdfViewer?.decreaseScale()} title="Zoom out" />
          <select
            className="pdf-zoom-select"
            value={ZOOM_OPTIONS.some((option) => option.value === zoomValue) ? zoomValue : "page-width"}
            aria-label="PDF zoom"
            onChange={(event) => {
              const viewer = runtimeRef.current?.pdfViewer;
              if (viewer) viewer.currentScaleValue = event.target.value;
              setZoomValue(event.target.value);
            }}
          >
            {ZOOM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <Button icon="zoom-in" minimal small onClick={() => runtimeRef.current?.pdfViewer?.increaseScale()} title="Zoom in" />
          <Button
            icon="rotate-page"
            minimal
            small
            onClick={() => {
              const viewer = runtimeRef.current?.pdfViewer;
              if (viewer) viewer.pagesRotation = (rotation + 90) % 360;
            }}
            title="Rotate clockwise"
          />
        </div>

        <div className="pdf-toolbar-group pdf-search-controls">
          <InputGroup
            inputRef={searchInputRef}
            leftIcon="search"
            small
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Find in PDF"
            aria-label="Find in PDF"
            rightElement={searchQuery ? <Button icon="cross" minimal small onClick={() => setSearchQuery("")} /> : undefined}
          />
          <Button icon="chevron-up" minimal small disabled={!searchQuery} onClick={() => repeatSearch(true)} title="Previous match" />
          <Button icon="chevron-down" minimal small disabled={!searchQuery} onClick={() => repeatSearch(false)} title="Next match" />
          <span className={`pdf-search-count${findNotFound ? " not-found" : ""}`}>
            {findNotFound ? "No matches" : matches.total > 0 ? `${matches.current}/${matches.total}` : ""}
          </span>
        </div>

        <div className="pdf-toolbar-group pdf-toolbar-actions">
          <Button
            icon="media"
            text="Image"
            minimal
            small
            active={imageEditing}
            loading={insertingImage}
            disabled={!canModify || phase !== "ready"}
            onClick={() => void chooseImage()}
            title={canModify ? "Insert an image on the current PDF page" : "Content changes are restricted by this PDF"}
          />
          {imageEditing && (
            <Button icon="tick" text="Done" minimal small onClick={() => void finishImageEditing()} title="Finish positioning images" />
          )}
          <Button
            icon="floppy-disk"
            text="Save As"
            minimal
            small
            loading={saving}
            disabled={!hasUnsavedChanges || insertingImage || phase !== "ready"}
            onClick={() => void savePdfAs()}
            title="Save image changes to a new PDF"
          />
          <Button icon="folder-open" minimal small onClick={onOpenFiles} title="Open files" />
          <Button
            icon="print"
            minimal
            small
            disabled={!canPrint || phase !== "ready"}
            loading={printing}
            onClick={() => void printPdf()}
            title={canPrint ? "Print PDF" : "Printing is restricted by this PDF"}
          />
          <Button icon="share" minimal small onClick={() => void openExternally()} title="Open in system PDF viewer" />
        </div>
      </div>

      {signatureCount > 0 && (
        <div className="pdf-signature-warning">
          <Icon icon="warning-sign" size={12} />
          This document contains {signatureCount} digital signature{signatureCount === 1 ? "" : "s"}. Chikku does not verify them, and adding an image will invalidate them in the saved copy.
        </div>
      )}
      {feedback && (
        <div className="pdf-feedback">
          <span>{feedback}</span>
          <Button icon="cross" minimal small onClick={() => setFeedback(null)} aria-label="Dismiss PDF message" />
        </div>
      )}

      <div className="pdf-workspace-body">
        {sidePanel !== "closed" && document && (
          <aside className="pdf-side-panel">
            <div className="pdf-side-tabs" role="tablist" aria-label="PDF navigation">
              <button type="button" role="tab" aria-selected={sidePanel === "thumbnails"} onClick={() => setSidePanel("thumbnails")}>
                <Icon icon="grid-view" size={12} /> Pages
              </button>
              <button type="button" role="tab" aria-selected={sidePanel === "outline"} onClick={() => setSidePanel("outline")}>
                <Icon icon="list" size={12} /> Outline
              </button>
            </div>
            {sidePanel === "thumbnails" ? (
              <PdfThumbnailList document={document} currentPage={pageNumber} onSelect={goToPage} />
            ) : outline.length > 0 ? (
              <div className="pdf-outline-scroll"><PdfOutline items={outline} onActivate={activateOutline} /></div>
            ) : (
              <div className="pdf-empty-panel">This PDF has no document outline.</div>
            )}
          </aside>
        )}

        <div className="pdf-viewer-stage">
          <div
            ref={containerRef}
            className="pdf-viewer-container"
            onClickCapture={handleViewerClickCapture}
            onContextMenuCapture={handleViewerContextMenuCapture}
          >
            <div ref={viewerRef} className="pdfViewer" />
          </div>

          {imageContextMenu && (
            <div
              className="pdf-image-context-menu"
              role="menu"
              aria-label="Image transform options"
              style={{ left: imageContextMenu.x, top: imageContextMenu.y }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button type="button" role="menuitem" onClick={() => {
                moveImageLayer(imageContextMenu.editorId, "forward");
                setImageContextMenu(null);
              }}>
                <Icon icon="arrow-up" size={14} /> Bring forward
              </button>
              <button type="button" role="menuitem" onClick={() => {
                moveImageLayer(imageContextMenu.editorId, "backward");
                setImageContextMenu(null);
              }}>
                <Icon icon="arrow-down" size={14} /> Send backward
              </button>
              <div className="pdf-image-context-menu-separator" role="separator" />
              <button type="button" role="menuitem" onClick={() => {
                rotateImageClockwise(imageContextMenu.editorId);
                setImageContextMenu(null);
              }}>
                <Icon icon="image-rotate-right" size={14} /> Rotate clockwise
              </button>
              <button type="button" role="menuitem" onClick={() => {
                applyImageFlip(imageContextMenu.editorId, "horizontal");
                setImageContextMenu(null);
              }}>
                <Icon icon="swap-horizontal" size={14} /> Flip horizontally
              </button>
              <button type="button" role="menuitem" onClick={() => {
                applyImageFlip(imageContextMenu.editorId, "vertical");
                setImageContextMenu(null);
              }}>
                <Icon icon="swap-vertical" size={14} /> Flip vertically
              </button>
            </div>
          )}

          {phase === "loading" && (
            <div className="pdf-state-overlay">
              <Spinner size={32} />
              <strong>Opening PDF…</strong>
              <span>{progressPercent === null ? "Reading document structure" : `${progressPercent}% loaded`}</span>
            </div>
          )}
          {phase === "error" && (
            <div className="pdf-state-overlay pdf-error-state">
              <Icon icon="error" intent={Intent.DANGER} size={32} />
              <strong>Chikku could not display this PDF</strong>
              <span>{error || "The document may be damaged or unsupported by this webview."}</span>
              <div>
                <Button icon="refresh" text="Retry" onClick={() => setRetryVersion((version) => version + 1)} />
                <Button intent={Intent.PRIMARY} icon="share" text="Open externally" onClick={() => void openExternally()} />
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog
        isOpen={!!passwordRequest}
        title={passwordRequest?.incorrect ? "Incorrect PDF password" : "Password-protected PDF"}
        icon="lock"
        canEscapeKeyClose={false}
        canOutsideClickClose={false}
        onClose={() => passwordRequest?.cancel()}
      >
        <div className={Classes.DIALOG_BODY}>
          <p>{passwordRequest?.incorrect ? "That password did not open the PDF. Try again." : "Enter the password to open this PDF."}</p>
          <InputGroup
            autoFocus
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && password) passwordRequest?.submit(password);
            }}
            placeholder="PDF password"
          />
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button text="Cancel" onClick={() => passwordRequest?.cancel()} />
            <Button intent={Intent.PRIMARY} text="Open PDF" disabled={!password} onClick={() => passwordRequest?.submit(password)} />
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={imageExportOpen}
        className="pdf-image-export-dialog"
        title="Export PDF as images"
        icon="media"
        canEscapeKeyClose={!imageExporting}
        canOutsideClickClose={!imageExporting}
        onClose={() => {
          if (!imageExporting) setImageExportOpen(false);
        }}
      >
        <div className={`${Classes.DIALOG_BODY} pdf-image-export-body`}>
          <section className="pdf-image-export-preview-section" aria-label="Image preview">
            <div className="pdf-image-export-section-heading">
              <div>
                <strong>Preview</strong>
                <span>Page {imageExportPreviewPage} of {pageCount}</span>
              </div>
              <div className="pdf-image-export-preview-nav">
                <Button
                  icon="chevron-left"
                  minimal
                  small
                  disabled={imageExportPreviewPage <= 1 || imageExporting}
                  onClick={() => setImageExportPreviewPage((current) => Math.max(1, current - 1))}
                  aria-label="Preview previous page"
                />
                <Button
                  icon="chevron-right"
                  minimal
                  small
                  disabled={imageExportPreviewPage >= pageCount || imageExporting}
                  onClick={() => setImageExportPreviewPage((current) => Math.min(pageCount, current + 1))}
                  aria-label="Preview next page"
                />
              </div>
            </div>
            <div className="pdf-image-export-preview-frame">
              <canvas ref={imageExportPreviewCanvasRef} aria-label={`Preview of PDF page ${imageExportPreviewPage}`} />
              {!imageExportCustomSizeValid ? (
                <div className="pdf-image-export-preview-loading is-warning">
                  <Icon icon="warning-sign" size={22} />
                  <span>Enter a width and height greater than zero</span>
                </div>
              ) : imageExportPreviewing && (
                <div className="pdf-image-export-preview-loading">
                  <Spinner size={24} />
                  <span>Updating preview…</span>
                </div>
              )}
            </div>
            <div className={`pdf-image-export-dimensions${imageExportSizeTooLarge || !imageExportCustomSizeValid ? " is-warning" : ""}`} aria-live="polite">
              <Icon icon={imageExportSizeTooLarge || !imageExportCustomSizeValid ? "warning-sign" : "fullscreen"} size={12} />
              {!imageExportCustomSizeValid
                ? "Custom width and height are required"
                : imageExportDimensions
                ? imageExportSizeTooLarge
                  ? `${imageExportDimensions.width.toLocaleString()} × ${imageExportDimensions.height.toLocaleString()} px is too large; choose a lower DPI`
                  : `${imageExportDimensions.width.toLocaleString()} × ${imageExportDimensions.height.toLocaleString()} px for this page`
                : "Calculating image size…"}
            </div>
          </section>

          <section className="pdf-image-export-settings" aria-label="Image export settings">
            <label className="pdf-image-export-field">
              <span>Image format</span>
              <select
                value={imageExportFormat}
                disabled={imageExporting}
                onChange={(event) => setImageExportFormat(event.target.value as PdfImageFormat)}
              >
                {PDF_IMAGE_FORMAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label} — {option.detail}</option>
                ))}
              </select>
            </label>

            {imageExportFormat !== "png" && (
              <label className="pdf-image-export-field pdf-image-export-quality">
                <span>Image quality <strong>{imageExportQuality}%</strong></span>
                <input
                  type="range"
                  min="60"
                  max="100"
                  step="5"
                  value={imageExportQuality}
                  disabled={imageExporting}
                  onChange={(event) => setImageExportQuality(Number(event.target.value))}
                />
              </label>
            )}

            <label className="pdf-image-export-field">
              <span>Pages</span>
              <select
                value={imageExportPageSelection}
                disabled={imageExporting}
                onChange={(event) => setImageExportPageSelection(event.target.value as PdfImagePageSelection)}
              >
                <option value="current">Current preview page ({imageExportPreviewPage})</option>
                <option value="all">All pages ({pageCount})</option>
              </select>
            </label>

            <label className="pdf-image-export-field">
              <span>Paper size</span>
              <select
                value={imageExportPaperSize}
                disabled={imageExporting}
                onChange={(event) => setImageExportPaperSize(event.target.value as PdfImagePaperSize)}
              >
                {PDF_IMAGE_PAPER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label} — {option.detail}</option>
                ))}
              </select>
            </label>

            {imageExportPaperSize === "custom" && (
              <div className="pdf-image-export-field pdf-image-export-custom-size">
                <span>Custom dimensions</span>
                <div className="pdf-image-export-custom-controls">
                  <input
                    type="number"
                    min="0.01"
                    step={imageExportCustomUnit === "px" ? "1" : "0.1"}
                    value={imageExportCustomWidth}
                    disabled={imageExporting}
                    onChange={(event) => setImageExportCustomWidth(event.target.value)}
                    aria-label="Custom image width"
                    placeholder="Width"
                  />
                  <span aria-hidden="true">×</span>
                  <input
                    type="number"
                    min="0.01"
                    step={imageExportCustomUnit === "px" ? "1" : "0.1"}
                    value={imageExportCustomHeight}
                    disabled={imageExporting}
                    onChange={(event) => setImageExportCustomHeight(event.target.value)}
                    aria-label="Custom image height"
                    placeholder="Height"
                  />
                  <select
                    value={imageExportCustomUnit}
                    disabled={imageExporting}
                    onChange={(event) => setImageExportCustomUnit(event.target.value as PdfImageCustomUnit)}
                    aria-label="Custom image dimension unit"
                  >
                    <option value="px">px</option>
                    <option value="mm">mm</option>
                    <option value="in">in</option>
                  </select>
                </div>
                <small className={!imageExportCustomSizeValid ? "is-error" : ""}>
                  {!imageExportCustomSizeValid
                    ? "Enter values greater than zero."
                    : imageExportCustomUnit === "px"
                      ? "Pixel dimensions are exported exactly as entered."
                      : `Physical dimensions are converted at ${imageExportResolution} DPI.`}
                </small>
              </div>
            )}

            <label className="pdf-image-export-field">
              <span>Orientation</span>
              <select
                value={imageExportOrientation}
                disabled={imageExporting || imageExportPaperSize === "original" || imageExportPaperSize === "custom"}
                onChange={(event) => setImageExportOrientation(event.target.value as PdfImageOrientation)}
              >
                <option value="auto">Match each page</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>

            <label className="pdf-image-export-field">
              <span>Resolution</span>
              <select
                value={imageExportResolution}
                disabled={imageExporting || (imageExportPaperSize === "custom" && imageExportCustomUnit === "px")}
                onChange={(event) => setImageExportResolution(Number(event.target.value) as PdfImageResolution)}
              >
                {PDF_IMAGE_RESOLUTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} disabled={!highQualityPrint && option.value > 96}>
                    {option.label}{!highQualityPrint && option.value > 96 ? " · Restricted by PDF" : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="pdf-image-export-note">
              <Icon icon={imageExportPageSelection === "all" ? "multi-select" : "document"} size={13} />
              <span>
                {imageExportPageSelection === "all"
                  ? "Choose a base filename. Each page will be saved as a numbered image (page-001, page-002, …)."
                  : `Page ${imageExportPreviewPage} will be saved as one image.`}
              </span>
            </div>
          </section>
        </div>

        {(imageExporting || imageExportStatus) && (
          <div className={`pdf-image-export-status${imageExportStatus ? " is-error" : ""}`} aria-live="polite">
            {imageExporting ? (
              <>
                <ProgressBar value={imageExportProgress} intent={Intent.PRIMARY} animate stripes />
                <span>
                  Exporting {Math.max(1, Math.ceil(imageExportProgress * (imageExportPageSelection === "all" ? pageCount : 1)))} of {imageExportPageSelection === "all" ? pageCount : 1}…
                </span>
              </>
            ) : (
              <><Icon icon="warning-sign" size={13} /> <span>{imageExportStatus}</span></>
            )}
          </div>
        )}

        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button text="Cancel" disabled={imageExporting} onClick={() => setImageExportOpen(false)} />
            <Button
              intent={Intent.PRIMARY}
              icon="export"
              text={imageExportPageSelection === "all" ? `Export ${pageCount} images` : "Export image"}
              loading={imageExporting}
              disabled={imageExportPreviewing || imageExporting || !imageExportDimensions || imageExportSizeTooLarge || !imageExportCustomSizeValid}
              onClick={() => void exportPdfImages()}
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
