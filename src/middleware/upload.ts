import multer from "multer";
import { Request } from "express";

/**
 * Must match `ACCEPTED_IMAGE_TYPES` in the store's artboard config.
 *
 * PDF was missing here while being supported everywhere else: the file picker
 * offers it, the empty state advertises "PNG • JPG • PDF", the client validates
 * its magic bytes, `ArtboardItem` renders it, and `uploadAsset` has a dedicated
 * `isPdfUpload` branch. This filter was the one place that refused it — so the
 * whole feature was unreachable.
 */
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
};

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ALLOWED_TYPES[file.mimetype]) {
    cb(null, true);
    return;
  }
  /*
   * Carries a statusCode, so the message survives.
   *
   * A bare `Error` has none, and the error handler treats anything without one
   * as an internal fault — so uploading a .txt answered 500 "Something went
   * wrong. Please try again.", discarding the sentence that said exactly what
   * was wrong and what to do about it.
   */
  const error = new Error(
    `“${file.originalname}” is a ${file.mimetype || "file of unknown type"}. Please upload a PNG, JPG, SVG or PDF.`,
  ) as Error & { statusCode?: number };
  error.statusCode = 400;
  cb(error);
};

/**
 * Per-file ceiling on direct uploads.
 *
 * `memoryStorage` buffers the whole file in the Node heap, and no limit was
 * configured — so a single request could allocate as much as the client chose
 * to send, and concurrent ones could exhaust the process. 64 MB comfortably
 * covers a print-resolution PNG while bounding that exposure.
 */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});
