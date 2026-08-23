export type PdfImageFormat = "png" | "jpeg" | "webp";
export type PdfImagePaperSize = "original" | "custom" | "a4" | "a3" | "letter" | "legal";
export type PdfImageOrientation = "auto" | "portrait" | "landscape";
export type PdfImageResolution = 96 | 150 | 300;
export type PdfImageCustomUnit = "px" | "mm" | "in";

export interface PdfImageCustomSize {
  width: number;
  height: number;
  unit: PdfImageCustomUnit;
}

export interface PdfImagePaperOption {
  value: PdfImagePaperSize;
  label: string;
  detail: string;
  widthInches: number | null;
  heightInches: number | null;
}

export interface PdfImageDimensions {
  width: number;
  height: number;
}

export const PDF_IMAGE_PAPER_OPTIONS: PdfImagePaperOption[] = [
  { value: "original", label: "Original page", detail: "Keep each PDF page's proportions", widthInches: null, heightInches: null },
  { value: "custom", label: "Custom size", detail: "Enter your preferred width and height", widthInches: null, heightInches: null },
  { value: "a4", label: "A4 paper", detail: "210 × 297 mm", widthInches: 8.2677, heightInches: 11.6929 },
  { value: "a3", label: "A3 paper", detail: "297 × 420 mm", widthInches: 11.6929, heightInches: 16.5354 },
  { value: "letter", label: "US Letter", detail: "8.5 × 11 in", widthInches: 8.5, heightInches: 11 },
  { value: "legal", label: "US Legal", detail: "8.5 × 14 in", widthInches: 8.5, heightInches: 14 },
];

export function getPdfImageDimensions(
  pageWidthPoints: number,
  pageHeightPoints: number,
  paperSize: PdfImagePaperSize,
  resolution: PdfImageResolution,
  orientation: PdfImageOrientation,
  customSize?: PdfImageCustomSize
): PdfImageDimensions {
  if (paperSize === "custom" && customSize) {
    const pixelsPerUnit = customSize.unit === "px"
      ? 1
      : customSize.unit === "mm"
        ? resolution / 25.4
        : resolution;
    return {
      width: Math.max(1, Math.round(customSize.width * pixelsPerUnit)),
      height: Math.max(1, Math.round(customSize.height * pixelsPerUnit)),
    };
  }

  const paper = PDF_IMAGE_PAPER_OPTIONS.find((option) => option.value === paperSize);
  if (!paper || paper.widthInches === null || paper.heightInches === null) {
    return {
      width: Math.max(1, Math.round(pageWidthPoints * resolution / 72)),
      height: Math.max(1, Math.round(pageHeightPoints * resolution / 72)),
    };
  }

  const useLandscape = orientation === "landscape"
    || (orientation === "auto" && pageWidthPoints > pageHeightPoints);
  const widthInches = useLandscape ? paper.heightInches : paper.widthInches;
  const heightInches = useLandscape ? paper.widthInches : paper.heightInches;
  return {
    width: Math.max(1, Math.round(widthInches * resolution)),
    height: Math.max(1, Math.round(heightInches * resolution)),
  };
}

export function getPdfImageExtension(format: PdfImageFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

export function getPdfImageMimeType(format: PdfImageFormat): string {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

export function ensurePdfImageExtension(path: string, format: PdfImageFormat): string {
  const extension = getPdfImageExtension(format);
  if (new RegExp(`\\.${extension}$`, "i").test(path)) return path;
  if (format === "jpeg" && /\.jpeg$/i.test(path)) return path;
  return `${path.replace(/\.[^./\\]+$/, "")}.${extension}`;
}

export function getPdfImagePagePath(
  selectedPath: string,
  format: PdfImageFormat,
  pageNumber: number,
  pageCount: number
): string {
  const path = ensurePdfImageExtension(selectedPath, format);
  const extensionMatch = path.match(/(\.[^./\\]+)$/);
  const extension = extensionMatch?.[1] ?? `.${getPdfImageExtension(format)}`;
  const basePath = extensionMatch ? path.slice(0, -extension.length) : path;
  const digits = Math.max(3, String(pageCount).length);
  return `${basePath}-page-${String(pageNumber).padStart(digits, "0")}${extension}`;
}
