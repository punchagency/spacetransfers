/**
 * Turns every accepted upload into the PNG or JPEG the rest of the pipeline uses.
 *
 * Only PNG and JPEG are ever uploaded, decoded by the server, edited or
 * printed. Everything else is converted here first, in the browser — so
 * background removal, the DPI boost, AI edits, auto crop, the fade check and
 * the print export all see an ordinary PNG, and no edit can work on one
 * format and fail on another.
 *
 *   PDF, Illustrator (PDF-compatible)  every page rendered at print resolution
 *   SVG                                rendered at its real size at print resolution
 *   PSD                                Photoshop's flattened image
 *   TIFF                               the first page
 *   WebP, AVIF, GIF, BMP               decoded by the browser (GIF: first frame)
 *   HEIC                               decoded by the browser where it can, else libheif
 *
 * EPS, and Illustrator files saved without PDF compatibility, are PostScript,
 * which nothing in a browser can render; `validateImageFile` refuses them with
 * instructions.
 *
 * The heavy decoders are imported only when their format is added, so a
 * session that never sees a PSD or a HEIC never downloads them.
 */

import { PDF_MAX_PAGES, PDF_MIN_RASTER_DPI } from "../../../../config/artboard.config";
import { validateImageFile, type DetectedKind } from "./fileValidation";
import { PdfRasterizeError, PRINT_PIXEL_BUDGETS, printDpiWithin, rasterizePdf } from "./pdfRasterize";
import { withPngDpi } from "./pngDpi";

export class UploadConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadConvertError";
  }
}

export interface ConvertedUpload {
  /** PNG or JPEG files, ready for the normal upload path. */
  files: File[];
  /** Things the customer should know about a conversion that still succeeded. */
  notices: string[];
}

export interface ConvertOptions {
  /** Called once real conversion work starts — never for a PNG or JPEG. */
  onConverting?: () => void;
  /** Per page, for multi-page documents. */
  onProgress?: (done: number, total: number) => void;
}

const LABELS: Partial<Record<NonNullable<DetectedKind>, string>> = {
  pdf: "PDF",
  svg: "SVG",
  psd: "PSD",
  tiff: "TIFF",
  webp: "WebP",
  avif: "AVIF",
  heic: "HEIC",
  gif: "GIF",
  bmp: "BMP",
};

const stemOf = (name: string) => name.replace(/\.[^.]+$/, "") || name;

const damaged = (file: File, label: string) =>
  new UploadConvertError(
    `“${file.name}” could not be opened as ${label}. It may be damaged or only partly downloaded. Please re-export it and try again.`,
  );

const tooLargeForBrowser = (file: File, width: number, height: number) =>
  new UploadConvertError(
    `“${file.name}” is ${width}×${height} pixels, too large for this browser to convert. Please export it at a smaller size, or as PNG, and try again.`,
  );

/** Encodes a canvas as PNG, stamping the source's resolution when it is known. */
const canvasToPngFile = async (canvas: HTMLCanvasElement, name: string, dpi?: number): Promise<File> => {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  // Free the bitmap now; a large decode otherwise holds it until collection.
  const { width, height } = canvas;
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new UploadConvertError(`“${name}” (${width}×${height}) could not be encoded in this browser. Please export it as PNG and try again.`);
  let bytes = new Uint8Array(await blob.arrayBuffer());
  if (dpi && Number.isFinite(dpi) && dpi >= 1) bytes = withPngDpi(bytes, Math.round(dpi));
  return new File([bytes], `${stemOf(name)}.png`, { type: "image/png" });
};

/** Pixels from a decoder (RGBA, width × height) to a PNG file. */
const pixelsToPngFile = async (
  file: File,
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  dpi?: number,
): Promise<File> => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw tooLargeForBrowser(file, width, height);
  const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, width * height * 4);
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvasToPngFile(canvas, file.name, dpi);
};

