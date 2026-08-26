import { Request, Response, NextFunction } from "express";
import { User } from "../models/user.model.js";
import { Asset } from "../models/asset.model.js";
import { Design } from "../models/design.model.js";
import { Order } from "../models/order.model.js";
import { Settings } from "../models/settings.model.js";
import sharp from "sharp";
import mongoose from "mongoose";
import crypto from "node:crypto";
import os from "node:os";
import { env } from "../config/env.js";
import { renderInvoicePdf } from "../services/invoicePdf.service.js";
import fs from "fs";
import path from "path";
import { smartTrimToFile } from "../utils/aiCrop.js";
import { uploadBufferToCloudinary, cloudinaryThumbUrl, isCloudinaryUrl } from "../utils/cloudinary.js";
import {
  getGlobalPricing,
  computeTotals as computeOrderTotals,
  deriveItemUnitPrice,
  itemQuantity,
  sheetUnitPrice,
  normalizeShippingMethod,
  totalBillableSqFt,
} from "../services/pricing.service.js";
import { quoteShipping } from "../services/shipping.service.js";
import { deriveParcel } from "../services/packaging.service.js";
import { predictShippingOrigin } from "../services/orderAssignment.service.js";
import { autoAssignOrder } from "../services/orderAssignment.service.js";
import { exportGangsheetPng24, GANGSHEET_SHEET_WIDTH_IN } from "../services/gangsheetExport.service.js";
import { getRegionFromState, getLatLngFromState, getRegionFromCoords, normalizeRegion } from "../utils/region.js";
import { geocodeAddress } from "../utils/geocoding.js";
import { assertPersistable } from "../utils/documentSize.js";
import {
  assertBufferWithinBounds,
  decodeDataUrl,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
} from "../utils/imageBounds.js";
import { sendEmail } from "../services/email.service.js";
import { notifyAllAdmins } from "../services/adminNotifications.service.js";
import {
  editImageWithGemini,
  geminiImageModel,
  geminiPlanningReady,
  geminiReady,
  geminiStatus,
  geminiUnavailableReason,
  hasGemini,
  planEditWithGemini,
} from "../services/gemini.service.js";
import { conformToSource, readSourceGeometry } from "../utils/generativeImage.js";
import { detectFade } from "../services/fadeDetection.service.js";

interface CustomError extends Error {
  statusCode?: number;
}

// For Cloudinary URLs use URL transformation; for legacy local URLs derive -thumb200.webp path.
const computeThumbUrl = (assetUrl: string | null | undefined): string | null => {
  if (!assetUrl) return null;
  if (isCloudinaryUrl(assetUrl)) return cloudinaryThumbUrl(assetUrl);
  const lastSlash = assetUrl.lastIndexOf("/");
  const lastDot = assetUrl.lastIndexOf(".");
  if (lastDot <= lastSlash) return null;
  return assetUrl.substring(0, lastDot) + "-thumb200.webp";
};

// Trim an image buffer using temp files. Returns the trimmed PNG as a Buffer.
// Temp files are written to os.tmpdir().
const trimBuffer = async (inputBuffer: Buffer): Promise<Buffer> => {
  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const inputPath = path.join(tmpDir, `${id}-input.png`);
  const trimmedPath = path.join(tmpDir, `${id}-trim.png`);
  const cleanup = () => {
    fs.unlink(inputPath, () => {});
    fs.unlink(trimmedPath, () => {});
  };
  try {
    await sharp(inputBuffer, { limitInputPixels: false }).png().toFile(inputPath);
    await smartTrimToFile(inputPath, trimmedPath);
    return await fs.promises.readFile(trimmedPath);
  } finally {
    cleanup();
  }
};

/**
 * Converts an embedded image into a hosted one.
 *
 * The editor produces every canvas result — auto-crop, background removal,
 * colour removal, sticker borders, local AI edits — as a
 * `data:image/png;base64,…` URL and writes it onto the artboard item. Those are
 * the artwork itself rather than a reference to it, and at print resolution
 * each runs to tens of megabytes. Carried into an order they are what makes the
 * request oversized.
 *
 * The artboard calls this as soon as such a result appears, so an item holds a
 * short URL long before checkout. That is the architectural fix: artwork is
 * uploaded once, when it is created, and every later request references it.
 *
 * Accepts raw bytes (`application/octet-stream`) as the primary path. Base64
 * inside JSON inflates by 4/3 and forces the whole string to be buffered and
 * JSON-parsed before a byte is usable; raw bytes avoid both. The JSON form is
 * still honoured so a client that has not reloaded keeps working.
 */
export const materializeAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      const { url: hostedUrl } = await uploadBufferToCloudinary(
        req.body,
        "space-transfers/edited",
      );
      return res.json({ url: hostedUrl, materialized: true, bytes: req.body.length });
    }

    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      return next(Object.assign(new Error("url is required"), { statusCode: 400 }));
    }

    // Already hosted — echoed back so the client can call this indiscriminately
    // rather than duplicating the "does this need uploading?" test everywhere.
    if (!url.startsWith("data:")) {
      return res.json({ url, materialized: false });
    }

    const buffer = await fetchImageBuffer(url);
    const { url: hostedUrl } = await uploadBufferToCloudinary(buffer, "space-transfers/edited");
    res.json({ url: hostedUrl, materialized: true, bytes: buffer.length });
  } catch (error) {
    next(error);
  }
};

export const trimAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      const error = new Error("url is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }
  
    // Accept Cloudinary URLs and legacy local /uploads/ URLs.
    const isLocal = url.includes("/uploads/");
    const isCdn = isCloudinaryUrl(url);
    if (!isLocal && !isCdn) {
      const error = new Error("Invalid asset url") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // Fetch the source image into a buffer.
    let sourceBuffer: Buffer;
    if (isLocal) {
      const marker = "/uploads/";
      const idx = url.lastIndexOf(marker);
      const safeFilename = path.basename(url.substring(idx + marker.length));
      const localPath = path.join(process.cwd(), "uploads", safeFilename);
      if (fs.existsSync(localPath)) {
        sourceBuffer = await fs.promises.readFile(localPath);
      } else {
        // File not on disk (e.g. from a different server); fetch via HTTP if absolute URL.
        if (!/^https?:\/\//i.test(url)) {
          const error = new Error("Asset file not found") as CustomError;
          error.statusCode = 404;
          throw error;
        }
        const r = await fetch(url);
        if (!r.ok) {
          const error = new Error("Asset file not found") as CustomError;
          error.statusCode = 404;
          throw error;
        }
        sourceBuffer = Buffer.from(await r.arrayBuffer());
      }
    } else {
      const r = await fetch(url);
      if (!r.ok) {
        const error = new Error("Asset file not found") as CustomError;
        error.statusCode = 404;
        throw error;
      }
      sourceBuffer = Buffer.from(await r.arrayBuffer());
    }

    const trimmedBuffer = await trimBuffer(sourceBuffer);

    const { url: trimmedUrl } = await uploadBufferToCloudinary(trimmedBuffer, "space-transfers/trimmed");

    const meta = await sharp(trimmedBuffer, { limitInputPixels: false }).metadata();
    const normalizedDpi = Math.max(150, Math.round(meta.density || 300));
    const trimmedWidthPx = meta.width || null;
    const trimmedHeightPx = meta.height || null;
    const trimmedWidthIn = trimmedWidthPx ? +(trimmedWidthPx / normalizedDpi).toFixed(4) : null;
    const trimmedHeightIn = trimmedHeightPx ? +(trimmedHeightPx / normalizedDpi).toFixed(4) : null;

    res.json({ trimmedUrl, trimmedWidthPx, trimmedHeightPx, trimmedWidthIn, trimmedHeightIn });
  } catch (error) {
    next(error);
  }
};

// ── AI Upscale ──────────────────────────────────────────────────────────────

// ── Upscaling constants ───────────────────────────────────────────────────────

const REPLICATE_ESRGAN_MODEL = "nightmareai/real-esrgan";
const REPLICATE_POLL_INTERVAL_MS = 2_500;
const REPLICATE_TIMEOUT_MS = 90_000;
const VALID_REPLICATE_SCALES = [2, 4, 8] as const;

// SwinIR-realworld 4× — best free model on HuggingFace Inference API.
const HF_SR_MODEL = "caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr";
const HF_MODEL_LOAD_TIMEOUT_MS = 60_000; // wait up to 60 s for cold-start
const MAX_OUTPUT_PX = 8_000;             // prevent runaway output sizes

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolves any artwork reference to bytes, with bounds enforced at the door.
 *
 * This is the single entry point for image data on the server, so validating
 * here covers every downstream operation — trim, upscale, fade check, AI edit,
 * gangsheet export — rather than each having to guard itself. Previously all
 * three branches were unbounded: a malformed data URL decoded to an empty
 * Buffer, and a remote URL could return arbitrarily many bytes.
 */
async function fetchImageBuffer(url: string): Promise<Buffer> {
  if (url.startsWith("data:")) {
    return decodeDataUrl(url);
  }
  if (url.includes("/uploads/")) {
    const marker = "/uploads/";
    const idx = url.lastIndexOf(marker);
    // basename() strips any traversal segments, so a crafted URL cannot escape
    // the uploads directory.
    const safeFilename = path.basename(url.substring(idx + marker.length));
    const localPath = path.join(process.cwd(), "uploads", safeFilename);
    if (fs.existsSync(localPath)) {
      // Checked before reading rather than after: a file over the ceiling
      // should not be pulled into memory just to be rejected.
      const { size } = await fs.promises.stat(localPath);
      if (size > MAX_IMAGE_BYTES) {
        throw Object.assign(
          new Error("That image is too large to process. Please re-export it at a smaller size."),
          { statusCode: 400, code: "IMAGE_TOO_LARGE" },
        );
      }
      return assertBufferWithinBounds(await fs.promises.readFile(localPath), "image");
    }
  }
  const r = await fetch(url);
  if (!r.ok) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });

  // Trust the advertised length when present, so an oversized remote asset is
  // refused before its body is buffered.
  const declared = Number(r.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw Object.assign(
      new Error("That image is too large to process. Please re-export it at a smaller size."),
      { statusCode: 400, code: "IMAGE_TOO_LARGE" },
    );
  }

  return assertBufferWithinBounds(Buffer.from(await r.arrayBuffer()), "image");
}

/**
 * Post-processes any upscaled buffer with a light unsharp mask.
 * AI models produce inherently sharper results so the pass is gentler;
 * the pure-sharp fallback gets a stronger pass because interpolation
 * introduces softness that must be compensated.
 */
// Replicate/HuggingFace scale purely off the requested factor, with no idea
// of the MAX_OUTPUT_PX ceiling the sharp tier already respects — a large
// `scale` against a sizeable source (e.g. the user enlarging the item a lot
// before requesting DPI enhancement) can return a multi-hundred-megapixel
// image that blows well past what fitUnderCloudinaryLimit's bounded resize
// loop can shrink under Cloudinary's 10MB cap. Clamp every AI tier's output
// to the same ceiling so all three tiers produce comparably-sized results.
async function capOutputPixels(buffer: Buffer, maxPx: number): Promise<Buffer> {
  const meta = await sharp(buffer, { limitInputPixels: false }).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (Math.max(w, h) <= maxPx) return buffer;
  const scale = maxPx / Math.max(w, h);
  return sharp(buffer, { limitInputPixels: false })
    .resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), {
      kernel: sharp.kernel.lanczos3,
    })
    .toBuffer();
}

async function applySharpening(
  buffer: Buffer,
  strength: "light" | "strong",
): Promise<Buffer> {
  // sigma, m1 (flat areas), m2 (edge areas)
  const params =
    strength === "strong"
      ? { sigma: 1.0, m1: 2.5, m2: 0.8 }
      : { sigma: 0.7, m1: 1.2, m2: 0.5 };
  return sharp(buffer, { limitInputPixels: false })
    .sharpen(params)
    .toBuffer();
}

// ── Tier 1: Replicate Real-ESRGAN ────────────────────────────────────────────

