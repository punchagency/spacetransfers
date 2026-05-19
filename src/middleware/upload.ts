import multer from "multer";
import fs from "fs";
import path from "path";
import { Request } from "express";

const uploadsDir = path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination(req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) {
    cb(null, uploadsDir);
  },
  filename(req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}.png`);
  }
});

const pngOnly = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (file.mimetype === "image/png") {
    cb(null, true);
  } else {
    cb(new Error("Only PNG files are accepted. Please convert your image to PNG before uploading."));
  }
};

export const upload = multer({ storage, fileFilter: pngOnly });