/** Anything `createImageBitmap` can decode, drawn to a PNG. */
const bitmapToPngFile = async (file: File, source: Blob | ImageBitmap, label: string): Promise<File> => {
  let bitmap: ImageBitmap;
  if (source instanceof Blob) {
    try {
      bitmap = await createImageBitmap(source);
    } catch {
      throw new UploadConvertError(
        `“${file.name}” is ${label}, but this browser can't open it. Please export it as PNG and upload that.`,
      );
    }
  } else {
    bitmap = source;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw tooLargeForBrowser(file, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    return await canvasToPngFile(canvas, file.name);
  } finally {
    bitmap.close();
  }
};

// ── SVG ────────────────────────────────────────────────────────────────────

const LENGTH = /^\s*([0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?)\s*(px|in|cm|mm|pt|pc)?\s*$/i;
const UNITS_PER_INCH: Record<string, number> = { px: 96, in: 1, cm: 2.54, mm: 25.4, pt: 72, pc: 6 };

/** An SVG length in inches, or null for a percentage, "auto" or anything unreadable. */
const lengthInInches = (value: string | null): number | null => {
  if (!value) return null;
  const match = LENGTH.exec(value);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = (match[2] || "px").toLowerCase();
  return n > 0 ? n / UNITS_PER_INCH[unit] : null;
};

/**
 * The physical size an SVG declares, in inches.
 *
 * From `width` and `height` with their units; a missing one follows the
 * `viewBox` proportions; with neither, the `viewBox` is read as CSS pixels
 * (96 to the inch), which is what every design tool writes. Null when the file
 * gives no size at all.
 */
export const parseSvgSizeIn = (svgText: string): { widthIn: number; heightIn: number } | null => {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.localName !== "svg" || doc.getElementsByTagName("parsererror").length) return null;

  const box = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  const viewBox = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0
    ? { w: box[2], h: box[3] }
    : null;

  let widthIn = lengthInInches(root.getAttribute("width"));
  let heightIn = lengthInInches(root.getAttribute("height"));
  if (widthIn && !heightIn && viewBox) heightIn = (widthIn * viewBox.h) / viewBox.w;
  if (heightIn && !widthIn && viewBox) widthIn = (heightIn * viewBox.w) / viewBox.h;
  if ((!widthIn || !heightIn) && viewBox) {
    widthIn = viewBox.w / 96;
    heightIn = viewBox.h / 96;
  }
  return widthIn && heightIn ? { widthIn, heightIn } : null;
};

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = url;
  });

/**
 * Renders an SVG at print resolution, at the size it declares.
 *
 * Drawn through an `<img>`, where the browser renders the vector itself and
 * nothing the file references externally can load — so a hostile SVG can
 * neither run script nor fetch anything. Fonts and images an SVG links to
 * rather than embeds do not appear, the same as when it is opened directly.
 */