async function upscaleWithReplicate(
  publicUrl: string,
  scale: number,
  apiToken: string,
): Promise<Buffer> {
  const replicateScale =
    VALID_REPLICATE_SCALES.find((s) => s >= scale) ?? VALID_REPLICATE_SCALES[VALID_REPLICATE_SCALES.length - 1];

  const createRes = await fetch(
    `https://api.replicate.com/v1/models/${REPLICATE_ESRGAN_MODEL}/predictions`,
    {
      method: "POST",
      headers: { Authorization: `Token ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: { image: publicUrl, scale: replicateScale, face_enhance: false } }),
    },
  );
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    throw new Error(`Replicate ${createRes.status}: ${body.slice(0, 200)}`);
  }

  let prediction: { id: string; status: string; output?: string; error?: string } =
    await createRes.json();

  const deadline = Date.now() + REPLICATE_TIMEOUT_MS;
  while (
    prediction.status !== "succeeded" &&
    prediction.status !== "failed" &&
    prediction.status !== "canceled"
  ) {
    if (Date.now() > deadline) throw new Error("Replicate AI upscaling timed out (90 s)");
    await new Promise((r) => setTimeout(r, REPLICATE_POLL_INTERVAL_MS));
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { Authorization: `Token ${apiToken}` },
    });
    if (!pollRes.ok) throw new Error(`Replicate poll failed (${pollRes.status})`);
    prediction = await pollRes.json();
  }

  if (prediction.status !== "succeeded" || !prediction.output) {
    throw new Error(`Replicate failed: ${prediction.error ?? "unknown"}`);
  }

  const imgRes = await fetch(prediction.output);
  if (!imgRes.ok) throw new Error("Could not download upscaled image from Replicate CDN");
  return Buffer.from(await imgRes.arrayBuffer());
}

// ── Tier 2: HuggingFace SwinIR-realworld (free) ───────────────────────────────

async function upscaleWithHuggingFace(
  sourceBuffer: Buffer,
  apiToken: string,
  attempt = 0,
): Promise<Buffer> {
  const res = await fetch(
    `https://api-inference.huggingface.co/models/${HF_SR_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/octet-stream",
        "Accept": "image/png",
      },
      body: new Uint8Array(sourceBuffer),
    },
  );

  // 503 = model is cold-starting — wait the suggested time, then retry once.
  if (res.status === 503 && attempt === 0) {
    let waitMs = 20_000;
    try {
      const body: any = await res.json();
      if (typeof body?.estimated_time === "number") {
        waitMs = Math.min(body.estimated_time * 1_000 + 3_000, HF_MODEL_LOAD_TIMEOUT_MS);
      }
    } catch { /* body not JSON */ }
    console.log(`[UPSCALE] HuggingFace model loading — waiting ${Math.round(waitMs / 1000)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
    return upscaleWithHuggingFace(sourceBuffer, apiToken, 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HuggingFace ${res.status}: ${body.slice(0, 200)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

// ── Tier 3: Sharp multi-pass with unsharp mask (no API key needed) ────────────
//
// Single-pass Lanczos3 at high scale factors produces visible softness because
// the interpolation has no information to reconstruct missing detail.
// Breaking the upscale into 2× passes and applying an unsharp mask after each
// pass significantly improves perceived sharpness for print materials.

async function upscaleWithSharp(
  sourceBuffer: Buffer,
  originalWidthPx: number,
  originalHeightPx: number,
  scale: number,
): Promise<Buffer> {
  // Cap output dimensions so we don't produce gigapixel images.
  const maxScale = MAX_OUTPUT_PX / Math.max(originalWidthPx, originalHeightPx, 1);
  const clampedScale = Math.min(scale, maxScale);

  let buf = sourceBuffer;
  let currentW = originalWidthPx;
  let currentH = originalHeightPx;
  const targetW = Math.round(originalWidthPx * clampedScale);
  const targetH = Math.round(originalHeightPx * clampedScale);

  // Multi-pass: each pass doubles the size and applies an unsharp mask.
  // This is substantially better than a single large resize because each pass
  // restores edge information that would otherwise be averaged away.
  while (currentW < targetW || currentH < targetH) {
    const nextW = Math.min(currentW * 2, targetW);
    const nextH = Math.min(currentH * 2, targetH);
    buf = await sharp(buf, { limitInputPixels: false })
      .resize(nextW, nextH, { kernel: sharp.kernel.lanczos3, fastShrinkOnLoad: false })
      // Unsharp mask: moderate sigma keeps fine detail, low m2 avoids haloing.
      .sharpen({ sigma: 0.9, m1: 2.0, m2: 0.7 })
      .png({ compressionLevel: 6 })
      .toBuffer();
    currentW = nextW;
    currentH = nextH;
  }

  return buf;
}

// ── Main export ───────────────────────────────────────────────────────────────

export const upscaleAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url, scale: rawScale } = req.body || {};
    if (!url || typeof url !== "string") {
      return next(Object.assign(new Error("url is required"), { statusCode: 400 }));
    }

    const scale = Math.min(8, Math.max(2, Math.round(Number(rawScale) || 2)));

    const sourceBuffer = await fetchImageBuffer(url);
    const originalMeta = await sharp(sourceBuffer, { limitInputPixels: false }).metadata();
    const originalWidthPx = originalMeta.width ?? 0;
    const originalHeightPx = originalMeta.height ?? 0;

    let upscaledBuffer: Buffer = undefined as any;
    let tier = "";

    // Each tier falls through to the next if it errors (billing, quota, cold-start failure, etc.)
    if (env.replicateApiToken) {
      try {
        let publicUrl = url;
        if (url.startsWith("data:") || url.includes("/uploads/")) {
          const { url: tempUrl } = await uploadBufferToCloudinary(sourceBuffer, "space-transfers/upscale-input");
          publicUrl = tempUrl;
        }
        upscaledBuffer = await upscaleWithReplicate(publicUrl, scale, env.replicateApiToken);
        upscaledBuffer = await capOutputPixels(upscaledBuffer, MAX_OUTPUT_PX);
        upscaledBuffer = await applySharpening(upscaledBuffer, "light");
        tier = "replicate";
      } catch (replicateErr: any) {
        console.warn(`[UPSCALE] Replicate failed (${replicateErr?.message}) — falling back`);
        env.replicateApiToken = undefined; // suppress on future requests this session
        // fall through to next tier below
        upscaledBuffer = undefined as any;
        tier = "";
      }
    }

    if (!upscaledBuffer! && env.hfApiToken) {
      try {
        upscaledBuffer = await upscaleWithHuggingFace(sourceBuffer, env.hfApiToken);
        upscaledBuffer = await capOutputPixels(upscaledBuffer, MAX_OUTPUT_PX);
        upscaledBuffer = await applySharpening(upscaledBuffer, "light");
        tier = "huggingface";
      } catch (hfErr: any) {
        console.warn(`[UPSCALE] HuggingFace failed (${hfErr?.message}) — falling back to sharp`);
        upscaledBuffer = undefined as any;
        tier = "";
      }
    }

    if (!upscaledBuffer!) {
      upscaledBuffer = await upscaleWithSharp(sourceBuffer, originalWidthPx, originalHeightPx, scale);
      tier = "sharp";
    }

    console.log(`[UPSCALE] ${tier} — ${originalWidthPx}×${originalHeightPx} → scale ${scale}`);

    const { url: upscaledUrl } = await uploadBufferToCloudinary(upscaledBuffer, "space-transfers/upscaled");
    const upscaledMeta = await sharp(upscaledBuffer, { limitInputPixels: false }).metadata();

    res.json({
      upscaledUrl,
      originalWidthPx,
      originalHeightPx,
      widthPx: upscaledMeta.width ?? Math.round(originalWidthPx * scale),
      heightPx: upscaledMeta.height ?? Math.round(originalHeightPx * scale),
      scale,
      tier,
    });
  } catch (error) {
    next(error);
  }
};

// ── Generative AI editing ─────────────────────────────────────────────────────

/**
 * Instruction-based image editing model. Swapping vendors is a change to this
 * function alone — the client speaks only in {url, prompt, intent} and never
 * learns which model answered.
 */
const AI_EDIT_MODEL = process.env.AI_EDIT_MODEL || "black-forest-labs/flux-kontext-pro";
const AI_EDIT_TIMEOUT_MS = 120_000;

/**
 * Which optional inputs each model actually declares.
 *
 * Replicate validates the whole prediction against the model's schema and
 * rejects it with a 422 if it receives a field the model does not declare — so
 * an optional input is only ever sent to a model known to accept it. Anything
 * absent from this table falls back to the conservative profile (prompt +
 * image only), which every instruction-edit model supports.
 *
 * Confirm against `GET /v1/models/<owner>/<name>` before adding a row: the
 * flux-kontext family exposes no negative_prompt / guidance / step controls,
 * so those knobs are simply unavailable there and the guidance has to travel
 * inside the prompt text instead.
 */
interface ModelInputSupport {
  negativePrompt: boolean;
  guidance: boolean;
  steps: boolean;
  seed: boolean;
  promptUpsampling: boolean;
}

const CONSERVATIVE_INPUT_SUPPORT: ModelInputSupport = {
  negativePrompt: false,
  guidance: false,
  steps: false,
  seed: false,
  promptUpsampling: false,
};

const MODEL_INPUT_SUPPORT: Record<string, ModelInputSupport> = {
  "black-forest-labs/flux-kontext-pro": {
    ...CONSERVATIVE_INPUT_SUPPORT,
    seed: true,
    promptUpsampling: true,
  },
  "black-forest-labs/flux-kontext-max": {
    ...CONSERVATIVE_INPUT_SUPPORT,
    seed: true,
    promptUpsampling: true,
  },
};

const inputSupportFor = (model: string): ModelInputSupport =>
  MODEL_INPUT_SUPPORT[model] ?? CONSERVATIVE_INPUT_SUPPORT;

/**
 * Per-intent tuning. `guard` states what the model must preserve, `avoid` what
 * it must not do — the two together are what stops an edit bleeding outside the
 * thing the user asked to change, which is the dominant failure mode here.
 *
 * `upsample` asks the model to expand a terse instruction before running. It's
 * on for the chip-driven intents (whose prompts are a handful of words) and off
 * where the user's exact wording is the whole point — rewriting "make it gold"
 * into a paragraph is how a recolour turns into a restyle.
 */
interface IntentTuning {
  guard: string;
  avoid: string;
  upsample?: boolean;
  /** Optional per-intent override, e.g. route inpainting to a specialist model. */
  model?: string;
}

const INTENT_TUNING: Record<string, IntentTuning> = {
  "replace-bg": {
    guard:
      "Replace only the background behind the subject with what is described. Keep the subject's pose, proportions, colours and lighting exactly as they are, and blend its edges cleanly into the new background.",
    avoid:
      "altering, recolouring or moving the subject; leaving a halo, fringe or cut-out outline around the subject; changing the subject's scale or crop",
    upsample: true,
  },
  "change-color": {
    guard:
      "Recolour only the element described, to exactly the colour requested. Preserve its original shape, texture, shading, highlights and material finish.",
    avoid:
      "changing the background; altering any element other than the one named; flattening or posterising the shading; changing its shape, texture or proportions",
    // The colour word is the payload — upsampling tends to editorialise it.
    upsample: false,
  },
  "remove-object": {
    guard:
      "Remove the described object completely and reconstruct what would be behind it, matching the surrounding texture, lighting and perspective so it reads as though the object was never there.",
    avoid:
      "leaving fragments, outlines or ghosting of the removed object; blurring or smudging the patched area; altering any other element",
    upsample: true,
  },
  "add-shadow": {
    guard:
      "Add a single realistic contact shadow beneath the subject, consistent with the existing light direction, softness and intensity.",
    avoid:
      "modifying the subject itself; adding harsh pure-black or multiple conflicting shadows; changing the background",
    upsample: true,
  },
  "to-sticker": {
    guard:
      "Isolate the subject and present it as a die-cut sticker with a clean, even white contour border that follows its silhouette, on a plain background.",
    avoid:
      "cropping or clipping the subject; producing an uneven, broken or coloured border; adding drop shadows or background detail",
    upsample: true,
  },
  cartoon: {
    guard:
      "Restyle the artwork as described while preserving the original composition, pose, and the subject's identity and proportions.",
    avoid:
      "changing the composition or framing; adding or removing elements; distorting faces, hands or lettering",
    upsample: true,
  },
  "make-transparent": {
    guard:
      "Isolate the subject on a plain, empty background with clean, sharp edges.",
    avoid: "altering the subject; leaving background remnants, halos or soft fringing",
    upsample: true,
  },
  /**
   * Background removal normally runs in the browser (WASM segmentation), which
   * is both better and free. But the generative tier is the fallback for *every*
   * intent, so a client that cannot run the local path — a cross-origin asset
   * that taints the canvas, an unsupported browser — arrives here. Without
   * tuning it would get the bare global guard and no instruction to cut cleanly,
   * which on hair, fur and semi-transparent edges is the difference between a
   * usable cutout and a haloed one.
   */
  "remove-bg": {
    guard:
      "Remove the background completely, leaving only the subject on a plain empty background. Follow the subject's true silhouette precisely, including fine detail such as individual strands of hair, fur and thin or wispy edges, and keep partially transparent areas partially transparent rather than solid.",
    avoid:
      "altering, recolouring or re-framing the subject; leaving background remnants, a halo, a coloured fringe or a visible cut-out outline; hardening soft or wispy edges into a solid shape; discarding fine detail at the subject's boundary",
    upsample: true,
  },
  "remove-color": {
    guard:
      "Remove only the colour described, everywhere it appears. Where that colour was part of the background, leave plain empty space; where it was part of an object, reconstruct what the object looks like without it while keeping the object's shape and shading intact.",
    avoid:
      "altering any other colour in the image; shifting the overall hue, white balance or saturation; leaving speckles or a fringe of the removed colour along edges",
    upsample: true,
  },
  "replace-object": {
    guard:
      "Replace only the object described with the new one, matching the original's position, scale, orientation, perspective and lighting so it sits in the scene naturally.",
    avoid:
      "altering the background or any other object; changing the composition or framing; leaving traces of the original object; producing a pasted-on look with mismatched lighting or edges",
    upsample: true,
  },
  "add-object": {
    guard:
      "Add the described element to the image, matched to the existing perspective, scale, lighting direction and colour temperature, and correctly occluded by anything in front of it.",
    avoid:
      "altering or moving anything already in the image; changing the composition or framing; adding more than what was asked for; floating the new element with no contact shadow",
    upsample: true,
  },
  "isolate-subject": {
    guard:
      "Keep only the single main subject and remove every other person and object, reconstructing the background plausibly where they were.",
    avoid:
      "altering the main subject in any way; leaving fragments, limbs or shadows of the removed subjects; cropping or re-framing the image",
    upsample: true,
  },
  "sketch-to-photo": {
    guard:
      "Render the drawing as a photorealistic photograph, preserving the exact composition, pose, proportions and every element present in the sketch.",
    avoid:
      "adding elements absent from the sketch; changing the pose, layout or proportions; retaining visible line art, paper texture or pencil shading",
    upsample: true,
  },
  "style-transfer": {
    guard:
      "Re-render the image in the style described while preserving the composition, subject identity, pose and proportions exactly.",
    avoid:
      "changing the composition or framing; adding or removing elements; distorting faces, hands or lettering",
    upsample: true,
  },
  relight: {
    guard:
      "Change only the lighting as described. Re-derive shadows, highlights and colour temperature consistently across the whole scene while keeping every object's position, shape and material unchanged.",
    avoid:
      "moving, adding or removing objects; changing the subject's colours beyond what the new lighting implies; producing shadows inconsistent with the new light direction",
    upsample: true,
  },
  outpaint: {
    guard:
      "Extend the scene outward beyond its current edges, continuing the existing perspective, lighting, texture and content so the original area remains pixel-identical and the join is invisible.",
    avoid:
      "altering, rescaling or re-centring the original image content; introducing a visible seam, border or tonal step at the original edges; inventing a subject that contradicts the scene",
    upsample: true,
  },
  "generative-fill": {
    guard:
      "Fill the described region with plausible content that matches the surrounding texture, lighting, perspective and grain.",
    avoid:
      "altering anything outside the described region; blurring or smudging the filled area; leaving a visible patch boundary",
    upsample: true,
  },
};

/**
 * Applies to every generative edit regardless of intent. Text is called out
 * because these images are headed for transfer printing, where a model quietly
 * re-rendering a word into plausible-looking gibberish is both the most common
 * artefact and the most expensive one to discover after it is on a garment.
 */
const GLOBAL_GUARD =
  "Keep any text in the image exactly as written and fully legible unless the request explicitly asks to change it. Preserve the original framing and aspect ratio.";

/**
 * Intents the generative stack can serve, derived from the tuning table rather
 * than hand-listed so the capabilities probe cannot drift out of step with what
 * `buildEditRequest` actually knows how to guard. `custom` is appended because
 * a free-form prompt is always accepted — it simply carries no per-intent
 * tuning beyond the global guard.
 */
const SERVER_EDIT_INTENTS = [...Object.keys(INTENT_TUNING), "custom"];

export interface BuiltEditRequest {
  instruction: string;
  model: string;
  /** Extra model inputs, already filtered to what this model accepts. */
  extraInput: Record<string, unknown>;
}

/**
 * Expands a canonical intent into the full request the editing model receives.
 * The user's own words always lead, so a chip press and a typed sentence
 * converge on the same shape; the tuning is appended as constraints.
 *
 * Negative guidance goes into `negative_prompt` when the model has one and is
 * folded into the instruction text otherwise, so the constraint survives either
 * way. Each `avoid` entry is phrased as a gerund under a single governing
 * "Avoid all of the following:" header — a bare "Do not a; b; c" negates only
 * the first item and reads as an instruction to perform the rest.
 */
export const buildEditRequest = (
  intent: string,
  prompt: string,
  seed?: number,
): BuiltEditRequest => {
  const tuning = INTENT_TUNING[intent];
  const model = tuning?.model || AI_EDIT_MODEL;
  const support = inputSupportFor(model);
  const extraInput: Record<string, unknown> = {};

  const parts = [prompt.trim().replace(/\.$/, "")];
  if (tuning) {
    parts.push(tuning.guard);
    if (support.negativePrompt) extraInput.negative_prompt = tuning.avoid;
    else parts.push(`Avoid all of the following: ${tuning.avoid}.`);
    if (support.promptUpsampling && tuning.upsample) extraInput.prompt_upsampling = true;
  }
  parts.push(GLOBAL_GUARD);

  // A caller-supplied seed makes a run reproducible, which is what lets two
  // phrasings of the same edit be compared without the noise of a fresh sample.
  if (support.seed && Number.isFinite(seed)) extraInput.seed = Math.trunc(seed as number);

  return { instruction: parts.join(". ").replace(/\.\.+/g, "."), model, extraInput };
};

async function editWithReplicate(
  publicUrl: string,
  built: BuiltEditRequest,
  apiToken: string,
): Promise<Buffer> {
  const createRes = await fetch(
    `https://api.replicate.com/v1/models/${built.model}/predictions`,
    {
      method: "POST",
      headers: { Authorization: `Token ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          input_image: publicUrl,
          prompt: built.instruction,
          output_format: "png",
          safety_tolerance: 2,
          ...built.extraInput,
        },
      }),
    },
  );
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    throw new Error(`Replicate ${createRes.status}: ${body.slice(0, 200)}`);
  }

  let prediction: { id: string; status: string; output?: string | string[]; error?: string } =
    await createRes.json();

  const deadline = Date.now() + AI_EDIT_TIMEOUT_MS;
  while (
    prediction.status !== "succeeded" &&
    prediction.status !== "failed" &&
    prediction.status !== "canceled"
  ) {
    if (Date.now() > deadline) throw new Error("The AI edit timed out. Try a simpler prompt.");
    await new Promise((r) => setTimeout(r, REPLICATE_POLL_INTERVAL_MS));
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { Authorization: `Token ${apiToken}` },
    });
    if (!pollRes.ok) throw new Error(`Replicate poll failed (${pollRes.status})`);
    prediction = await pollRes.json();
  }

  if (prediction.status !== "succeeded" || !prediction.output) {
    throw new Error(`The model could not complete this edit: ${prediction.error ?? "unknown error"}`);
  }

  // Some models return a bare URL, others a one-element array.
  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  const imgRes = await fetch(outputUrl);
  if (!imgRes.ok) throw new Error("Could not download the edited image");
  return Buffer.from(await imgRes.arrayBuffer());
}

/**
 * Cloudflare Workers AI — the free tier of the generative path.
 *
 * Deliberately second in the chain, not first. This is SDXL-class img2img: it
 * takes an instruction and a source image but has none of flux-kontext's
 * instruction-following, so a "remove the person on the left" lands as a
 * re-imagining rather than a surgical edit. It exists so a credit lapse
 * degrades the result instead of ending the request.
 *
 * `strength` is the whole story for edit fidelity here. At 1.0 the model
 * effectively ignores the input and paints a new picture from the prompt, which
 * on a customer's artwork is indistinguishable from data loss. Held low so the
 * original survives the round-trip.
 */
const CF_EDIT_MODEL = "@cf/runwayml/stable-diffusion-v1-5-img2img";
const CF_EDIT_STRENGTH = 0.45;

async function editWithCloudflare(
  sourceBuffer: Buffer,
  built: BuiltEditRequest,
  accountId: string,
  apiToken: string,
): Promise<Buffer> {
  // SD 1.5 was trained at 512px and degrades badly off-ratio; sending a 4000px
  // gang-sheet asset straight in wastes the request and returns mush.
  const prepared = await sharp(sourceBuffer, { limitInputPixels: false })
    .resize(768, 768, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_EDIT_MODEL}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: built.instruction,
        image_b64: prepared.toString("base64"),
        strength: CF_EDIT_STRENGTH,
        guidance: 7.5,
        num_steps: 20,
      }),
      signal: AbortSignal.timeout(AI_EDIT_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Cloudflare ${response.status}: ${body.slice(0, 200)}`);
  }

  // Workers AI returns raw image bytes for image models, but some models answer
  // with the standard JSON envelope and a base64 payload instead. Both are
  // accepted so the tier doesn't break on a model-side response change.
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload: any = await response.json();
    const base64 = payload?.result?.image ?? payload?.result?.response;
    if (!base64 || typeof base64 !== "string") {
      throw new Error("Cloudflare returned no image");
    }
    return Buffer.from(base64, "base64");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("Cloudflare returned an empty image");
  return bytes;
}

const hasCloudflareEdit = (): boolean =>
  Boolean(env.cloudflareAccountId && env.cloudflareApiToken);

/**
 * When Replicate last reported it was out of credit.
 *
 * Held as a timestamp rather than by clearing `env.replicateApiToken`, for two
 * reasons. Destroying the token loses the distinction between "never
 * configured" and "configured but unfunded", which are different messages to
 * the customer. And it is permanent for the life of the process — topping up
 * the account would not bring the model back until someone restarted the
 * server, which is a support ticket nobody would connect to a deploy.
 *
 * The retry window is what makes it self-healing: a billing state can change at
 * any moment, so the tier is skipped for a while and then quietly tried again.
 */
let replicateOutOfCreditAt = 0;
const REPLICATE_CREDIT_RETRY_MS = 10 * 60_000;

const replicateEditReady = (): boolean =>
  Boolean(env.replicateApiToken) &&
  Date.now() - replicateOutOfCreditAt > REPLICATE_CREDIT_RETRY_MS;

/**
 * Readiness probe. The client caches this for the session and uses it to decide
 * whether generative chips are live, so a user never fires a request that is
 * guaranteed to 503.
 */
export const aiEditCapabilities = async (_req: Request, res: Response) => {
  // Enabled when *any* tier can serve, so the client keeps generative chips
  // live on the free provider alone. Reporting only Replicate here would grey
  // the whole feature out the moment credit ran dry, even with Gemini ready.
  //
  // Order matches the dispatch order in `aiEditAsset`, so `tiers[0]` is
  // genuinely the model that will answer the next request.
  const tiers = [
    ...(geminiReady() ? [{ provider: "gemini", model: geminiImageModel() }] : []),
    ...(replicateEditReady() ? [{ provider: "replicate", model: AI_EDIT_MODEL }] : []),
    ...(hasCloudflareEdit() ? [{ provider: "cloudflare", model: CF_EDIT_MODEL }] : []),
  ];

  // Lets an operator see *why* the feature is dark without reading logs, and
  // distinguishes the three states that look identical from the client:
  // nothing configured, configured but capped, configured but unfunded.
  const geminiState = geminiStatus();
  const reason =
    tiers.length > 0
      ? undefined
      : geminiState !== "unconfigured" && geminiState !== "ready"
      ? geminiState
      : env.replicateApiToken
      ? "out_of_credit"
      : undefined;

  res.json({
    enabled: tiers.length > 0,
    model: tiers[0]?.model,
    tiers,
    // The intents the whole stack can serve. The client uses this to decide
    // which chips are live, so a customer never clicks into a guaranteed error.
    intents: tiers.length > 0 ? SERVER_EDIT_INTENTS : [],
    // Multi-step planning rides on the text models, which have their own quota —
    // it stays available even while the *image* tier is capped or unfunded.
    planning: geminiPlanningReady(),
    ...(reason ? { reason } : {}),
    // The operator-facing fix, surfaced through the API so the reason a feature
    // is dark is visible without shell access to the logs.
    ...(tiers.length === 0 && geminiUnavailableReason()
      ? { detail: geminiUnavailableReason() }
      : {}),
  });
};

/**
 * AI fade check for an already-uploaded asset.
 *
 * Separate from the upload response so the artboard can re-check an image after
 * an edit that could introduce or remove a fade — a background removal or a
 * generative repaint both change the alpha channel — without re-uploading it.
 */
export const fadeCheckAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      return next(Object.assign(new Error("url is required"), { statusCode: 400 }));
    }

    const buffer = await fetchImageBuffer(url);
    const result = await detectFade(buffer);

    console.log(
      `[FADE] ${result.kind} hasFade=${result.hasFade} ` +
        `confidence=${result.confidence.toFixed(2)} via ${result.source}`,
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Prompt understanding.
 *
 * Turns one sentence into an ordered list of atomic edits, resolving follow-ups
 * against the conversation so far — "make the rabbit pink, then add a birthday
 * hat" becomes two steps, and a later "make it bigger" knows what "it" is.
 *
 * Separate from `aiEditAsset` on purpose. It runs on the cheap text model, needs
 * no image, and returns in a second or two, so the client can call it on submit
 * and show the plan before committing to any image work. It is also strictly
 * optional: a null plan means the client falls back to its own keyword
 * classifier, which handles single-step requests perfectly well.
 */
export const aiEditPlan = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prompt, history } = req.body || {};
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return next(Object.assign(new Error("prompt is required"), { statusCode: 400 }));
    }

    if (!geminiPlanningReady()) {
      // 200, not 503. An absent planner is a missing enhancement, not a failed
      // request — the client is expected to proceed on its local classifier, and
      // an error status would make it report a problem the customer doesn't have.
      return res.json({ planned: false, steps: [] });
    }

    // Only the shape the planner needs, and bounded: an unbounded client-supplied
    // array would otherwise decide how many tokens this endpoint spends.
    const turns = Array.isArray(history)
      ? history
          .filter(
            (h: any) =>
              h &&
              typeof h.text === "string" &&
              h.text.trim() &&
              (h.role === "user" || h.role === "assistant"),
          )
          .slice(-12)
          .map((h: any) => ({
            role: h.role as "user" | "assistant",
            text: String(h.text).slice(0, 500),
          }))
      : [];

    const plan = await planEditWithGemini(prompt.trim(), turns);
    if (!plan) return res.json({ planned: false, steps: [] });

    console.log(
      `[AI-PLAN] ${plan.steps.length} step(s) — "${prompt.slice(0, 60)}"` +
        `${plan.clarification ? " (clarification)" : ""}${plan.reply ? " (reply)" : ""}`,
    );

    res.json({
      planned: true,
      steps: plan.steps,
      ...(plan.clarification ? { clarification: plan.clarification } : {}),
      ...(plan.reply ? { reply: plan.reply } : {}),
    });
  } catch (error) {
    next(error);
  }
};

