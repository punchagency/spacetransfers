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
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

export const upload = multer({ storage });
