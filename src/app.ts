import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import mongoose from "mongoose";
import apiRouter from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";

const app = express();

app.use(cors({ exposedHeaders: ["Content-Disposition"] }));
/**
 * Body limits, scoped by what each route legitimately carries.
 *
 * A single 50 MB ceiling on every route was both too permissive and not
 * actually sufficient. Too permissive because `express.json` buffers the entire
 * body in the Node heap before parsing, so a handful of concurrent large
 * requests can exhaust it — a 50 MB limit on `/orders` is a memory-exhaustion
 * vector for no benefit. Not sufficient because an order carrying embedded
 * artwork sailed past it anyway and still 413'd.
 *
 * The architectural fix is that artwork never travels in an order at all: the
 * artboard uploads canvas results as they are produced (see `materializeAsset`)
 * and every later request carries a URL. Orders are therefore geometry,
 * pricing and addresses — kilobytes — and the tight limit below is the thing
 * that keeps them that way rather than letting the old shape creep back in.
 *
 * Three tiers:
 *  - `materialize` takes one image as raw bytes. Generous, and bounded to one
 *    image per request.
 *  - The rest of `/customer/assets/*` takes one image as a `data:` URL in JSON
 *    (`trim`, `fade-check`, `upscale`, `ai-edit`). Same job, base64-inflated.
 *  - Everything else is metadata. 2 MB is ample for a sheet of several thousand
 *    placements once artwork is referenced rather than embedded.
 */
const RAW_IMAGE_LIMIT = "64mb";
const IMAGE_JSON_LIMIT = "25mb";
const STANDARD_BODY_LIMIT = "2mb";

// Mounted ahead of the JSON parsers: materialize receives one image as raw
// bytes, so it must not be handed to `express.json` first.
app.use(
  "/api/customer/assets/materialize",
  express.raw({ type: "application/octet-stream", limit: RAW_IMAGE_LIMIT }),
);
// Prefix mount, so a route added to this family later inherits the right limit
// instead of silently falling to the 2 MB tier.
app.use("/api/customer/assets", express.json({ limit: IMAGE_JSON_LIMIT }));
app.use(express.json({ limit: STANDARD_BODY_LIMIT }));
app.use(express.urlencoded({ limit: STANDARD_BODY_LIMIT, extended: true }));

/**
 * Request-size monitoring.
 *
 * Logs anything approaching its limit, so an oversized payload is diagnosable
 * from ordinary logs rather than only when it fails. The warning threshold sits
 * well below the limit deliberately: catching the trend is what prevents the
 * outage, and a request at 60% of budget is already a design problem worth
 * seeing.
 */
const SIZE_WARN_BYTES = 512 * 1024;
app.use((req: Request, _res: Response, next: NextFunction) => {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > SIZE_WARN_BYTES) {
    console.warn(
      `[REQUEST_SIZE] ${req.method} ${req.originalUrl} — ${(declared / 1048576).toFixed(2)} MB`,
    );
  }
  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith("/api")) return next();
  if (req.path === "/api/health") return next();
  if (mongoose.connection.readyState === 1) return next();
  res.status(503).json({
    message: "Database unavailable. Ensure MongoDB is running and MONGO_URI is set correctly."
  });
});

// Redact a `token` query param so auth tokens used for native file downloads
// never end up in the request logs.
const redactUrl = (url: string) => url.replace(/([?&]token=)[^&]+/gi, "$1REDACTED");

// Request Logger (Professional logging for debugging)
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  // Capture original send/json methods to intercept response body
  const originalSend = res.send;
  const originalJson = res.json;

  // Intercept response body for logging errors or important responses
  res.send = function (body?: any): Response {
    res.locals.responseBody = body;
    return originalSend.apply(this, arguments as any);
  };

  res.json = function (body?: any): Response {
    res.locals.responseBody = body;
    return originalJson.apply(this, arguments as any);
  };

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const logColor = status >= 400 ? '\x1b[31m' : '\x1b[32m'; // Red for error, Green for success
    const resetColor = '\x1b[0m';
    
    console.log(`${logColor}[${new Date().toISOString()}] ${req.method} ${redactUrl(req.url)} ${status} ${duration}ms${resetColor}`);
    
    // Log response body for BOTH success and error (limited to 500 chars for success to avoid clutter)
    const bodyToLog = res.locals.responseBody;
    if (bodyToLog) {
      let formattedBody: string;
      try {
        formattedBody = typeof bodyToLog === 'object' ? JSON.stringify(bodyToLog, null, 2) : String(bodyToLog);
      } catch (e) {
        formattedBody = '[Circular/Unserializable]';
      }

      if (status >= 400) {
        console.log(`${logColor}Error Response:${resetColor}\n${formattedBody}`);
      } else {
        // For success, truncate if too long (e.g. huge lists), but show enough to verify
        const preview = formattedBody.length > 1000 ? formattedBody.substring(0, 1000) + '... (truncated)' : formattedBody;
        console.log(`${logColor}Response Body:${resetColor}\n${preview}`);
      }
    }
  });

  console.log(`[${new Date().toISOString()}] ${req.method} ${redactUrl(req.url)}`);

  // Fix: Trim trailing spaces from URL if present (often happens with copy-paste)
  if (req.url.endsWith('%20') || req.url.endsWith(' ')) {
    req.url = req.url.trim().replace(/%20$/, '');
    console.log(`[Auto-Correction] Trimmed URL to: ${req.url}`);
  }
  
  next();
});

const uploadsDir = path.join(process.cwd(), "uploads");

// On-demand WebP thumbnail generator.
// Intercepts requests for *-thumb200.webp files that don't exist yet, generates them
// from the source file, then falls through to express.static which serves the result.
app.use("/uploads", async (req: Request, res: Response, next: NextFunction) => {
  const filename = path.basename(req.path);
  if (!filename.endsWith("-thumb200.webp")) return next();

  const thumbPath = path.join(uploadsDir, filename);
  if (fs.existsSync(thumbPath)) return next(); // already cached on disk

  // Derive source filename: strip -thumb200.webp suffix, try multiple extensions
  const stem = filename.slice(0, -"-thumb200.webp".length);
  const candidates = [".png", ".jpg", ".jpeg", ".webp", ".gif", "-trim.png"];
  let generated = false;
  for (const ext of candidates) {
    const srcPath = path.join(uploadsDir, stem + ext);
    if (fs.existsSync(srcPath)) {
      try {
        await fs.promises.mkdir(uploadsDir, { recursive: true });
        await sharp(srcPath, { limitInputPixels: false })
          .resize(200, 200, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(thumbPath);
        generated = true;
        break;
      } catch { /* try next candidate */ }
    }
  }
  if (!generated) return res.status(404).end();
  next();
});

// Serve static files with immutable caching.
// Upload filenames contain timestamps + random IDs so they never change content —
// a 1-year immutable cache is safe and eliminates repeat downloads entirely.
app.use(
  "/uploads",
  express.static(uploadsDir, {
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("Vary", "Accept-Encoding");
    },
  }),
);

app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.use("/api", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
