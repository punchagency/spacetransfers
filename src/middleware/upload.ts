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

export const upload = multer({ storage: multer.memoryStorage(), fileFilter });
