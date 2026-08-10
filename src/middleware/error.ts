import { Request, Response, NextFunction } from "express";

export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  res.status(404).json({ message: "Not found" });
};

export interface CustomError extends Error {
  statusCode?: number;
}

export const errorHandler = (err: CustomError, req: Request, res: Response, next: NextFunction): void => {
  const rawMessage = err.message || "Internal server error";
  const isDbDown =
    rawMessage.includes("ECONNREFUSED") ||
    rawMessage.includes("MongooseServerSelectionError") ||
    rawMessage.includes("MongoServerSelectionError") ||
    rawMessage.includes("connect ECONNREFUSED") ||
    rawMessage.includes("MongoDB connection error");

  /**
   * Body-parser rejection, or a file over multer's ceiling.
   *
   * Express answers both with a bare status and an HTML body, which is
   * indistinguishable from a network failure at the client and names nothing
   * anyone can act on. Anything reaching here carries image data somewhere the
   * upload path does not cover, so the log records the actual size.
   */
  if (
    (err as any).type === "entity.too.large" ||
    (err as any).code === "LIMIT_FILE_SIZE" ||
    (err as any).status === 413
  ) {
    console.error(
      `[PAYLOAD_TOO_LARGE] ${req.method} ${req.originalUrl} — ` +
        `received ${(err as any).length ?? "unknown"} bytes, limit ${(err as any).limit ?? "unknown"}`,
    );
    res.status(413).json({
      message:
        (err as any).code === "LIMIT_FILE_SIZE"
          ? "That image is too large to upload. Please re-export it at a smaller size and try again."
          : "This request is too large to send. Please reload the page and try again — your artwork is safe.",
    });
    return;
  }

  const statusCode = err.statusCode || (isDbDown ? 503 : 500);
  const message = isDbDown
    ? "Database unavailable. Ensure MongoDB is running and MONGO_URI is set correctly."
    : rawMessage;
  res.status(statusCode).json({ message });
};
