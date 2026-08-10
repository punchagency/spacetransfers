import multer from "multer";
import { Request } from "express";

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/svg+xml": ".svg",
};

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ALLOWED_TYPES[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error("Unsupported file type. Please use PNG, JPG, or SVG."));
  }
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