export const aiEditAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url, prompt, intent, seed } = req.body || {};
    if (!url || typeof url !== "string") {
      return next(Object.assign(new Error("url is required"), { statusCode: 400 }));
    }
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return next(Object.assign(new Error("prompt is required"), { statusCode: 400 }));
    }
    if (!geminiReady() && !replicateEditReady() && !hasCloudflareEdit()) {
      // Distinguished so the operator reading logs — and the customer reading
      // the panel — can tell a capped free tier from an unfunded paid one from
      // a server where nothing was ever configured.
      // The customer-facing half says what still works; the operator-facing half
      // (`detail`) says what to change. Previously this collapsed into one
      // generic sentence that told neither of them anything actionable.
      const stillWorks =
        " Background removal, colour removal, upscaling and all board commands still work.";
      const status = geminiStatus();
      const message =
        status === "billing_required"
          ? "Generative AI editing isn't available on this server's API key yet — its image models have no free allowance." + stillWorks
          : status === "daily_cap"
          ? "Today's AI edit allowance is used up. It resets on Google's daily quota." + stillWorks
          : status === "rate_limited"
          ? "The image model is handling a lot of requests right now. Try again in a moment." + stillWorks
          : status === "retired"
          ? "The configured image model is no longer available." + stillWorks
          : env.replicateApiToken
          ? "The image model is out of credit, so generative edits are paused." + stillWorks
          : "AI editing isn't configured on this server yet.";

      const detail = geminiUnavailableReason();
      if (detail) console.warn(`[AI-EDIT] unavailable — ${detail}`);
      return next(Object.assign(new Error(message), { statusCode: 503, detail }));
    }

    const sourceBuffer = await fetchImageBuffer(url);
    const sourceGeometry = await readSourceGeometry(sourceBuffer);
    const sourceMeta = await sharp(sourceBuffer, { limitInputPixels: false }).metadata();
    const sourceMimeType = `image/${sourceMeta.format === "jpg" ? "jpeg" : sourceMeta.format || "png"}`;

    const built = buildEditRequest(
      String(intent || "custom"),
      prompt,
      typeof seed === "number" ? seed : undefined,
    );

    /**
     * Replicate needs a publicly reachable URL, so data URLs and local
     * /uploads paths have to be staged to Cloudinary. Deferred behind a lazy
     * getter rather than done up front: Gemini takes raw bytes and is tried
     * first, so on the common path this upload — a full round trip of a
     * print-resolution file — now never happens at all.
     */
    let stagedUrl: string | null = null;
    const publicSourceUrl = async (): Promise<string> => {
      if (!url.startsWith("data:") && !url.includes("/uploads/")) return url;
      if (stagedUrl) return stagedUrl;
      const { url: tempUrl } = await uploadBufferToCloudinary(
        sourceBuffer,
        "space-transfers/ai-edit-input",
      );
      stagedUrl = tempUrl;
      return tempUrl;
    };

    // Tiered free-first: Gemini's AI Studio key costs nothing and handles the
    // whole instruction-edit surface, so it leads. The paid tiers sit behind it
    // and only earn a request when it is capped or fails — a billing lapse or a
    // spent daily quota degrades the feature instead of breaking it.
    let editedBuffer: Buffer | undefined;
    let providerUsed = "";
    let modelUsed = built.model;
    // Kept so an exhausted chain can report *why* rather than reporting that it
    // is exhausted, which is the part the caller can already see.
    let lastTierError: string | undefined;

    if (geminiReady()) {
      try {
        const result = await editImageWithGemini(
          sourceBuffer,
          sourceMimeType,
          built.instruction,
        );
        editedBuffer = result.buffer;
        providerUsed = "gemini";
        modelUsed = result.model;
      } catch (geminiErr: any) {
        console.warn(`[AI-EDIT] Gemini failed (${geminiErr?.message}) — falling back`);
        lastTierError = `Gemini: ${geminiErr?.message}`;
        editedBuffer = undefined;
      }
    }

    if (!editedBuffer && replicateEditReady()) {
      try {
        editedBuffer = await editWithReplicate(
          await publicSourceUrl(),
          built,
          env.replicateApiToken!,
        );
        providerUsed = "replicate";
        // A success means the account is funded again; clear any earlier mark
        // so a single recovered request restores the tier immediately.
        replicateOutOfCreditAt = 0;
      } catch (replicateErr: any) {
        const message = String(replicateErr?.message ?? "");
        console.warn(`[AI-EDIT] Replicate failed (${message}) — falling back`);
        lastTierError = `Replicate: ${message}`;
        // Out of credit is a billing state, not a transient error: it fails
        // identically for every request until someone tops up, so the tier is
        // parked briefly rather than re-tried on each edit.
        if (/\b402\b|insufficient credit/i.test(message)) {
          replicateOutOfCreditAt = Date.now();
          console.warn(
            `[AI-EDIT] Replicate out of credit — pausing that tier for ${REPLICATE_CREDIT_RETRY_MS / 60_000} min`,
          );
        }
        editedBuffer = undefined;
      }
    }

    if (!editedBuffer && hasCloudflareEdit()) {
      try {
        editedBuffer = await editWithCloudflare(
          sourceBuffer,
          built,
          env.cloudflareAccountId!,
          env.cloudflareApiToken!,
        );
        providerUsed = "cloudflare";
        modelUsed = CF_EDIT_MODEL;
      } catch (cfErr: any) {
        console.warn(`[AI-EDIT] Cloudflare failed (${cfErr?.message})`);
        lastTierError = `Cloudflare: ${cfErr?.message}`;
        editedBuffer = undefined;
      }
    }

    if (!editedBuffer) {
      /**
       * Every tier failed *during* the request — the readiness gate above passed,
       * so this is a mid-flight failure rather than an unconfigured server.
       *
       * The generic sentence this used to return is what made the reported bug
       * so hard to act on: the actual cause (a Gemini key whose image models have
       * a free-tier quota of exactly 0, behind a Replicate account with no
       * credit) was fully known here and thrown away. Now the specific reason is
       * both logged and attached, so an operator can see the fix and a customer
       * gets a sentence that is true.
       *
       * 503 rather than 500: the request was valid and is worth retrying later,
       * and the client already treats an unreachable model as "board commands
       * still work" rather than a hard failure.
       */
      const detail = geminiUnavailableReason() ?? lastTierError;
      console.warn(`[AI-EDIT] all tiers failed for intent "${intent}" — ${detail ?? "no detail"}`);

      const advice =
        geminiStatus() === "billing_required"
          ? " Generative editing needs either billing enabled on the Gemini key or the free Cloudflare tier configured."
          : "";

      return next(
        Object.assign(
          new Error(
            "No image model could complete this edit right now." +
              advice +
              " Background removal, colour removal, upscaling and all board commands still work.",
          ),
          { statusCode: 503, detail },
        ),
      );
    }

    // Every generative tier renders at its own canvas size, none of them at the
    // source's. Conforming here — rather than in each tier — means the artboard
    // receives the same geometry contract regardless of which model answered,
    // and the item's physical size and DPI survive the edit intact.
    const conformed = await conformToSource(editedBuffer, sourceGeometry);

    const { url: editedUrl } = await uploadBufferToCloudinary(
      conformed.buffer,
      "space-transfers/ai-edited",
    );

    // Logged together so a bad result can be traced back to the exact model and
    // inputs that produced it — the instruction is derived, not user-supplied.
    console.log(
      `[AI-EDIT] ${intent} via ${providerUsed}/${modelUsed}` +
        `${built.extraInput.seed !== undefined ? ` seed=${built.extraInput.seed}` : ""}` +
        `${conformed.upsampled ? " upsampled" : ""}${conformed.cropped ? " aspect-corrected" : ""}` +
        ` — "${prompt.slice(0, 60)}"`,
    );

    res.json({
      url: editedUrl,
      widthPx: conformed.widthPx,
      heightPx: conformed.heightPx,
      originalWidthPx: sourceGeometry.width,
      originalHeightPx: sourceGeometry.height,
      // Echoed so the same edit can be reproduced or re-rolled deliberately.
      seed: built.extraInput.seed,
      model: modelUsed,
      // Generative edits repaint the full frame and the result has been
      // conformed to the source's exact dimensions, so the item's print box on
      // the artboard must be preserved as-is.
      reframed: false,
      /**
       * The model rendered below print resolution and was scaled back up. The
       * pixel count is honest but the *detail* is not, so the client says so
       * and offers Enhance rather than letting a soft file reach a garment
       * behind a DPI number that looks fine.
       */
      upsampled: conformed.upsampled,
      // The real provider, not a hardcoded one — the client shows this in the
      // result toast, and attributing a Cloudflare result to Gemini would make
      // a quality drop impossible to explain.
      provider: providerUsed,
    });
  } catch (error) {
    next(error);
  }
};

