import { computeEffectiveDpi } from "../../components/artboard/lib/utils/layoutHelpers";
import { shouldWarn, type FadeVerdict } from "../../components/artboard/lib/utils/fadeCheck";
import { DPI } from "../../config/artboard.config";

export interface SheetWarning {
  /** 1-based position of the sheet in the cart, for "Sheet 2". */
  sheet: number;
  kind: "low-dpi" | "unknown-dpi" | "transparency";
  /** Pieces affected on that sheet (a piece with copies counts once). */
  count: number;
}

export interface CheckoutWarnings {
  warnings: SheetWarning[];
  /** True while any image's transparency check has not come back yet. */
  checking: boolean;
}

/** The pieces on a cart line, or none for a line that is not a sheet. */
export const cartLinePieces = (line: any): any[] =>
  Array.isArray(line?.items) ? line.items.filter((it: any) => it && typeof it.url === "string") : [];

export const summarizeCartWarnings = (
  cart: any[],
  verdicts: ReadonlyMap<string, FadeVerdict>,
): CheckoutWarnings => {
  const warnings: SheetWarning[] = [];
  let checking = false;
  let sheet = 0;

  for (const line of cart) {
    const pieces = cartLinePieces(line);
    if (pieces.length === 0) continue;
    sheet += 1;

    let low = 0;
    let unknown = 0;
    let transparent = 0;
    for (const piece of pieces) {
      // The same measure as the header's DPI chip and the piece's own badge.
      const dpi = computeEffectiveDpi(piece);
      if (dpi === null) unknown += 1;
      else if (dpi < DPI.THRESHOLD) low += 1;

      const verdict = verdicts.get(piece.url);
      if (!verdict) checking = true;
      else if (shouldWarn(verdict)) transparent += 1;
    }

    if (low) warnings.push({ sheet, kind: "low-dpi", count: low });
    if (unknown) warnings.push({ sheet, kind: "unknown-dpi", count: unknown });
    if (transparent) warnings.push({ sheet, kind: "transparency", count: transparent });
  }

  return { warnings, checking };
};

const images = (n: number) => `${n} image${n === 1 ? "" : "s"}`;

/** One line of checkout copy for a warning. */
export const describeWarning = (w: SheetWarning, sheetCount: number): string => {
  const where = sheetCount > 1 ? `Sheet ${w.sheet}: ` : "";
  switch (w.kind) {
    case "low-dpi":
      return `${where}${images(w.count)} below ${DPI.THRESHOLD} DPI at the printed size — may print soft or pixelated`;
    case "unknown-dpi":
      return `${where}${images(w.count)} whose resolution couldn't be read — check ${w.count === 1 ? "it's" : "they're"} sharp`;
    case "transparency":
      return `${where}${images(w.count)} with fades or see-through areas — these print solid, not as shown`;
  }
};