const rasterizeSvg = async (file: File): Promise<File> => {
  const text = await file.text();
  const size = parseSvgSizeIn(text);
  if (!size) {
    throw new UploadConvertError(
      `“${file.name}” doesn't say how big it is (no width, height or viewBox). Please re-export it with a size set, or as PDF, and try again.`,
    );
  }

  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  // Without a viewBox, width and height alone set no scale: resizing them
  // would crop the drawing rather than enlarge it. Its user units are CSS
  // pixels, so the viewBox is exactly the declared size in pixels.
  if (!root.getAttribute("viewBox")) {
    root.setAttribute("viewBox", `0 0 ${size.widthIn * 96} ${size.heightIn * 96}`);
  }

  let tooLarge = true;
  let lastDpi = 0;
  for (const budget of PRINT_PIXEL_BUDGETS) {
    const dpi = printDpiWithin(size.widthIn, size.heightIn, budget);
    if (dpi < PDF_MIN_RASTER_DPI || dpi === lastDpi) continue;
    tooLarge = false;
    lastDpi = dpi;
    const widthPx = Math.max(1, Math.round(size.widthIn * dpi));
    const heightPx = Math.max(1, Math.round(size.heightIn * dpi));
    root.setAttribute("width", String(widthPx));
    root.setAttribute("height", String(heightPx));

    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(doc)], { type: "image/svg+xml" }),
    );
    try {
      const img = await loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = widthPx;
      canvas.height = heightPx;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0, widthPx, heightPx);
      return await canvasToPngFile(canvas, file.name, dpi);
    } catch (err) {
      if (err instanceof UploadConvertError) continue;
      throw new UploadConvertError(
        `“${file.name}” could not be drawn. It may use features browsers don't support, or be damaged. Please export it as PDF and try again.`,
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (tooLarge) {
    throw new UploadConvertError(
      `“${file.name}” is ${size.widthIn.toFixed(2)}×${size.heightIn.toFixed(2)}in, too large to convert at print resolution.`,
    );
  }
  throw new UploadConvertError(`“${file.name}” could not be converted in this browser. Please export it as PNG or PDF and try again.`);
};

// ── TIFF ───────────────────────────────────────────────────────────────────

/** A TIFF resolution tag in dots per inch, when it gives one. */
const tiffDpi = (ifd: Record<string, any>): number | undefined => {
  const x = Number(Array.isArray(ifd.t282) ? ifd.t282[0] : ifd.t282);
  const unit = Number(Array.isArray(ifd.t296) ? ifd.t296[0] : ifd.t296 ?? 2);
  if (!Number.isFinite(x) || x <= 0 || unit === 1) return undefined;
  return unit === 3 ? x * 2.54 : x;
};

const convertTiff = async (file: File): Promise<ConvertedUpload> => {
  const mod: any = await import("utif");
  const UTIF = mod.default ?? mod;
  const buffer = await file.arrayBuffer();
  let ifds: Array<Record<string, any>>;
  try {
    ifds = UTIF.decode(buffer);
  } catch {
    throw damaged(file, "a TIFF");
  }
  // Full-resolution images only: subfile type bit 0 marks a reduced preview.
  const pages = ifds.filter((ifd) => {
    const w = Number(ifd.t256?.[0]);
    const h = Number(ifd.t257?.[0]);
    const subfile = Number(ifd.t254?.[0] ?? 0);
    return w > 0 && h > 0 && (subfile & 1) === 0;
  });
  if (pages.length === 0) throw damaged(file, "a TIFF");

  const page = pages[0];
  try {
    UTIF.decodeImage(buffer, page, ifds);
  } catch {
    throw new UploadConvertError(
      `“${file.name}” uses a TIFF compression this app can't read. Please re-save it as an uncompressed or LZW TIFF, or as PNG, and try again.`,
    );
  }
  const rgba: Uint8Array = UTIF.toRGBA8(page);
  const png = await pixelsToPngFile(file, rgba, page.width, page.height, tiffDpi(page));
  return {
    files: [png],
    notices: pages.length > 1 ? [`“${file.name}” has ${pages.length} pages. Only the first was added.`] : [],
  };
};

// ── PSD ────────────────────────────────────────────────────────────────────

const convertPsd = async (file: File): Promise<File> => {
  const { readPsd } = await import("ag-psd");
  const buffer = await file.arrayBuffer();
  let psd: any;
  try {
    // The flattened composite only: layers are not needed, and decoding them
    // is what makes a layered print file slow and memory-hungry.
    psd = readPsd(buffer, { skipLayerImageData: true, skipThumbnail: true, useImageData: true });
  } catch (err: any) {
    console.warn(`[UPLOAD] ${file.name} — PSD read failed`, err);
    throw damaged(file, "a Photoshop file");
  }
  const image = psd.imageData as { width: number; height: number; data: Uint8ClampedArray } | undefined;
  if (!image || !image.width || !image.height) {
    throw new UploadConvertError(
      `“${file.name}” has no flattened image saved in it. In Photoshop, turn on “Maximize PSD and PSB File Compatibility” (Preferences › File Handling) and save again, or export it as PNG.`,
    );
  }
  const res = psd.imageResources?.resolutionInfo;
  const dpi = res ? (res.horizontalResolutionUnit === "PPCM" ? res.horizontalResolution * 2.54 : res.horizontalResolution) : undefined;
  return pixelsToPngFile(file, image.data, image.width, image.height, dpi);
};

// ── HEIC ───────────────────────────────────────────────────────────────────

const convertHeic = async (file: File): Promise<File> => {
  // Safari decodes HEIC itself; only other browsers need libheif.
  try {
    const native = await createImageBitmap(file);
    return await bitmapToPngFile(file, native, "HEIC");
  } catch {
    /* fall through to the decoder */
  }
  const { heicTo } = await import("heic-to");
  let bitmap: ImageBitmap;
  try {
    bitmap = await heicTo({ blob: file, type: "bitmap" });
  } catch (err) {
    console.warn(`[UPLOAD] ${file.name} — HEIC decode failed`, err);
    throw damaged(file, "a HEIC photo");
  }
  return bitmapToPngFile(file, bitmap, "HEIC");
};

// ── Dispatch ───────────────────────────────────────────────────────────────

/** A PNG or JPEG, with its type set from its contents so the upload is accepted. */
const asDirect = (file: File, kind: "png" | "jpeg"): File => {
  const type = kind === "png" ? "image/png" : "image/jpeg";
  return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
};

/**
 * Validates one upload and converts it to PNG where it needs converting.
 *
 * Throws `UploadConvertError` with a message for the customer; anything else
 * thrown is a bug, and the caller reports it generically.
 */
export const convertUpload = async (file: File, options: ConvertOptions = {}): Promise<ConvertedUpload> => {
  const validation = await validateImageFile(file);
  if (!validation.ok) throw new UploadConvertError(validation.message!);
  const kind = validation.detected;

  if (kind === "png" || kind === "jpeg") return { files: [asDirect(file, kind)], notices: [] };

  options.onConverting?.();
  const label = LABELS[kind as NonNullable<DetectedKind>] ?? "an image";

  switch (kind) {
    case "pdf": {
      try {
        const result = await rasterizePdf(file, options.onProgress);
        const notices: string[] = [];
        if (result.truncated) {
          notices.push(`“${file.name}” has ${result.totalPages} pages. Only the first ${PDF_MAX_PAGES} were added.`);
        }
        if (result.tooLarge.length > 0) {
          const numbers = result.tooLarge.map((p) => p.pageNumber).join(", ");
          const one = result.tooLarge.length === 1;
          notices.push(`${one ? "Page" : "Pages"} ${numbers} of “${file.name}” ${one ? "was" : "were"} skipped — too large to convert at print resolution.`);
        }
        for (const page of result.pages) {
          if (!page.lowResImageDpi) continue;
          const where = result.totalPages > 1 ? `Page ${page.pageNumber} of “${file.name}”` : `“${file.name}”`;
          notices.push(
            `${where} holds a picture at about ${page.lowResImageDpi} DPI at this size — print needs 300. It will print soft unless you make it smaller or use DPI+.`,
          );
        }
        return { files: result.pages.map((p) => p.file), notices };
      } catch (err) {
        if (err instanceof PdfRasterizeError) throw new UploadConvertError(err.message);
        throw err;
      }
    }
    case "svg":
      return { files: [await rasterizeSvg(file)], notices: [] };
    case "tiff":
      return convertTiff(file);
    case "psd":
      return { files: [await convertPsd(file)], notices: [] };
    case "heic":
      return { files: [await convertHeic(file)], notices: [] };
    case "webp":
    case "avif":
    case "bmp":
      return { files: [await bitmapToPngFile(file, file, label)], notices: [] };
    case "gif":
      return {
        files: [await bitmapToPngFile(file, file, label)],
        notices: [`“${file.name}” is a GIF. If it is animated, only its first frame was added.`],
      };
    default:
      throw new UploadConvertError(`“${file.name}” isn't a format that can be printed. Please export it as PNG and try again.`);
  }
};