export const updateAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, defaultShippingAddress, companyName, phone } = req.body;
    const userId = req.user?.id;

    const user = await User.findById(userId);
    if (!user) {
      const error = new Error("User not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (name) user.name = name;
    if (companyName) user.companyName = companyName;
    if (phone) user.phone = phone;

    if (defaultShippingAddress && typeof defaultShippingAddress === "object") {
      // Merge onto existing address so partial updates (e.g. just postalCode) don't wipe other fields.
      const merged: any = { ...(user.defaultShippingAddress as any || {}), ...defaultShippingAddress };
      user.defaultShippingAddress = merged;

      // Re-derive region whenever the address changes.
      const stateCode = String(merged.state || "").trim();
      let newRegion = normalizeRegion(getRegionFromState(stateCode));

      if (!newRegion) {
        // Geocode in the background and patch the user record once we have a result.
        // We don't await here so the response is not delayed.
        (async () => {
          try {
            const geo = await geocodeAddress({
              street: merged.street, city: merged.city, state: merged.state,
              zip: merged.postalCode, country: merged.country,
            });
            if (!geo) return;
            const geoRegion = normalizeRegion(getRegionFromState(geo.state)) ?? getRegionFromCoords(geo.lat, geo.lng);
            await User.updateOne(
              { _id: userId },
              {
                $set: {
                  "defaultShippingAddress.coordinates": { lat: geo.lat, lng: geo.lng },
                  "defaultShippingAddress.state": geo.state || merged.state,
                  regions: [geoRegion],
                  detectedRegion: geoRegion,
                },
              }
            );
            console.log(`[region-assign] role=CUSTOMER id=${userId} state=${geo.state} region=${geoRegion} geocoded=true (account update)`);
          } catch (geoErr) {
            console.error("[region-assign] geocode failed during account update:", (geoErr as any)?.message);
          }
        })().catch(() => {});
      } else {
        user.regions = [newRegion];
        (user as any).detectedRegion = newRegion;
        console.log(`[region-assign] role=CUSTOMER id=${userId} state=${stateCode} region=${newRegion} geocoded=false (account update)`);
      }
    }

    await user.save();

    const userResponse: any = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      detectedRegion: (user as any).detectedRegion ?? user.regions?.[0] ?? null,
    };
    if (user.companyName) userResponse.companyName = user.companyName;
    if (user.phone) userResponse.phone = user.phone;
    if (user.defaultShippingAddress) userResponse.defaultShippingAddress = user.defaultShippingAddress;

    res.json({ user: userResponse });
  } catch (error) {
    next(error);
  }
};

