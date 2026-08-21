import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Classes, Dialog, Icon, InputGroup, Intent, Spinner, Tag } from "@blueprintjs/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { LoadedTable } from "../types";

type PdfJsModule = typeof import("pdfjs-dist");

interface PdfWorkspaceProps {
  table: LoadedTable;
  onOpenFiles: () => void;
  onPageCountChange: (pageCount: number) => void;
}

interface ViewerRuntime {
  eventBus: any;
  findController: any;
  linkService: any;
  pdfViewer: any;
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

type PdfPhase = "loading" | "ready" | "error";
type SidePanel = "closed" | "thumbnails" | "outline";

const PDF_RANGE_CHUNK_SIZE = 256 * 1024;
const PDF_MAX_CANVAS_PIXELS = 3_600_000;
const PDF_KEEP_PAGE_RADIUS = 2;
const PDF_MAX_DIRECT_PRINT_PAGES = 50;
const PDF_MAX_ESTIMATED_PRINT_BYTES = 400 * 1024 * 1024;
const PDF_PRINT_DPI = 150;
const PDF_LOW_QUALITY_PRINT_DPI = 96;

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

function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
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

export function PdfWorkspace({
  table,
  onOpenFiles,
  onPageCountChange,
}: PdfWorkspaceProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const pdfjsModuleRef = useRef<PdfJsModule | null>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const pruneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const [highQualityPrint, setHighQualityPrint] = useState(true);
  const [signatureCount, setSignatureCount] = useState(0);
  const [printing, setPrinting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  const fileName = useMemo(() => getFileName(table.filePath), [table.filePath]);

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
    setFeedback(null);

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
        annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE,
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
      setCanPrint(printAllowed);
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
    const anchor = (event.target as Element).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#")) return;
    event.preventDefault();
    event.stopPropagation();
    if (isHttpsUrl(href)) void window.api.openExternal(href);
    else setFeedback("Only secure HTTPS links can be opened from a PDF.");
  }, []);

  const progressPercent = progress === null ? null : Math.round(progress * 100);

  return (
    <div className="pdf-workspace">
      <div className="pdf-toolbar">
        <div className="pdf-toolbar-group pdf-file-identity" title={table.filePath}>
          <Icon icon="document" size={14} />
          <span>{fileName}</span>
          {pageCount > 0 && <Tag minimal>{pageCount} pages</Tag>}
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
          This document contains {signatureCount} digital signature{signatureCount === 1 ? "" : "s"}. Chikku displays signatures but does not verify them.
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
          >
            <div ref={viewerRef} className="pdfViewer" />
          </div>

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
    </div>
  );
}
