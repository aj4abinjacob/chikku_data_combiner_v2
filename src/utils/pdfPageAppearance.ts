export type PdfPageAppearance = "original" | "dark-color" | "dark-contrast";

export interface PdfPageColors {
  background: string;
  foreground: string;
}

export const DEFAULT_PDF_PAGE_APPEARANCE: PdfPageAppearance = "original";

export const PDF_HIGH_CONTRAST_PAGE_COLORS: Readonly<PdfPageColors> = Object.freeze({
  background: "#171c22",
  foreground: "#edf2f7",
});

export function isDarkPdfPageAppearance(appearance: PdfPageAppearance): boolean {
  return appearance !== "original";
}

export function getPdfPageColors(appearance: PdfPageAppearance): Readonly<PdfPageColors> | null {
  return appearance === "dark-contrast" ? PDF_HIGH_CONTRAST_PAGE_COLORS : null;
}

export function getPdfPageAppearanceClassName(appearance: PdfPageAppearance): string {
  return `pdf-page-appearance-${appearance}`;
}