export const getOrderTracking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ _id: orderId, user: req.user?.id });

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const isValidTrackingNumber = (tn: any) => typeof tn === "string" && /^[A-Za-z0-9]{10,35}$/.test(tn);
    let trackingNumber = order.trackingNumber;
    let carrier = order.carrier || "UPS";
    let events = (order.trackingEvents || []).map(event => ({
      time: event.time,
      location: event.location,
      description: event.description
    }));

    if (!isValidTrackingNumber(trackingNumber)) {
      if (env.nodeEnv !== "production") {
        trackingNumber = "1Z999AA10123456784";
        carrier = "UPS";

        if (events.length === 0) {
          events = [
            {
              time: new Date(Date.now() - 3600000),
              location: (order.shippingAddress?.city || "Los Angeles") + ", " + (order.shippingAddress?.state || "CA"),
              description: "Arrived at facility"
            },
            {
              time: new Date(Date.now() - 86400000),
              location: "Los Angeles, CA",
              description: "Departed facility"
            }
          ];
        }
      } else {
        const error = new Error("Tracking not available") as CustomError;
        error.statusCode = 404;
        throw error;
      }
    }

    const carrierUrls: { [key: string]: string } = {
      UPS: `https://www.ups.com/track?loc=en_US&tracknum=${trackingNumber}`,
      FedEx: `https://www.fedex.com/apps/fedextrack/?tracknumbers=${trackingNumber}`,
      USPS: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`,
      DHL: `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`
    };

    const trackingUrl = carrierUrls[carrier] || carrierUrls.UPS;
    const status = order.status === "SHIPPED" ? "In Transit" : (order.status === "COMPLETED" ? "Delivered" : "Pending");

    events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    res.json({
      trackingNumber,
      carrier,
      trackingUrl,
      status,
      events
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
};

export const createOrder = async (req: Request, res: Response, next: NextFunction) => {
  /**
   * Per-stage timing.
   *
   * Placing an order touches validation, several Mongo round trips, a counter
   * increment and a save. A single total tells you nothing about which to look
   * at when it is slow, so each stage is measured and logged on one line keyed
   * by order id. Plain counters rather than a tracing library: one request
   * path, one `Date.now()` per stage, greppable output.
   */
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  let stageMark = startedAt;
  const mark = (stage: string) => {
    const now = Date.now();
    timings[stage] = now - stageMark;
    stageMark = now;
  };

  try {
    const {
      items,
      customer,
      shippingAddress,
      shippingMethod,
      payment,
      pricing
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      const error = new Error("items array is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!customer || !customer.firstName || !customer.lastName || !customer.email) {
      const error = new Error("customer.firstName, customer.lastName and customer.email are required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (
      !shippingAddress ||
      !shippingAddress.street ||
      !shippingAddress.city ||
      !shippingAddress.state ||
      !shippingAddress.postalCode ||
      !shippingAddress.country
    ) {
      const error = new Error("shippingAddress.street, city, state, postalCode and country are required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!shippingMethod) {
      const error = new Error("shippingMethod is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!payment || !payment.method) {
      const error = new Error("payment.method is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (payment.method === "card" && !payment.paymentIntentId) {
      const error = new Error("payment.paymentIntentId is required for card payments") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (
      !pricing ||
      typeof pricing.subtotal !== "number" ||
      typeof pricing.shippingCost !== "number" ||
      typeof pricing.tax !== "number" ||
      typeof pricing.total !== "number" ||
      !pricing.currency
    ) {
      const error = new Error("pricing with subtotal, shippingCost, tax, total and currency is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const roundToTwo = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

    // Read before the items are priced: every line, the shipping and the tax on
    // this order come from one set of rates.
    const globalPricing = await getGlobalPricing();

    let computedSubtotal = 0;
    const orderItems = items.map((item: any) => {
      const {
        type,
        designId,
        name,
        widthIn,
        heightIn,
        sheetWidthIn,
        sheetHeightIn,
        previewImage,
        artboardItems,
        assetTable
      } = item || {};

      if (!type || !name) {
        const error = new Error("Each item requires type and name") as CustomError;
        error.statusCode = 400;
        throw error;
      }

      /**
       * Priced here, from the sheet's dimensions and the configured rate.
       *
       * `quantity` and `unitPrice` used to be taken from the request and only
       * checked for internal consistency, so any self-consistent set was
       * accepted — a caller could name a $0.01 subtotal for a full sheet and
       * both this order and the Stripe charge would honour it.
       */
      const quantity = itemQuantity(item);
      const unitPrice = deriveItemUnitPrice(item, globalPricing);

      const clientUnitPrice = Number(item?.unitPrice);
      if (Number.isFinite(clientUnitPrice) && roundToTwo(clientUnitPrice) !== unitPrice) {
        console.warn(
          `[ORDER_PRICING] item "${String(name)}" sent unitPrice ${roundToTwo(clientUnitPrice)} ` +
            `but ${widthIn}x${heightIn}in at $${globalPricing.baseRatePerSqFt}/sq ft is ${unitPrice} — charging ${unitPrice}`,
        );
      }

      const lineSubtotal = unitPrice * quantity;
      computedSubtotal += lineSubtotal;

      /**
       * Resolves an artwork reference back to its URL.
       *
       * A gang sheet repeats the same few graphics across many placements, so
       * the client sends each distinct URL once in `assetTable.urls` and refers
       * to it by integer index. That is what keeps the payload proportional to
       * distinct artwork rather than to placement count.
       *
       * Inline `assetId` / `croppedUrl` are still honoured, so a client that
       * has not reloaded — or a cart persisted before this shape existed —
       * keeps working. The reference wins when both are present.
       */
      const assetUrls: string[] = Array.isArray(assetTable?.urls) ? assetTable.urls : [];
      const deref = (ref: unknown, inline: unknown): string | undefined => {
        if (
          typeof ref === "number" &&
          Number.isInteger(ref) &&
          ref >= 0 &&
          ref < assetUrls.length
        ) {
          return assetUrls[ref];
        }
        return typeof inline === "string" && inline ? inline : undefined;
      };

      const normalizedArtboardItems = Array.isArray(artboardItems)
        ? artboardItems
            .filter(Boolean)
            .map((it: any) => ({
              id: Number(it.id),
              assetId: String(deref(it.assetRef, it.assetId) || ""),
              croppedUrl: deref(it.croppedRef, it.croppedUrl),
              autoCrop: typeof it.autoCrop === "boolean" ? it.autoCrop : undefined,
              widthIn: Number(it.widthIn),
              heightIn: Number(it.heightIn),
              posX: Number(it.posX),
              posY: Number(it.posY),
              rotation: typeof it.rotation === "number" ? it.rotation : 0,
              copies: typeof it.copies === "number" ? it.copies : 1,
              linked: Boolean(it.linked)
            }))
            .filter((it: any) =>
              Number.isFinite(it.id) &&
              it.assetId &&
              Number.isFinite(it.widthIn) &&
              Number.isFinite(it.heightIn) &&
              Number.isFinite(it.posX) &&
              Number.isFinite(it.posY)
            )
        : undefined;

      return {
        type,
        designId,
        name,
        widthIn,
        heightIn,
        quantity,
        unitPrice,
        subtotal: lineSubtotal,
        sheetWidthIn: typeof sheetWidthIn === "number" ? sheetWidthIn : undefined,
        sheetHeightIn: typeof sheetHeightIn === "number" ? sheetHeightIn : undefined,
        previewImage: typeof previewImage === "string" ? previewImage : undefined,
        artboardItems: normalizedArtboardItems && normalizedArtboardItems.length > 0 ? normalizedArtboardItems : undefined
      };
    });

    const roundedComputedSubtotal = roundToTwo(computedSubtotal);

    if (roundToTwo(pricing.subtotal) !== roundedComputedSubtotal) {
      // Not an error any more: the server priced these lines itself, so a
      // disagreement means the client's figure was stale or wrong, not that the
      // order is invalid. Rejecting here would turn a rate change mid-checkout
      // into a failed order.
      console.warn(
        `[ORDER_PRICING] client sent subtotal ${roundToTwo(pricing.subtotal)} but server priced ` +
          `the items at ${roundedComputedSubtotal} — recording the server figure`,
      );
    }

    /**
     * Shipping, tax and total are recomputed here rather than taken from the
     * request.
     *
     * The old check only asserted the client's own numbers were internally
     * consistent, so any self-consistent set was accepted — which is how orders
     * came to be recorded with $19.99 shipping and zero tax while Stripe
     * charged $24.99 plus 8%. Deriving them from the same pricer the charge
     * uses makes the saved order and the charge agree by construction.
     *
     * `subtotal` is no longer taken on trust either: each line is priced above
     * from its own dimensions and the configured rate, so the whole total is
     * now derived rather than asserted.
     */
    const shippingQuote = await quoteShipping({
      totalSqFt: totalBillableSqFt(items),
      method: normalizeShippingMethod(shippingMethod),
      destination: {
        state: String(shippingAddress?.state || ""),
        postalCode: String(shippingAddress?.postalCode || ""),
        country: String(shippingAddress?.country || "US"),
        city: shippingAddress?.city ? String(shippingAddress.city) : undefined,
      },
      packaging: globalPricing.packaging,
      markupPct: globalPricing.shippingMarkupPct,
      fallbackRates: globalPricing.shipping,
      // Quote from the region that will actually fulfil this, not from the
      // fixed warehouse postcode in the environment.
      origin: await predictShippingOrigin(shippingAddress?.state).catch(() => null),
    });

    const authoritativeTotals = computeOrderTotals({
      subtotal: roundedComputedSubtotal,
      shippingMethod,
      pricing: globalPricing,
      shippingCost: shippingQuote.cost,
    });

    const recordedPricing = {
      subtotal: authoritativeTotals.subtotal,
      shippingCost: authoritativeTotals.shippingCost,
      tax: authoritativeTotals.tax,
      total: authoritativeTotals.total,
      currency: authoritativeTotals.currency,
    };

    if (roundToTwo(pricing.total) !== authoritativeTotals.total) {
      console.warn(
        `[ORDER_PRICING] client sent total ${roundToTwo(pricing.total)} but server computed ` +
          `${authoritativeTotals.total} (shipping ${authoritativeTotals.shippingCost}, tax ${authoritativeTotals.tax}) — ` +
          `recording the server figure`,
      );
    }

    mark("validate");

    const currentUser = req.user?.id
      ? await User.findById(req.user.id).select("regions").lean()
      : null;
    mark("loadUser");

    // Derive region strictly from the shipping address state — same function used during
    // auto-assignment. Returns null for non-US / unknown state codes; never defaults to "West".
    const stateBasedRegion = getRegionFromState(shippingAddress?.state);
    const stateCoord = getLatLngFromState(shippingAddress?.state);

    // customer.region field is cosmetic only — do not use it to override the address region.
    const normalizedCustomer = {
      ...customer,
      region: stateBasedRegion || null
    };

    const nextOrderDisplayId = async () => {
      const counter = await Settings.findOneAndUpdate(
        { key: "order_display_counter" },
        { $inc: { "value.next": 1 } },
        { new: true, upsert: true, runValidators: true }
      ).lean();
      const seq = Number((counter as any)?.value?.next || 1) - 1;
      return `DTF-${String(seq).padStart(4, "0")}`;
    };

    const enrichedShippingAddress = {
      ...shippingAddress,
      // Only store detectedRegion when we have a confirmed US state — never store "West" as a
      // default, because the assignment service reads this field and a stale "West" causes
      // false-positive region matches with West-region printers.
      detectedRegion: stateBasedRegion ?? undefined,
      coordinates: stateCoord ? { lat: stateCoord.lat, lng: stateCoord.lon } : undefined,
      geocoded: false
    };

    const order = new Order({
      user: req.user?.id,
      displayId: await nextOrderDisplayId(),
      items: orderItems,
      customer: normalizedCustomer,
      shippingAddress: enrichedShippingAddress,
      shippingMethod,
      payment,
      pricing: recordedPricing,
      shippingQuote: {
        carrierCost: shippingQuote.carrierCost ?? undefined,
        chargedCost: shippingQuote.cost,
        serviceName: shippingQuote.serviceName ?? undefined,
        serviceCode: shippingQuote.serviceCode ?? undefined,
        source: shippingQuote.source,
        fallbackReason: shippingQuote.fallbackReason,
        originPostalCode: shippingQuote.originPostalCode ?? undefined,
        originPartnerRegion: shippingQuote.originPartnerRegion ?? undefined,
        parcel: deriveParcel(totalBillableSqFt(items), globalPricing.packaging),
      },
      status: "PENDING"
    });

    mark("buildOrder");

    // Checked before the first save attempt rather than inside the retry loop:
    // an oversized document fails identically on every retry, and the retry
    // exists for duplicate display IDs only.
    assertPersistable(order.toObject(), { label: "order" });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await order.save();
        mark("save");
        break;
      } catch (e: any) {
        const isDup = e?.code === 11000 && (e?.keyPattern?.displayId || e?.keyValue?.displayId);
        if (!isDup || attempt === 2) throw e;
        order.displayId = await nextOrderDisplayId();
      }
    }

    // Fire-and-forget: generate a server-side gangsheet thumbnail from the full-resolution
    // DB assets so the job list shows the same quality as the OrderDetails preview.
    // Runs after save so it never blocks the checkout response.
    const orderId = order.id;
    const gangsheetOrderItem = orderItems.find((it: any) => it.type === "gangsheet");
    if (gangsheetOrderItem && Array.isArray(gangsheetOrderItem.artboardItems) && gangsheetOrderItem.artboardItems.length > 0) {
      (async () => {
        try {
          const thumbItems = (gangsheetOrderItem.artboardItems as any[]).map((it: any) => ({
            assetId: String(it.assetId || ""),
            widthIn: Number(it.widthIn),
            heightIn: Number(it.heightIn),
            posX: Number(it.posX),
            posY: Number(it.posY),
            rotation: typeof it.rotation === "number" ? it.rotation : 0,
            flipped: Boolean(it.flipped),
            copies: typeof it.copies === "number" ? it.copies : 1,
          }));
          const rendered = await exportGangsheetPng24({
            jobId: String(orderId),
            printerId: "order-preview",
            // The sheet, not the stored `sheetWidthIn` — that field carries the
            // artwork's bounding width for partner pricing, and rendering onto
            // it misplaces every absolute `posX`. Same fix as the printer and
            // admin previews.
            sheetWidthIn: GANGSHEET_SHEET_WIDTH_IN,
            sheetHeightIn: typeof gangsheetOrderItem.sheetHeightIn === "number" ? gangsheetOrderItem.sheetHeightIn : undefined,
            artboardItems: thumbItems,
            dpi: 600,
            cropToContent: true,
            format: "webp",
          });
          const previewUrl = `${env.appUrl}${rendered.relativePath}`;
          await Order.updateOne(
            { _id: orderId, "items.type": "gangsheet" },
            { $set: { "items.$.previewImage": previewUrl } }
          );
        } catch (err: any) {
          console.warn(`[ORDER_THUMB] orderId=${orderId} thumbnail generation failed (non-fatal): ${err?.message}`);
        }
      })();
    }

    // Fire-and-forget: geocode to verify/correct state code and get precise coordinates.
    // The assignment service uses detectedRegion from the order — this updates it in the background.
    (async () => {
      try {
        const geo = await geocodeAddress({
          street: shippingAddress.street,
          city: shippingAddress.city,
          state: shippingAddress.state,
          zip: shippingAddress.postalCode,
          country: shippingAddress.country
        });
        if (geo) {
          const geoRegion =
            normalizeRegion(getRegionFromState(geo.state)) ??
            getRegionFromCoords(geo.lat, geo.lng);
          await Order.findByIdAndUpdate(orderId, {
            "shippingAddress.detectedRegion": geoRegion,
            "shippingAddress.coordinates": { lat: geo.lat, lng: geo.lng },
            "shippingAddress.geocoded": true,
            "customer.region": geoRegion
          });
          console.log(`[ORDER_GEO] orderId=${orderId} geocodedState=${geo.state} region=${geoRegion} lat=${geo.lat} lng=${geo.lng}`);
        }
      } catch (err: any) {
        console.warn(`[ORDER_GEO] orderId=${orderId} geocoding failed (non-fatal): ${err?.message}`);
      }
    })();

    notifyAllAdmins({
      category: "orders",
      priority: "medium",
      title: "New order placed",
      message: `${String(customer.firstName)} ${String(customer.lastName)} • $${recordedPricing.total.toFixed(2)}`,
      meta: { orderId: order.id, status: "PENDING" }
    }).catch(() => {});

    /**
     * Auto-assignment runs after the response.
     *
     * It was awaited behind a 1.9s timeout and followed by a second `findById`
     * to read back what it had written — so every customer paid up to ~2
     * seconds of dead time on the one click where responsiveness matters most,
     * and paid it in full whenever no printer matched, since that is the case
     * that runs longest before giving up.
     *
     * Nothing in the response depends on it: the order is saved and paid. Which
     * printer takes the job is decided afterwards and reaches the client
     * through the order status it already polls.
     */
    void autoAssignOrder(order.id)
      .then((result: any) => {
        console.log(
          `[ORDER_ASSIGN] orderId=${orderId} assigned=${result?.assigned} ` +
            `reason=${result?.reason ?? "-"} tookMs=${result?.tookMs ?? "-"}`,
        );
      })
      .catch((err: any) => {
        console.warn(`[ORDER_ASSIGN] orderId=${orderId} failed (non-fatal): ${err?.message}`);
      });

    timings.total = Date.now() - startedAt;
    console.log(
      `[ORDER_TIMING] orderId=${orderId} items=${orderItems.length} ` +
        `placements=${orderItems.reduce((n: number, i: any) => n + (i.artboardItems?.length ?? 0), 0)} ` +
        Object.entries(timings).map(([k, v]) => `${k}=${v}ms`).join(" "),
    );

    res.status(201).json({
      id: order.id,
      displayId: (order as any).displayId || null,
      createdAt: order.createdAt,
      status: order.status,
      pricing: order.pricing,
      // Decided after this response; the client shows PENDING and picks the
      // printer up from the order record.
      assignment: { assigned: false, orderId: order.id, reason: "Assignment in progress", tookMs: 0 },
      assignedPrinter: null
    });
  } catch (error) {
    next(error);
  }
};

export const createDesign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, thumbnail, size, pricing, artboardData } = req.body;

    const design = new Design({
      user: req.user?.id,
      title,
      thumbnail,
      size,
      pricing,
      artboardData
    });

    // A saved design carries the same artboard payload an order does, so it
    // overflows the same way — and losing a design to an opaque 500 is worse
    // than failing an order, since the work is not recoverable from a cart.
    assertPersistable(design.toObject(), { label: "design" });
    await design.save();
    await User.updateOne({ _id: req.user?.id }, { $set: { artboardDraft: null } });

    res.status(201).json({
      id: design.id,
      title: design.title,
      createdAt: design.createdAt,
      updatedAt: design.updatedAt
    });
  } catch (error) {
    next(error);
  }
};

export const getArtboardDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user?.id).select("artboardDraft");
    res.json({ draft: user?.artboardDraft || null });
  } catch (error) {
    next(error);
  }
};

export const upsertArtboardDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { draft } = req.body || {};
    await User.updateOne({ _id: req.user?.id }, { $set: { artboardDraft: draft || null } });
    res.json({ message: "Draft saved" });
  } catch (error) {
    next(error);
  }
};

export const clearArtboardDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await User.updateOne({ _id: req.user?.id }, { $set: { artboardDraft: null } });
    res.json({ message: "Draft cleared" });
  } catch (error) {
    next(error);
  }
};

export const getCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user?.id).select("cart");
    res.json({ cart: user?.cart || [] });
  } catch (error) {
    next(error);
  }
};

export const updateCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cart } = req.body || {};
    // The cart is a subdocument of the user, so an oversized cart takes the
    // whole user document over the limit — and the resulting failure would be
    // reported against `users`, not the cart, which is a confusing place to
    // start debugging.
    assertPersistable({ cart: cart || [] }, { label: "cart" });
    await User.updateOne({ _id: req.user?.id }, { $set: { cart: cart || [] } });
    res.json({ message: "Cart updated" });
  } catch (error) {
    next(error);
  }
};

export const listDesigns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const designs = await Design.find({ user: req.user?.id })
      .select("title size thumbnail createdAt updatedAt")
      .sort({ updatedAt: -1 });

    const formattedDesigns = designs.map((design) => ({
      id: design.id,
      title: design.title,
      size: `${design.size.widthIn}" x ${design.size.heightIn}"`,
      thumbnail: design.thumbnail,
      createdAt: design.createdAt,
      updatedAt: design.updatedAt
    }));

    res.json({ designs: formattedDesigns });
  } catch (error) {
    next(error);
  }
};

export const searchDesigns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== "string") {
      return res.json({ designs: [] });
    }

    const designs = await Design.find({
      user: req.user?.id,
      title: { $regex: q, $options: "i" }
    })
      .select("title size thumbnail createdAt updatedAt")
      .sort({ updatedAt: -1 });

    const formattedDesigns = designs.map((design) => ({
      id: design.id,
      title: design.title,
      size: `${design.size.widthIn}" x ${design.size.heightIn}"`,
      thumbnail: design.thumbnail,
      createdAt: design.createdAt,
      updatedAt: design.updatedAt
    }));

    res.json({ designs: formattedDesigns });
  } catch (error) {
    next(error);
  }
};

export const getDesignById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { designId } = req.params;
    const design = await Design.findOne({ _id: designId, user: req.user?.id });

    if (!design) {
      const error = new Error("Design not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.json({
      id: design.id,
      title: design.title,
      size: design.size,
      pricing: design.pricing,
      artboardData: design.artboardData
    });
  } catch (error) {
    next(error);
  }
};

export const deleteDesign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { designId } = req.params;

    const design = await Design.findOneAndDelete({ _id: designId, user: req.user?.id });

    if (!design) {
      const error = new Error("Design not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({ message: "Design deleted successfully" });
  } catch (error) {
    next(error);
  }
};

export const updateDesign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { designId } = req.params;
    const { title, thumbnail, artboardData } = req.body;

    const updateData: any = {};
    if (title !== undefined) updateData.title = title;
    if (thumbnail !== undefined) updateData.thumbnail = thumbnail;
    if (artboardData !== undefined) updateData.artboardData = artboardData;

    if (Object.keys(updateData).length === 0) {
      const error = new Error("No fields provided to update") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const design = await Design.findOneAndUpdate(
      { _id: designId, user: req.user?.id },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!design) {
      const error = new Error("Design not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.json({
      id: design.id,
      title: design.title,
      updatedAt: design.updatedAt
    });
  } catch (error) {
    next(error);
  }
};

export const duplicateDesign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { designId } = req.params;
    const { newTitle } = req.body;

    if (!newTitle || !newTitle.trim()) {
      const error = new Error("newTitle is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const source = await Design.findOne({ _id: designId, user: req.user?.id });
    if (!source) {
      const error = new Error("Design not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const copy = new Design({
      user: req.user?.id,
      title: newTitle.trim(),
      thumbnail: source.thumbnail,
      size: source.size,
      pricing: source.pricing,
      artboardData: source.artboardData
    });

    await copy.save();

    res.status(201).json({
      id: copy.id,
      title: copy.title,
      createdAt: copy.createdAt
    });
  } catch (error) {
    next(error);
  }
};

export const listOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, limit, cursor } = req.query || {};

    const query: any = {
      user: req.user?.id
    };

    if (status) {
      const normalized = status.toString().trim().toLowerCase();
      /**
       * Deliberately coarser than the internal states: a customer does not need
       * to know whether their sheet is queued at a partner, on the press, or
       * waiting for a label — only that it is being made.
       *
       * PRINTING and QUALITY_CHECK previously matched no filter at all, so an
       * order in production was invisible under every option. PAID/"paid" were
       * removed from the schema and are dropped here with them.
       */
      const statusMap: { [key: string]: string[] } = {
        pending: ["PENDING"],
        processing: ["PROCESSING", "PRINTING", "QUALITY_CHECK"],
        shipped: ["SHIPPED"],
        completed: ["COMPLETED"],
        cancelled: ["CANCELLED"]
      };

      const mappedStatuses = statusMap[normalized];
      if (!mappedStatuses) {
        const error = new Error("Invalid status filter") as CustomError;
        error.statusCode = 400;
        throw error;
      }

      if (mappedStatuses.length === 1) {
        query.status = mappedStatuses[0];
      } else {
        query.status = { $in: mappedStatuses };
      }
    }

    if (cursor) {
      query._id = { $lt: cursor };
    }

    let parsedLimit = 20;
    if (limit !== undefined) {
      const n = parseInt(limit as string, 10);
      if (!Number.isNaN(n) && n > 0) {
        parsedLimit = Math.min(n, 100);
      }
    }

    const results = await Order.find(query)
      .sort({ _id: -1 })
      .limit(parsedLimit + 1);

    const hasMore = results.length > parsedLimit;
    const orders = hasMore ? results.slice(0, parsedLimit) : results;

    const apiStatusMap: { [key: string]: string } = {
      PENDING: "Pending",
      PROCESSING: "Processing",
      SHIPPED: "Shipped",
      COMPLETED: "Completed",
      CANCELLED: "Cancelled"
    };

    const formatSheetSize = (order: any) => {
      if (!order.items || order.items.length === 0) return null;
      const firstItem = order.items[0];
      if (
        typeof firstItem.widthIn === "number" &&
        typeof firstItem.heightIn === "number"
      ) {
        return `${firstItem.widthIn}" x ${firstItem.heightIn}"`;
      }
      return null;
    };

    const responseOrders = orders.map((order) => ({
      orderId: order.id,
      // Same order number the customer sees on their invoice and in emails.
      displayId: (order as any).displayId || null,
      status: apiStatusMap[order.status] || order.status,
      date: order.createdAt,
      total: order.pricing?.total ?? null,
      sheetSize: formatSheetSize(order),
      trackingNumber: order.trackingNumber || null
    }));

    const nextCursor = hasMore ? orders[orders.length - 1].id : null;

    res.json({
      orders: responseOrders,
      nextCursor
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ _id: orderId, user: req.user?.id });

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const apiStatusMap: { [key: string]: string } = {
      PENDING: "Pending",
      PROCESSING: "Processing",
      SHIPPED: "Shipped",
      COMPLETED: "Completed",
      CANCELLED: "Cancelled"
    };

    const formattedItems = (order.items || []).map((item) => {
      let description = "";
      if (item.widthIn && item.heightIn) {
        description = `${item.widthIn}" x ${item.heightIn}"`;
      }

      return {
        name: item.name || "Unknown Item",
        description: description,
        quantity: item.quantity || 0,
        unitPrice: item.unitPrice || 0,
        subtotal: item.subtotal || 0
      };
    });

    const pricing = order.pricing || {};
    const lineItems = [
      { label: "Subtotal", amount: pricing.subtotal || 0 },
      { label: `Tax`, amount: pricing.tax || 0 },
      { label: "Shipping", amount: pricing.shippingCost || 0 }
    ];

    res.json({
      orderId: order.id,
      displayId: (order as any).displayId || null,
      status: apiStatusMap[order.status] || order.status,
      items: formattedItems,
      shippingAddress: {
        name: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim() || "Valued Customer",
        street: order.shippingAddress?.street || "N/A",
        city: order.shippingAddress?.city || "N/A",
        state: order.shippingAddress?.state || "N/A",
        postalCode: order.shippingAddress?.postalCode || "N/A",
        country: order.shippingAddress?.country || "N/A"
      },
      payment: {
        method: order.payment?.method || "N/A",
        cardBrand: order.payment?.cardBrand || null,
        cardLast4: order.payment?.cardLast4 || null
      },
      pricing: {
        lineItems,
        total: pricing.total || 0,
        currency: pricing.currency || "USD"
      }
    });
  } catch (error) {
    next(error);
  }
};

export const uploadAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      const error = new Error("No file uploaded") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const fileBuffer = req.file.buffer;

    // Deduplication: if this user already uploaded the exact same file, reuse it.
    const contentHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const foundAsset = req.user?.id ? await Asset.findOne({
      user: new mongoose.Types.ObjectId(String(req.user.id)),
      contentHash,
    }).lean() as any : null;

    // Returns false if a URL is a local /uploads/ path that no longer exists on disk.
    const localUrlAccessible = (url: string | null | undefined): boolean => {
      if (!url || !url.includes("/uploads/")) return true;
      const marker = "/uploads/";
      const idx = url.indexOf(marker);
      if (idx === -1) return true;
      const filename = url.substring(idx + marker.length).split("?")[0];
      if (!filename || filename.includes("..")) return false;
      return fs.existsSync(path.join(process.cwd(), "uploads", filename));
    };

    // Track stale asset ID so we update rather than insert a duplicate when re-processing.
    let staleAssetId: string | null = null;

    if (foundAsset) {
      if (localUrlAccessible(foundAsset.url) && localUrlAccessible(foundAsset.trimmedUrl)) {
        const thumbUrl = computeThumbUrl(foundAsset.trimmedUrl || foundAsset.url);
        const normDpi = foundAsset.dpi || 300;
        /**
         * Reuse the stored verdict, and only compute one if this record predates
         * the fade check. Identical bytes cannot produce a different answer, so
         * re-running the model here would spend a call to reproduce a result we
         * already have — while an asset saved before this feature existed still
         * needs one, or it would silently report "no fade" forever.
         */
        const cachedFade = foundAsset.fade ?? (await detectFade(fileBuffer));
        if (!foundAsset.fade) {
          await Asset.findByIdAndUpdate(foundAsset._id, { fade: cachedFade }).catch(() => {
            // A failed backfill is not worth failing the upload over; the
            // verdict is still returned and will be recomputed next time.
          });
        }
        return res.json({
          id: String(foundAsset._id),
          url: foundAsset.url,
          trimmedUrl: foundAsset.trimmedUrl || null,
          thumbnailUrl: thumbUrl,
          originalFilename: foundAsset.originalFilename,
          sizeBytes: foundAsset.sizeBytes,
          widthPx: foundAsset.widthPx,
          heightPx: foundAsset.heightPx,
          dpi: normDpi,
          widthIn: foundAsset.widthPx ? +(foundAsset.widthPx / normDpi).toFixed(4) : undefined,
          heightIn: foundAsset.heightPx ? +(foundAsset.heightPx / normDpi).toFixed(4) : undefined,
          trimmedWidthPx: foundAsset.trimmedWidthPx || null,
          trimmedHeightPx: foundAsset.trimmedHeightPx || null,
          trimmedWidthIn: foundAsset.trimmedWidthPx ? +(foundAsset.trimmedWidthPx / normDpi).toFixed(4) : null,
          trimmedHeightIn: foundAsset.trimmedHeightPx ? +(foundAsset.trimmedHeightPx / normDpi).toFixed(4) : null,
          deduplicated: true,
          fade: cachedFade,
        });
      }
      // Stored URLs are stale local paths — re-process and update the existing record.
      staleAssetId = String(foundAsset._id);
    }

    /**
     * Decode check, before anything is stored.
     *
     * A file whose contents are not really an image — a partly-downloaded or
     * damaged file, which typically still carries its original extension — used
     * to travel a long way through this handler. It was uploaded to Cloudinary,
     * its metadata extraction failed into a swallowed `catch`, and the response
     * went back as a **201 with `widthPx: undefined`**. The client then computed
     * `undefined / dpi`, and placed an item on the sheet whose physical size was
     * NaN: no error anywhere, and a gang sheet that cannot be printed.
     *
     * So this is now a hard 400, and it runs *before* the Cloudinary upload —
     * there is no reason to spend the round trip and the storage on a file that
     * is about to be rejected.
     *
     * PDFs are exempt because sharp cannot decode them without poppler; they are
     * checked by signature instead, which is all that is available here.
     */
    let widthPx: number | undefined, heightPx: number | undefined, dpi: number | undefined;
    const isPdfUpload = req.file.mimetype === "application/pdf";

    if (isPdfUpload) {
      if (fileBuffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
        const error = new Error(
          `“${req.file.originalname}” could not be read — it isn't a valid PDF. It may be damaged or only partly downloaded. Please re-export it and try again.`,
        ) as CustomError;
        error.statusCode = 400;
        throw error;
      }
    } else {
      try {
        const metadata = await sharp(fileBuffer, { limitInputPixels: false }).metadata();
        widthPx = metadata.width;
        heightPx = metadata.height;
        dpi = metadata.density || 300;
      } catch (err: any) {
        console.warn(`[UPLOAD] rejected ${req.file.originalname}: ${err?.message}`);
      }

      // Dimensions are the test, not merely whether metadata() threw: some
      // malformed files parse far enough to return an object with no width or
      // height, and that is exactly the shape that produced the NaN item.
      if (!widthPx || !heightPx) {
        const error = new Error(
          `“${req.file.originalname}” could not be read — the file may be damaged or only partly downloaded. Please re-export it and try again.`,
        ) as CustomError;
        error.statusCode = 400;
        throw error;
      }

      // Every sharp call here passes `limitInputPixels: false` to allow
      // legitimately huge gang sheets, which also removes the guard against a
      // decompression bomb. Without an explicit ceiling, a 50000×50000 PNG
      // decodes to ~10 GB and the process is killed by the OS rather than
      // returning an error.
      if (widthPx * heightPx > MAX_IMAGE_PIXELS) {
        console.error(
          `[UPLOAD] rejected ${req.file.originalname}: ${widthPx}×${heightPx} exceeds ` +
            `the ${MAX_IMAGE_PIXELS.toLocaleString()} px ceiling`,
        );
        const error = new Error(
          `“${req.file.originalname}” is too large to process (${widthPx}×${heightPx}). ` +
            `Please re-export it at a smaller resolution.`,
        ) as CustomError;
        error.statusCode = 400;
        throw error;
      }
    }

    // Upload original to Cloudinary.
    const { url: fileUrl } = await uploadBufferToCloudinary(fileBuffer, "space-transfers/assets");

    const normalizedDpi = (!dpi || dpi < 150) ? 300 : dpi;
    const widthIn = widthPx && normalizedDpi ? +(widthPx / normalizedDpi).toFixed(4) : undefined;
    const heightIn = heightPx && normalizedDpi ? +(heightPx / normalizedDpi).toFixed(4) : undefined;

    // Trim and upload trimmed version to Cloudinary.
    let trimmedUrl: string | undefined;
    let trimmedWidthPx: number | undefined;
    let trimmedHeightPx: number | undefined;
    let trimmedWidthIn: number | undefined;
    let trimmedHeightIn: number | undefined;
    try {
      const trimmedBuffer = await trimBuffer(fileBuffer);
      const { url: tUrl } = await uploadBufferToCloudinary(trimmedBuffer, "space-transfers/trimmed");
      trimmedUrl = tUrl;
      const trimmedMeta = await sharp(trimmedBuffer, { limitInputPixels: false }).metadata();
      trimmedWidthPx = trimmedMeta.width;
      trimmedHeightPx = trimmedMeta.height;
      trimmedWidthIn = trimmedWidthPx && normalizedDpi ? +(trimmedWidthPx / normalizedDpi).toFixed(4) : undefined;
      trimmedHeightIn = trimmedHeightPx && normalizedDpi ? +(trimmedHeightPx / normalizedDpi).toFixed(4) : undefined;
    } catch {
      trimmedUrl = undefined;
    }

    // Cloudinary thumbnail is derived from the URL — no local generation needed.
    const thumbnailUrl = computeThumbUrl(trimmedUrl || fileUrl);

    /**
     * Fade check, on the buffer that is already in memory.
     *
     * Done here rather than as a follow-up request because the bytes are right
     * here: the client would otherwise re-download its own upload just to
     * inspect the alpha channel. The check short-circuits on images with no
     * meaningful partial alpha, so the common upload pays only a few
     * milliseconds of geometry and never reaches the model.
     */
    const fade = await detectFade(fileBuffer);
    if (fade.hasFade) {
      console.log(
        `[FADE] ${req.file.originalname}: ${fade.kind} ` +
          `confidence=${fade.confidence.toFixed(2)} via ${fade.source}`,
      );
    }

    // Guest uploads: return metadata without persisting to the database
    if (!req.user?.id) {
      return res.status(201).json({
        url: fileUrl,
        trimmedUrl: trimmedUrl || null,
        thumbnailUrl,
        originalFilename: req.file.originalname,
        sizeBytes: req.file.size,
        widthPx,
        heightPx,
        dpi: normalizedDpi,
        widthIn,
        heightIn,
        trimmedWidthPx: trimmedWidthPx || null,
        trimmedHeightPx: trimmedHeightPx || null,
        trimmedWidthIn: trimmedWidthIn || null,
        trimmedHeightIn: trimmedHeightIn || null,
        fade,
      });
    }

    let savedAssetId: string;
    if (staleAssetId) {
      await Asset.findByIdAndUpdate(staleAssetId, {
        url: fileUrl,
        trimmedUrl,
        widthPx,
        heightPx,
        trimmedWidthPx,
        trimmedHeightPx,
        dpi: normalizedDpi,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        fade,
      });
      savedAssetId = staleAssetId;
    } else {
      const asset = new Asset({
        user: req.user.id,
        url: fileUrl,
        trimmedUrl,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        widthPx,
        heightPx,
        trimmedWidthPx,
        trimmedHeightPx,
        dpi: normalizedDpi,
        contentHash,
        fade,
      });
      await asset.save();
      savedAssetId = asset.id;
    }

    res.status(201).json({
      id: savedAssetId,
      url: fileUrl,
      trimmedUrl: trimmedUrl || null,
      thumbnailUrl,
      originalFilename: req.file.originalname,
      sizeBytes: req.file.size,
      widthPx,
      heightPx,
      dpi: normalizedDpi,
      widthIn,
      heightIn,
      trimmedWidthPx: trimmedWidthPx || null,
      trimmedHeightPx: trimmedHeightPx || null,
      trimmedWidthIn: trimmedWidthIn || null,
      trimmedHeightIn: trimmedHeightIn || null,
      fade,
    });
  } catch (error) {
    next(error);
  }
};

