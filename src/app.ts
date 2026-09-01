import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import mongoose from "mongoose";
import apiRouter from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { env } from "./config/env.js";

const app = express();

/*
 * One proxy hop — Render's load balancer sits in front of this.
 *
 * Required for the auth rate limits to key on the caller rather than on the
 * proxy. Without it every request carries the balancer's address, so the first
 * ten sign-in attempts from anywhere would lock out everybody.
 *
 * Deliberately `1`, not `true`: trusting the whole chain lets a caller forge
 * `X-Forwarded-For` and hand themselves a fresh bucket per request, which is
 * worse than no limiting at all because it looks like it works.
 */
app.set("trust proxy", 1);

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

/**
 * Response bodies are logged in development only.
 *
 * They used to be logged everywhere, which put working credentials into stdout:
 * a successful `/auth/login` or `/auth/register` writes its JWT, and every order
 * response writes the customer's name, email and address. On a hosted platform
 * stdout is captured and retained, so a log reader held live sessions for as
 * long as those tokens were valid.
 *
 * The status line — method, URL, status, duration — is what actually helps in
 * production, and it carries nothing sensitive.
 */
const LOG_RESPONSE_BODIES = env.nodeEnv === "development";

/**
 * Anything that is a credential, or identifies a person, in the shapes this API
 * returns. Redaction is by key name and applied at every depth, because these
 * appear nested — `user.email`, `order.customer.email` — as often as at the top.
 */
const SENSITIVE_KEYS = new Set([
  "token",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "client_secret",
  "password",
  "passwordHash",
  "newPassword",
  "currentPassword",
  "resetPasswordTokenHash",
  "inviteToken",
  "secret",
  "apiKey",
  "authorization",
  "email",
  "phone",
]);

const redactBody = (value: unknown, depth = 0): unknown => {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactBody(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key) ? "[REDACTED]" : redactBody(val, depth + 1);
  }
  return out;
};

/**
 * Last line of defence, applied to the rendered string.
 *
 * Key-based redaction only works on a body we can walk. A handler that sends a
 * pre-serialized string, or a shape nobody anticipated, would slip past it — and
 * the thing being missed is a live credential, so it is worth catching by shape
 * as well as by name.
 */
const redactText = (text: string): string =>
  text
    // JWTs: three base64url segments. The signature is what makes it usable, so
    // the head is left visible for correlating a log line with a session.
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, "eyJ…[REDACTED_JWT]")
    .replace(/\b(sk_live|sk_test|rk_live|whsec)_[A-Za-z0-9]{8,}/g, "$1_[REDACTED]");

// Request Logger (Professional logging for debugging)
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  // Capture original send/json methods to intercept response body
  const originalSend = res.send;
  const originalJson = res.json;

  /*
   * Capture the response body for logging — the object, not its serialization.
   *
   * `res.json()` serializes and then calls `res.send()` with the resulting
   * string, so a naive pair of overrides runs both and the string version wins.
   * That defeated redaction outright: the logger tested `typeof body === object`
   * to decide whether to walk and redact it, saw a string, and printed the raw
   * JSON — tokens included.
   *
   * `res.json` therefore claims the slot and `res.send` only fills it if nothing
   * has.
   */
  res.send = function (body?: any): Response {
    if (!res.locals.responseBodyCaptured) {
      res.locals.responseBody = body;
      res.locals.responseBodyCaptured = true;
    }
    return originalSend.apply(this, arguments as any);
  };

  res.json = function (body?: any): Response {
    res.locals.responseBody = body;
    res.locals.responseBodyCaptured = true;
    return originalJson.apply(this, arguments as any);
  };

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const logColor = status >= 400 ? '\x1b[31m' : '\x1b[32m'; // Red for error, Green for success
    const resetColor = '\x1b[0m';
    
    console.log(`${logColor}[${new Date().toISOString()}] ${req.method} ${redactUrl(req.url)} ${status} ${duration}ms${resetColor}`);
    
    // Bodies in development only, and redacted even there — a local log is still
    // a file, and these are still real credentials.
    const bodyToLog = res.locals.responseBody;
    if (LOG_RESPONSE_BODIES && bodyToLog) {
      let formattedBody: string;
      try {
        formattedBody =
          typeof bodyToLog === 'object'
            ? JSON.stringify(redactBody(bodyToLog), null, 2)
            : String(bodyToLog);
        formattedBody = redactText(formattedBody);
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
