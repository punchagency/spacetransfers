import {
  PDF_MAX_PAGES,
  PDF_MAX_RASTER_PIXELS,
  PDF_MIN_RASTER_DPI,
  PDF_RASTER_DPI,
} from "../../../../config/artboard.config";
import { withPngDpi } from "./pngDpi";

/** A PDF page, rendered and ready to go through the normal image upload path. */
export interface RasterizedPage {
  file: File;
  pageNumber: number;
  widthIn: number;
  heightIn: number;
  /** The resolution it was rendered at, and stamped into the PNG. */
  dpi: number;
}

export interface OversizePage {
  pageNumber: number;
  widthIn: number;
  heightIn: number;
}

export interface RasterizeResult {
  pages: RasterizedPage[];
  /** Pages the document had, which may exceed what was rendered. */
  totalPages: number;
  /** True when `PDF_MAX_PAGES` cut the document short. */
  truncated: boolean;
  /** Pages too large to render at `PDF_MIN_RASTER_DPI` within the pixel ceiling. */
  tooLarge: OversizePage[];
}

export class PdfRasterizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfRasterizeError";
  }
}

type Pdfjs = typeof import("pdfjs-dist");
type PdfDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

/*
 * Loaded on demand. pdfjs and its worker are a large chunk, and most sessions
 * never upload a PDF — bundling it into the editor's initial load would slow
 * the common case for the uncommon one.
 */
let pdfjsPromise: Promise<Pdfjs> | null = null;

const loadPdfjs = () => {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then(async (pdfjs) => {
      /*
       * The worker is resolved through the bundler rather than a CDN: a CDN
       * copy can drift from the library version, and a version mismatch makes
       * pdfjs refuse to start with a message nobody can act on.
       */
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    });
    // A failed chunk load must not poison every later attempt this session.
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
};

/*
 * Pixel budgets to try, largest first. The second is iOS Safari's canvas
 * ceiling (16,777,216 px): past it Safari hands back no context, or a canvas
 * that encodes to nothing, rather than an error — so a page that fails at the
 * desktop budget is retried once at a size every browser will allocate.
 */
export const PRINT_PIXEL_BUDGETS = [PDF_MAX_RASTER_PIXELS, 16_777_216];

/** The highest print DPI (up to the target) whose render stays within `budget` pixels. */
export const printDpiWithin = (widthIn: number, heightIn: number, budget: number) =>
  Math.min(PDF_RASTER_DPI, Math.floor(Math.sqrt(budget / (widthIn * heightIn))));

/** One render attempt. Null when the browser could not allocate or encode it. */
const renderPage = async (page: PdfPage, dpi: number): Promise<Blob | null> => {
  const viewport = page.getViewport({ scale: dpi / 72 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  try {
    const context = canvas.getContext("2d");
    if (!context) return null;
    /*
     * Transparent, not pdf.js's default white. The page's paper is not part of
     * the artwork: DTF lays white ink under every opaque pixel, so a logo on an
     * implied white page would print as a white rectangle. White the document
     * actually draws is content and is kept.
     */
    await page.render({ canvasContext: context, viewport, background: "rgba(0,0,0,0)" }).promise;
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  } catch (err) {
    console.warn(`[PDF] render at ${dpi}dpi failed`, err);
    return null;
  } finally {
    // Free the bitmap now rather than when the collector gets to it; a long
    // document otherwise holds every page's canvas at print resolution.
    canvas.width = 0;
    canvas.height = 0;
  }
};

const inches = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Render every page (up to `PDF_MAX_PAGES`) to a PNG at print resolution.
 *
 * `onProgress` fires per page so a long document can report something; a
 * 20-page render is several seconds of work and silence reads as a hang.
 */
export const rasterizePdf = async (
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<RasterizeResult> => {
  let pdfjs: Pdfjs;
  try {
    pdfjs = await loadPdfjs();
  } catch {
    throw new PdfRasterizeError(
      `“${file.name}” could not be converted — the PDF reader failed to load. Check your connection and try again.`,
    );
  }

  let doc: PdfDocument;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    doc = await pdfjs.getDocument({ data }).promise;
  } catch {
    throw new PdfRasterizeError(
      `“${file.name}” could not be opened. It may be damaged, only partly downloaded, or password-protected.`,
    );
  }

  const totalPages = doc.numPages;
  const renderCount = Math.min(totalPages, PDF_MAX_PAGES);
  const pages: RasterizedPage[] = [];
  const tooLarge: OversizePage[] = [];
  // Any extension: Illustrator files arrive here too, and "logo.ai.png" is not a name.
  const stem = file.name.replace(/\.[^.]+$/, "") || file.name;

  try {
    for (let n = 1; n <= renderCount; n++) {
      const page = await doc.getPage(n);
      try {
        /*
         * Size from the page's own box, not a fixed pixel size. pdfjs reports
         * the viewport at 72 units an inch, so an A4, a business card and a
         * 20in banner each come out at their real physical size.
         */
        const base = page.getViewport({ scale: 1 });
        const widthIn = base.width / 72;
        const heightIn = base.height / 72;

        let blob: Blob | null = null;
        let dpi = 0;
        for (const budget of PRINT_PIXEL_BUDGETS) {
          const candidate = printDpiWithin(widthIn, heightIn, budget);
          // Too coarse to keep its size, or the same attempt that just failed.
          if (candidate < PDF_MIN_RASTER_DPI || candidate === dpi) continue;
          dpi = candidate;
          blob = await renderPage(page, dpi);
          if (blob) break;
        }

        if (!blob) {
          if (dpi === 0) {
            tooLarge.push({ pageNumber: n, widthIn, heightIn });
            continue;
          }
          throw new PdfRasterizeError(
            `Page ${n} of “${file.name}” could not be converted to an image. Please re-export the PDF and try again.`,
          );
        }

        const png = withPngDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
        pages.push({
          file: new File([png], totalPages > 1 ? `${stem} p${n}.png` : `${stem}.png`, {
            type: "image/png",
          }),
          pageNumber: n,
          widthIn,
          heightIn,
          dpi,
        });
      } finally {
        page.cleanup();
        onProgress?.(n, renderCount);
      }
    }
  } finally {
    void doc.destroy();
  }

  if (pages.length === 0) {
    if (tooLarge.length > 0) {
      const first = tooLarge[0];
      throw new PdfRasterizeError(
        totalPages > 1
          ? `“${file.name}” could not be added — every page is too large to convert at print resolution.`
          : `“${file.name}” is ${inches(first.widthIn)}×${inches(first.heightIn)}in, too large to convert at print resolution.`,
      );
    }
    throw new PdfRasterizeError(`“${file.name}” has no pages to place.`);
  }

  return { pages, totalPages, truncated: totalPages > renderCount, tooLarge };
};
