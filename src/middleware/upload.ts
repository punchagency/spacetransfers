import multer from "multer";
import { Request } from "express";

/**
 * Types any upload route will take. Each route may narrow further.
 *
 * PDF is here for partner certification documents (`/printer/profile/upload`).
 * Artwork PDFs are refused by `uploadAsset` itself: the store renders each page
 * to a PNG before uploading, because a stored PDF cannot be printed.
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

const PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Photos sent with a problem report: images only, and far smaller than artwork. */
export const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (PHOTO_TYPES.has(file.mimetype)) return cb(null, true);
    const error = new Error(`“${file.originalname}” isn't a photo we can take. Please add a JPG or PNG.`) as Error & { statusCode?: number };
    error.statusCode = 400;
    cb(error);
  },
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

/** Proof of rights sent with a dispute: a licence is often a PDF, or a photo of one. */
export const uploadEvidence = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (PHOTO_TYPES.has(file.mimetype) || file.mimetype === "application/pdf") return cb(null, true);
    const error = new Error(`“${file.originalname}” can't be attached. Please add a PDF, JPG or PNG.`) as Error & { statusCode?: number };
    error.statusCode = 400;
    cb(error);
  },
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