export const listAssets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pageSize = Math.max(1, Math.min(500, parseInt(String(req.query.limit || "200"), 10) || 200));
    const cursor = typeof req.query.cursor === "string" && mongoose.Types.ObjectId.isValid(req.query.cursor)
      ? req.query.cursor
      : null;

    const query: any = { user: req.user?.id };
    if (cursor) query._id = { $lt: new mongoose.Types.ObjectId(cursor) };

    // Fetch one extra to detect whether a next page exists.
    const assets = await Asset.find(query)
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .select("url trimmedUrl originalFilename sizeBytes widthPx heightPx trimmedWidthPx trimmedHeightPx dpi");

    const hasMore = assets.length > pageSize;
    const page = hasMore ? assets.slice(0, pageSize) : assets;
    const nextCursor = hasMore ? String(page[page.length - 1]._id) : null;

    const items = page.map((asset) => ({
      id: asset.id,
      url: asset.url,
      trimmedUrl: asset.trimmedUrl || null,
      thumbnailUrl: computeThumbUrl(asset.trimmedUrl || asset.url),
      originalFilename: asset.originalFilename,
      sizeBytes: asset.sizeBytes,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      trimmedWidthPx: asset.trimmedWidthPx || null,
      trimmedHeightPx: asset.trimmedHeightPx || null,
      dpi: asset.dpi,
    }));

    res.json({ items, nextCursor });
  } catch (error) {
    next(error);
  }
};

