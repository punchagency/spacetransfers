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

  /**
   * An error from a third-party SDK, not from us.
   *
   * These carry their own `statusCode`, so they fell through the branch below
   * and were returned verbatim — with the upstream's status as if it were ours.
   *
   * Stripe with an unset key answers 401 "Invalid API Key provided:
   * sk_test_*******lder". That reached the browser as a 401, and every client's
   * `apiFetch` reads a 401 as a dead session: pressing "Connect Stripe account"
   * called `clearAuth()` and **signed the partner out**, while their token was
   * still perfectly valid. It also handed the caller a fragment of our API key
   * and the name of the service that rejected it.
   *
   * An upstream refusing *our* credentials is our misconfiguration, so it is a
   * 502. The detail goes to the log, where it is the thing an operator needs.
   */
  const asAny = err as any;
  const isUpstreamSdkError =
    typeof asAny?.type === "string" && asAny.type.startsWith("Stripe") ||
    typeof asAny?.rawType === "string" ||
    Boolean(asAny?.raw && typeof asAny.raw === "object" && "message" in asAny.raw) ||
    (err?.constructor?.name ?? "").startsWith("Stripe");

  if (isUpstreamSdkError) {
    console.error(
      `[UPSTREAM] ${req.method} ${req.originalUrl} — ${asAny.type || err.name}: ${rawMessage}`,
    );
    res.status(502).json({
      message:
        "A payment service we rely on rejected the request. This is a configuration problem on our side, not with your account — please try again shortly.",
    });
    return;
  }

  if (typeof err.statusCode === "number") {
    res.status(err.statusCode).json({ message: rawMessage });
    return;
  }

  // An id in the URL that is not an id at all: nothing by that name exists.
  if (err.name === "CastError" && asAny?.kind === "ObjectId") {
    res.status(404).json({ message: "Not found" });
    return;
  }

  console.error(
    `[UNHANDLED] ${req.method} ${req.originalUrl} — ${err.name || "Error"}: ${rawMessage}`,
    err.stack,
  );
  res.status(500).json({ message: "Something went wrong. Please try again." });
};
