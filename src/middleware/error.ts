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

  if (isDbDown) {
    res.status(503).json({
      message: "Database unavailable. Ensure MongoDB is running and MONGO_URI is set correctly.",
    });
    return;
  }

  /*
   * An error carrying a statusCode was raised deliberately, and its message was
   * written to be read by whoever made the request. Anything else reached here
   * by accident, and its message describes our internals.
   *
   * Those used to be echoed verbatim. A malformed cursor on the public orders
   * feed answered with `Cast to ObjectId failed for value "…" at path "_id" for
   * model "Order"` — handing an anonymous caller the model name and schema path.
   * Third-party failures are worse: a Stripe or ShipStation error message can
   * carry account identifiers, and it would have gone straight to the client.
   *
   * The detail still exists; it goes to the server log where it is useful and
   * not to the response where it is a disclosure.
   */
  if (typeof err.statusCode === "number") {
    res.status(err.statusCode).json({ message: rawMessage });
    return;
  }

  console.error(
    `[UNHANDLED] ${req.method} ${req.originalUrl} — ${err.name || "Error"}: ${rawMessage}`,
    err.stack,
  );
  res.status(500).json({ message: "Something went wrong. Please try again." });
};