const roundToTwo = (value: number) => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

/**
 * The rates the storefront needs to display a total that matches what will be
 * charged: the per-square-foot sheet rate, shipping per method, and the tax
 * percentage.
 *
 * Read-only and free of customer data, so it is available to guests — the cart
 * is usable before sign-in and would otherwise show a total the checkout then
 * contradicts. `getCartQuote` cannot serve this: it prices saved designs by id,
 * and cart items are unsaved gang sheets with no `designId`.
 *
 * `baseRatePerSqFt` is served here because the editor prices a sheet as the
 * user draws it, long before anything is saved. It used to price from a
 * constant compiled into the client bundle, which meant the admin's Retail
 * Pricing field was authoritative over nothing — the number that actually set
 * every price could only be changed by a redeploy.
 */
export const getPricingConfig = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pricing = await getGlobalPricing();
    res.status(200).json({
      baseRatePerSqFt: pricing.baseRatePerSqFt,
      shipping: pricing.shipping,
      taxRatePct: pricing.taxRatePct,
      currency: "USD",
    });
  } catch (error) {
    next(error);
  }
};

export const getCartQuote = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { items, shippingMethod, shippingCountry, shippingPostalCode } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      const error = new Error("items array is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!shippingMethod) {
      const error = new Error("shippingMethod is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!shippingCountry) {
      const error = new Error("shippingCountry is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!shippingPostalCode) {
      const error = new Error("shippingPostalCode is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // Read once, above the loop: the same rates must price every line item,
    // the shipping and the tax on this quote.
    const pricing = await getGlobalPricing();

    const quoteItems: any[] = [];
    let subtotal = 0;

    for (const item of items) {
      const {
        name,
        type,
        designId,
        widthIn,
        heightIn,
        copies
      } = item || {};

      if (!name) {
        const error = new Error("Each item must have a name") as CustomError;
        error.statusCode = 400;
        throw error;
      }

      if (!type) {
        const error = new Error("Each item must have a type") as CustomError;
        error.statusCode = 400;
        throw error;
      }

      let unitPrice = 0;

      if (type === "gangsheet") {
        if (!designId) {
          const error = new Error("designId is required for gangsheet items") as CustomError;
          error.statusCode = 400;
          throw error;
        }

        const design = await Design.findOne({ _id: designId, user: req.user?.id });

        if (!design) {
          const error = new Error("Design not found for cart item") as CustomError;
          error.statusCode = 404;
          throw error;
        }

        /**
         * Priced from area x the current global rate, not from the price
         * stored on the design.
         *
         * The stored price is a snapshot of whatever rate was in force when
         * the sheet was saved, so preferring it meant a rate change never
         * reached carts holding older designs. Two hard-coded `3.5` fallbacks
         * sat behind it, which is what actually priced anything that reached
         * them — a third retail rate, invisible to the admin and disagreeing
         * with `global_pricing` by a factor of seven.
         */
        const areaSqFt =
          typeof design.pricing?.areaSqFt === "number" && Number.isFinite(design.pricing.areaSqFt)
            ? design.pricing.areaSqFt
            : null;

        if (areaSqFt == null || areaSqFt <= 0) {
          const error = new Error("Unable to determine price for gangsheet item") as CustomError;
          error.statusCode = 400;
          throw error;
        }

        // Same helper the payment intent and the saved order use, so a quote
        // cannot promise a number the checkout then contradicts.
        unitPrice = sheetUnitPrice(areaSqFt, pricing);
      } else {
        const error = new Error(`Unsupported cart item type: ${type}`) as CustomError;
        error.statusCode = 400;
        throw error;
      }

      const quantity = typeof copies === "number" && copies > 0 ? copies : 1;
      const lineSubtotal = unitPrice * quantity;

      subtotal += lineSubtotal;

      quoteItems.push({
        name,
        unitPrice: roundToTwo(unitPrice),
        quantity,
        subtotal: roundToTwo(lineSubtotal)
      });
    }

    // Shipping and tax come from the shared pricer so this quote, the Stripe
    // charge and the saved order cannot disagree. This path previously used its
    // own rates (express $19.99, 9.4% tax gated on the country string being
    // exactly "United States") while the charge path used $24.99 and a flat 8%.
    const shippingQuote = await quoteShipping({
      totalSqFt: totalBillableSqFt(items),
      method: normalizeShippingMethod(shippingMethod),
      destination: {
        state: String(req.body?.shippingState || ""),
        postalCode: String(shippingPostalCode || ""),
        country: String(shippingCountry || "US"),
        city: req.body?.shippingCity ? String(req.body.shippingCity) : undefined,
      },
      packaging: pricing.packaging,
      markupPct: pricing.shippingMarkupPct,
      fallbackRates: pricing.shipping,
      origin: await predictShippingOrigin(req.body?.shippingState).catch(() => null),
    });

    const totals = computeOrderTotals({
      subtotal: roundToTwo(subtotal),
      shippingMethod,
      pricing,
      shippingCost: shippingQuote.cost,
    });

    res.status(200).json({
      items: quoteItems,
      subtotal: totals.subtotal,
      shippingCost: totals.shippingCost,
      // Named so the storefront can say "USPS Ground Advantage" instead of just
      // a number, and so a fallback is visible rather than silent.
      shippingService: shippingQuote.serviceName,
      shippingSource: shippingQuote.source,
      tax: totals.tax,
      total: totals.total,
      currency: totals.currency
    });
  } catch (error) {
    next(error);
  }
};

export const sendGangsheetUtilizationWarning = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { fullSheetPrice, sheetWidthIn, sheetHeightIn, utilizationPct } = req.body;

    const price = Number(fullSheetPrice);
    if (!Number.isFinite(price) || price <= 0) {
      const error = new Error("fullSheetPrice must be a positive number") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const width = Number(sheetWidthIn || 23.5);
    const height = Number(sheetHeightIn || 23.5);
    const pct = utilizationPct != null ? Number(utilizationPct) : null;
    const pctText = pct != null && Number.isFinite(pct) ? `${pct.toFixed(0)}%` : "N/A";

    const amountText = `$${price.toFixed(2)}`;

    const subject = "Unused gang sheet space notice";
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
        <h2 style="margin: 0 0 12px 0;">Unused gang sheet space</h2>
        <p style="margin: 0 0 12px 0;">
          Your gang sheet (${width.toFixed(1)}&quot; × ${height.toFixed(1)}&quot;) is not fully utilized.
        </p>
        <p style="margin: 0 0 12px 0;">
          If you proceed, you will be charged the full gang sheet amount of <strong>${amountText}</strong>.
        </p>
        <p style="margin: 0 0 0 0; color: #6B7280; font-size: 12px;">
          Utilization: ${pctText}
        </p>
      </div>
    `;

    const sendResult = await sendEmail({ to: user.email, subject, html });

    console.log(
      `[GANGSHEET_WARN] user=${user.id} email=${user.email} fullSheetPrice=${amountText} utilization=${pctText} sent=${sendResult.sent}`
    );

    res.status(200).json({ sent: sendResult.sent });
  } catch (error) {
    next(error);
  }
};

export const downloadInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ _id: orderId, user: req.user?.id });

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }


    const formattedItems = (order.items || []).map((item) => {
      let description = "";
      if (item.widthIn && item.heightIn) {
        description = `${item.widthIn}" x ${item.heightIn}"`;
      }
      return {
        name: item.name || "Unknown Item",
        description: description,
        quantity: item.quantity || 0,
        unitPrice: (item.unitPrice || 0).toFixed(2),
        subtotal: (item.subtotal || 0).toFixed(2)
      };
    });

    const pricing = order.pricing || {};
    const lineItems = [
      { label: "Subtotal", amount: (pricing.subtotal || 0).toFixed(2) },
      { label: "Shipping", amount: (pricing.shippingCost || 0).toFixed(2) },
      { label: "Tax", amount: (pricing.tax || 0).toFixed(2) }
    ];

    const data = {
      // The invoice is the most customer-visible document there is, so it
      // carries the canonical DTF-#### number rather than the raw ObjectId.
      orderId: (order as any).displayId || order.id,
      date: (order.createdAt || new Date()).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      shippingAddress: {
        name: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim() || "Valued Customer",
        street: order.shippingAddress?.street || "N/A",
        city: order.shippingAddress?.city || "N/A",
        state: order.shippingAddress?.state || "N/A",
        postalCode: order.shippingAddress?.postalCode || "N/A",
        country: order.shippingAddress?.country || "N/A"
      },
      items: formattedItems,
      pricing: {
        lineItems,
        total: (pricing.total || 0).toFixed(2),
        currency: pricing.currency || "USD"
      }
    };

    const pdfBuffer = await renderInvoicePdf(data);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${data.orderId}.pdf"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.send(pdfBuffer);

  } catch (error) {
    next(error);
  }
};

export const reorder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const { quantityMultiplier = 1 } = req.body || {};

    if (typeof quantityMultiplier !== "number" || quantityMultiplier <= 0) {
      const error = new Error("quantityMultiplier must be a positive number") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const originalOrder = await Order.findOne({ _id: orderId, user: req.user?.id });

    if (!originalOrder) {
      const error = new Error("Original order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const newItems = originalOrder.items.map((item) => {
      const quantity = item.quantity * quantityMultiplier;
      const subtotal = item.unitPrice * quantity;

      return {
        type: item.type,
        designId: item.designId,
        name: item.name,
        widthIn: item.widthIn,
        heightIn: item.heightIn,
        quantity,
        unitPrice: item.unitPrice,
        subtotal
      };
    });

    const subtotal = newItems.reduce((sum, item) => sum + item.subtotal!, 0);
    const shippingCost = originalOrder.pricing.shippingCost || 0;
    const taxRate = originalOrder.pricing.subtotal && originalOrder.pricing.subtotal > 0 ? (originalOrder.pricing.tax || 0) / originalOrder.pricing.subtotal : 0;
    const tax = roundToTwo(subtotal * taxRate);
    const total = roundToTwo(subtotal + shippingCost + tax);

    const newOrder = new Order({
      user: req.user?.id,
      items: newItems,
      customer: originalOrder.customer,
      shippingAddress: originalOrder.shippingAddress,
      shippingMethod: originalOrder.shippingMethod,
      payment: {
        method: originalOrder.payment.method
      },
      pricing: {
        subtotal: roundToTwo(subtotal),
        shippingCost: roundToTwo(shippingCost),
        tax,
        total,
        currency: originalOrder.pricing.currency
      },
      status: "PENDING"
    });

    // A reorder copies artwork references from an existing order, so it can
    // only be oversized if the original was — but the original predates this
    // guard, so it is checked rather than assumed.
    assertPersistable(newOrder.toObject(), { label: "reorder" });
    await newOrder.save();

    res.status(201).json({
      orderId: newOrder.id,
      status: "Pending",
      createdFrom: originalOrder.id
    });
  } catch (error) {
    next(error);
  }
};
