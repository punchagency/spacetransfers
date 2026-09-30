import { Request, Response, NextFunction } from "express";
import { resolveApiFile } from "../utils/publicApiBase.js";
import { isTitleTaken, normalizeTitle, titleTakenError, uniqueTitle, UNTITLED_SHEET } from "../utils/designTitles.js";
import { storeDesignThumbnail } from "../utils/designThumbnail.js";
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js";
import { verifyCardPayment } from "../services/paymentVerification.service.js";
import { User } from "../models/user.model.js";
import { isValidPhone } from "../utils/accountFields.js";
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
import { trimImage } from "../utils/aiCrop.js";
import { uprightImage } from "../utils/uprightImage.js";
import {
  isLegacyCloudinaryUrl,
  isStoredArtworkUrl,
  legacyCloudinaryThumbUrl,
  storeArtwork,
} from "../services/storage.service.js";
import { customerOrderStatus, formatSheetSize, orderChargeLines } from "../utils/orderPresentation.js";
import {
  getGlobalPricing,
  priceItems,
  computeTotals as computeOrderTotals,
  deriveItemUnitPrice,
  itemQuantity,
  sheetUnitPrice,
  normalizeShippingMethod,
  priorityForShippingMethod,
  totalBillableSqFt,
} from "../services/pricing.service.js";
import { quoteShipping } from "../services/shipping.service.js";
import { deriveParcel } from "../services/packaging.service.js";
import { predictShippingOrigin } from "../services/orderAssignment.service.js";
import { autoAssignOrder } from "../services/orderAssignment.service.js";
import { renderOrderSheetPreviews } from "../services/orderPreview.service.js";
import { exportGangsheetPng24, orderSheetWidthIn, printedSheetExtentIn, printedSheetLengthIn } from "../services/gangsheetExport.service.js";
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
  GeminiDeclinedError,
  geminiImageModel,
  geminiPlanningReady,
  geminiReady,
  geminiStatus,
  verifyGeminiKey,
  geminiUnavailableReason,
  hasGemini,
  planEditWithGemini,
} from "../services/gemini.service.js";
import { conformToSource, readSourceGeometry } from "../utils/generativeImage.js";
import { detectFade, TRANSPARENCY_CHECK_VERSION } from "../services/fadeDetection.service.js";

interface CustomError extends Error {
  statusCode?: number;
}

/*
 * One rule now: the thumbnail sits beside the original under the same name.
 *
 * Cloudinary generated these by URL transformation, which plain storage cannot
 * do, so `storeArtwork` writes a second object at exactly this path on upload.
 * The convention already existed for local files — R2 follows it, which is why
 * the Cloudinary branch could go rather than be replaced.
 */
const computeThumbUrl = (assetUrl: string | null | undefined): string | null => {
  if (!assetUrl) return null;
  // Legacy Cloudinary assets never had a thumb object written beside them, so
  // they keep using the transformation that produced their thumbnails before.
  if (isLegacyCloudinaryUrl(assetUrl)) return legacyCloudinaryThumbUrl(assetUrl);
  const lastSlash = assetUrl.lastIndexOf("/");
  const lastDot = assetUrl.lastIndexOf(".");
  if (lastDot <= lastSlash) return null;
  return assetUrl.substring(0, lastDot) + "-thumb200.webp";
};

// Trim an image buffer using temp files. Returns the trimmed PNG as a Buffer.
// Temp files are written to os.tmpdir().

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
      const { url: hostedUrl } = await storeArtwork(
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
    const { url: hostedUrl } = await storeArtwork(buffer, "space-transfers/edited");
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
  
    /*
     * Accept stored artwork and legacy local /uploads/ paths.
     *
     * Matching on the R2 host rather than a bare "is it a URL" keeps this a
     * real check: it is the guard that stops an arbitrary address being handed
     * to the server to fetch.
     */
    const isLocal = url.includes("/uploads/");
    const isStored = isStoredArtworkUrl(url);
    if (!isLocal && !isStored) {
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
        const r = await fetchWithTimeout(url, {}, 90_000, "Loading the image");
        if (!r.ok) {
          const error = new Error("Asset file not found") as CustomError;
          error.statusCode = 404;
          throw error;
        }
        sourceBuffer = Buffer.from(await r.arrayBuffer());
      }
    } else {
      const r = await fetchWithTimeout(url, {}, 90_000, "Loading the image");
      if (!r.ok) {
        const error = new Error("Asset file not found") as CustomError;
        error.statusCode = 404;
        throw error;
      }
      sourceBuffer = Buffer.from(await r.arrayBuffer());
    }

    const trim = await trimImage(sourceBuffer);
    if (!trim) {
      const error = new Error("This image could not be read to trim it.") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // Nothing to trim: the stored image already is the trimmed one, so it is
    // reused rather than saved again as a much larger PNG.
    const trimmedUrl =
      trim.unchanged && isStoredArtworkUrl(url)
        ? url
        : (await storeArtwork(trim.unchanged ? sourceBuffer : trim.buffer, "space-transfers/trimmed")).url;

    const meta = await sharp(sourceBuffer, { limitInputPixels: false }).metadata();
    const normalizedDpi = Math.max(150, Math.round(meta.density || 300));
    const trimmedWidthPx = trim.widthPx || null;
    const trimmedHeightPx = trim.heightPx || null;
    const trimmedWidthIn = trimmedWidthPx ? +(trimmedWidthPx / normalizedDpi).toFixed(4) : null;
    const trimmedHeightIn = trimmedHeightPx ? +(trimmedHeightPx / normalizedDpi).toFixed(4) : null;

    res.json({ trimmedUrl, trimmedWidthPx, trimmedHeightPx, trimmedWidthIn, trimmedHeightIn });
  } catch (error) {
    next(error);
  }
};

// ── AI Upscale ──────────────────────────────────────────────────────────────

// ── Upscaling constants ───────────────────────────────────────────────────────

const MAX_OUTPUT_PX = 8_000; // prevent runaway output sizes

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
  /*
   * Anything else must be a web address. A `blob:` URL (an image that only
   * exists in the customer's browser, because its upload failed) or a bare id
   * reached `fetch`, which threw a TypeError that surfaced as an unexplained 500.
   */
  if (!/^https?:\/\//i.test(url)) {
    throw Object.assign(
      new Error("This image hasn't finished uploading, so it can't be processed yet. Please try again once it has."),
      { statusCode: 400, code: "IMAGE_NOT_UPLOADED" },
    );
  }
  const r = await fetchWithTimeout(url, {}, 90_000, "Loading the image");
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
// A remote upscaler would scale purely off the requested factor, with no idea
// of the MAX_OUTPUT_PX ceiling the sharp tier already respects — a large
// `scale` against a sizeable source (e.g. the user enlarging the item a lot
// before requesting DPI enhancement) can return a multi-hundred-megapixel
// image that blows well past what a bounded resize
// loop can shrink. Clamp the upscaler's output
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

/*
 * Replicate and HuggingFace upscaling tiers removed.
 *
 * Neither is provisioned in production — the deployment blueprint declares only
 * GEMINI_API_KEY — so both were a paid dependency and a free-tier dependency
 * that would never have had credentials, falling through to sharp on every
 * request while looking like a working three-tier chain.
 *
 * Sharp is now the whole implementation: local, free, no key, and no image
 * leaving the server to a third party.
 */

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

    // One implementation, so no tier to choose and nothing to fall through to.
    const upscaledBuffer = await upscaleWithSharp(
      sourceBuffer,
      originalWidthPx,
      originalHeightPx,
      scale,
    );
    const tier = "sharp";

    console.log(`[UPSCALE] ${tier} — ${originalWidthPx}×${originalHeightPx} → scale ${scale}`);

    const { url: upscaledUrl } = await storeArtwork(upscaledBuffer, "space-transfers/upscaled");
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
 * A remote model would validate the whole prediction against its schema and
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

/*
 * Replicate and Cloudflare Workers AI editing removed.
 *
 * Neither has credentials in production — the blueprint declares only
 * GEMINI_API_KEY — so this was a three-provider chain in which two links could
 * never fire. Gemini is the implementation, and when its billing is off it says
 * so plainly rather than appearing to fall back to something.
 */

/**
 * Readiness probe. The client caches this for the session and uses it to decide
 * whether generative chips are live, so a user never fires a request that is
 * guaranteed to 503.
 */
export const aiEditCapabilities = async (_req: Request, res: Response) => {
  // Once per server start (and after a key block lapses): answers truthfully
  // from the first request instead of only after an edit has failed.
  await verifyGeminiKey();

  // One provider now, so the array is a list of one or of none. Kept as an
  // array because the client reads `tiers[0]` to name the model it is about to
  // use, and that contract has not changed.
  const tiers = geminiReady()
    ? [{ provider: "gemini", model: geminiImageModel() }]
    : [];

  // Lets an operator see *why* the feature is dark without reading logs, and
  // distinguishes the three states that look identical from the client:
  // nothing configured, configured but capped, configured but unfunded.
  const geminiState = geminiStatus();
  const reason =
    tiers.length > 0 || geminiState === "unconfigured" || geminiState === "ready"
      ? undefined
      : geminiState;

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

    await verifyGeminiKey();
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
    await verifyGeminiKey();
    if (!geminiReady()) {
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
          : status === "invalid_key"
          ? "AI image editing isn't set up correctly on this server yet." + stillWorks
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

    /*
     * The lazy Cloudinary staging that lived here went with Replicate.
     *
     * It existed only because a remote model needed a publicly reachable URL,
     * which meant uploading a print-resolution file just to have something to
     * link to. Gemini takes the bytes directly, so nothing is staged and no
     * extra copy of a customer's artwork is made as a side effect of an edit.
     */

    // Gemini is the whole implementation.
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
        // A refusal is an answer, not an outage — say what the model said, and
        // don't tell the customer the service is down or that they should retry.
        if (geminiErr instanceof GeminiDeclinedError) {
          const said = String(geminiErr.message).replace(/\s+/g, " ").trim().slice(0, 300);
          console.warn(`[AI-EDIT] declined for intent "${intent}" — ${said}`);
          return next(
            Object.assign(new Error(`The AI couldn't make this edit: ${said} Try rewording it.`), {
              statusCode: 422,
            }),
          );
        }
        console.warn(`[AI-EDIT] Gemini failed (${geminiErr?.message}) — falling back`);
        lastTierError = `Gemini: ${geminiErr?.message}`;
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
       * a free-tier quota of exactly 0) was fully known here and thrown away.
       * Now the specific reason is
       * both logged and attached, so an operator can see the fix and a customer
       * gets a sentence that is true.
       *
       * 503 rather than 500: the request was valid and is worth retrying later,
       * and the client already treats an unreachable model as "board commands
       * still work" rather than a hard failure.
       */
      const detail = geminiUnavailableReason() ?? lastTierError;
      console.warn(`[AI-EDIT] all tiers failed for intent "${intent}" — ${detail ?? "no detail"}`);

      // Only Gemini is wired now; the Cloudflare tier this once also named is gone.
      const advice =
        geminiStatus() === "billing_required"
          ? " Generative editing needs billing enabled on the Gemini key."
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

    const { url: editedUrl } = await storeArtwork(
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
    /*
     * Shape checked when supplied. Presence was the only test — `if (phone)` —
     * so a customer could set their contact number to "1" or "abc" with no
     * error, and that is the number used to reach them about their own order.
     */
    if (phone) {
      if (!isValidPhone(String(phone))) {
        const error = new Error("Enter a valid phone number") as CustomError;
        error.statusCode = 400;
        throw error;
      }
      user.phone = phone;
    }

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

    /*
     * Card is the only method the platform takes.
     *
     * `payment.method` was a free-form string and verification keyed off it, so
     * `method: "bank_transfer"` skipped the check entirely and produced a real
     * unpaid order — the same hole in a different coat. There is no bank
     * transfer, no invoicing and no cash: checkout offers a Stripe card and
     * nothing else, so anything else is a request that did not come from it.
     */
    if (payment.method !== "card") {
      const error = new Error(
        `Unsupported payment method: ${String(payment.method)}. Orders are paid by card.`,
      ) as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // Presence only — the payment itself is verified below, once the server has
    // priced the order, because it has to be checked against OUR total rather
    // than the one the request supplied.
    if (!payment.paymentIntentId) {
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
        assetTable,
        itemSpacingIn,
        sheetMarginIn
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
              // Dropped here before, so a mirrored design printed unmirrored.
              flipped: Boolean(it.flipped),
              copies: typeof it.copies === "number" ? it.copies : 1,
              linked: Boolean(it.linked),
              // How auto-nest laid the piece out; the export draws it the same way.
              nestRotation: Number(it.nestRotation) === 90 ? 90 : 0,
              flowCols:
                Number.isInteger(Number(it.flowCols)) && Number(it.flowCols) >= 1
                  ? Number(it.flowCols)
                  : undefined
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

      /*
       * The spacing and margin the print export lays copies out with. Checkout
       * sent both and they were dropped right here, so every printed sheet fell
       * back to a 0.06in gap whatever the customer had set.
       */
      const recordedSpacingIn =
        typeof itemSpacingIn === "number" && itemSpacingIn >= 0 && itemSpacingIn <= 6 ? itemSpacingIn : undefined;
      const recordedMarginIn =
        typeof sheetMarginIn === "number" && sheetMarginIn >= 0 && sheetMarginIn <= 2 ? sheetMarginIn : undefined;

      /*
       * The roll a sheet was built on must be the roll it is billed and printed
       * on. The roll width is an admin setting; if it changed after this sheet
       * was laid out, its positions no longer match the roll. Refused, so the
       * customer reopens the sheet and it re-fits, rather than paying for one
       * width and receiving another.
       */
      const rollWidthIn = globalPricing.sheetWidthIn;
      if (
        String(type).toLowerCase() === "gangsheet" &&
        typeof sheetWidthIn === "number" &&
        Math.abs(sheetWidthIn - rollWidthIn) > 0.005
      ) {
        const error = new Error(
          `The sheet width changed to ${rollWidthIn}in after this gang sheet was built. Open it in the editor so the artwork re-fits, then check out again.`,
        ) as CustomError;
        error.statusCode = 409;
        throw error;
      }

      /*
       * Billed on at least the length it prints.
       *
       * The length arrives from the client, measured on the artboard. The
       * placements say where every graphic actually lands, so the sheet is
       * priced and recorded on whichever is longer: a client that measures
       * short cannot buy a longer print than it paid for.
       */
      const printedLengthIn =
        normalizedArtboardItems && normalizedArtboardItems.length > 0
          ? roundToTwo(
              printedSheetLengthIn({
                sheetWidthIn: rollWidthIn,
                artboardItems: normalizedArtboardItems,
                itemSpacingIn: recordedSpacingIn,
                sheetMarginIn: recordedMarginIn,
              }),
            )
          : 0;
      /*
       * Every graphic must sit on the roll. The editor keeps artwork inside the
       * printable width, but a sheet from an older session or another client
       * could still reach past it — and the printer would cut that artwork off.
       */
      if (normalizedArtboardItems && normalizedArtboardItems.length > 0) {
        const extent = printedSheetExtentIn({
          sheetWidthIn: rollWidthIn,
          artboardItems: normalizedArtboardItems,
          itemSpacingIn: recordedSpacingIn,
          sheetMarginIn: recordedMarginIn,
        });
        const toleranceIn = 0.01;
        if (extent.right > rollWidthIn + toleranceIn || extent.left < -toleranceIn) {
          const error = new Error(
            `Some artwork on this gang sheet extends past the ${rollWidthIn}in sheet width, so it would be cut off. Open it in the editor so it fits, then check out again.`,
          ) as CustomError;
          error.statusCode = 409;
          throw error;
        }
      }

      const claimedLengthIn = Number(heightIn);
      const billedLengthIn =
        printedLengthIn > (Number.isFinite(claimedLengthIn) ? claimedLengthIn : 0) + 0.02
          ? printedLengthIn
          : heightIn;
      if (billedLengthIn !== heightIn) {
        console.warn(
          `[ORDER_PRICING] item "${String(name)}" claimed ${heightIn}in but its placements print ${printedLengthIn}in — billing ${printedLengthIn}in`,
        );
      }

      /**
       * Priced here, from the sheet's dimensions and the configured rate — see
       * the note above `deriveItemUnitPrice`. After the length check, so the
       * price is for the sheet that prints.
       */
      const quantity = itemQuantity(item);
      const unitPrice = deriveItemUnitPrice({ ...item, heightIn: billedLengthIn }, globalPricing);

      const clientUnitPrice = Number(item?.unitPrice);
      if (Number.isFinite(clientUnitPrice) && roundToTwo(clientUnitPrice) !== unitPrice) {
        console.warn(
          `[ORDER_PRICING] item "${String(name)}" sent unitPrice ${roundToTwo(clientUnitPrice)} ` +
            `but ${widthIn}x${billedLengthIn}in at $${globalPricing.baseRatePerSqFt}/sq ft is ${unitPrice} — charging ${unitPrice}`,
        );
      }

      const lineSubtotal = unitPrice * quantity;
      computedSubtotal += lineSubtotal;

      return {
        type,
        designId,
        name,
        widthIn,
        heightIn: billedLengthIn,
        quantity,
        unitPrice,
        subtotal: lineSubtotal,
        sheetWidthIn: typeof sheetWidthIn === "number" ? sheetWidthIn : undefined,
        sheetHeightIn:
          billedLengthIn !== heightIn
            ? billedLengthIn
            : typeof sheetHeightIn === "number" ? sheetHeightIn : undefined,
        itemSpacingIn: recordedSpacingIn,
        sheetMarginIn: recordedMarginIn,
        // The roll this sheet was built and billed on; every render uses it.
        rollWidthIn: String(type).toLowerCase() === "gangsheet" ? rollWidthIn : undefined,
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
      totalSqFt: totalBillableSqFt(items, globalPricing),
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

    /**
     * Priority is the customer's choice, made at checkout by picking express.
     *
     * It used to be set only by an admin at assignment — so the express
     * option's "priority handling" was charged for and never delivered, and the
     * partner's rush surcharge was applied to orders nobody had paid a rush on.
     */
    const orderPriority = priorityForShippingMethod(shippingMethod);

    const authoritativeTotals = computeOrderTotals({
      subtotal: roundedComputedSubtotal,
      shippingMethod,
      pricing: globalPricing,
      shippingCost: shippingQuote.cost,
      priority: orderPriority,
    });

    const recordedPricing = {
      subtotal: authoritativeTotals.subtotal,
      rushSurcharge: authoritativeTotals.rushSurcharge,
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

    /*
     * Shape checked here, on the field that actually lands: `customer.phone`
     * is what the store submits and what the schema stores — the shipping
     * address has no phone field at all, so a check placed there would
     * validate a value the database silently discards. Nothing validated this
     * before, so "1" or "abc" would have been stored as the number used to
     * reach a customer about their own order. Optional, as it always was —
     * only checked when supplied.
     */
    if (customer?.phone && !isValidPhone(String(customer.phone))) {
      const error = new Error("Enter a valid phone number") as CustomError;
      error.statusCode = 400;
      throw error;
    }

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

    /*
     * The payment is confirmed with Stripe before an order exists.
     *
     * `payment` used to be stored exactly as the request sent it, so a
     * fabricated `paymentIntentId` produced a real, unpaid order queued for a
     * partner to print. Checked against `recordedPricing.total` — the server's
     * own figure — rather than anything the caller supplied.
     */
    const verifiedPayment = await verifyCardPayment({
      paymentIntentId: payment.paymentIntentId,
      expectedTotal: recordedPricing.total,
      currency: recordedPricing.currency,
      userId: String(req.user?.id || ""),
    });

    /*
     * Built from what Stripe confirmed, not from what the request sent. The two
     * agree when the caller is honest, and only one of them is evidence.
     */
    const recordedPayment = {
      method: "card" as const,
      paymentIntentId: verifiedPayment.paymentIntentId,
      cardBrand: verifiedPayment.cardBrand ?? undefined,
      cardLast4: verifiedPayment.cardLast4 ?? undefined,
      // Stripe's fee, so profit is counted after it. Filled in later if Stripe
      // hadn't settled the charge yet (see `recordMissingProcessingFee`).
      processingFee: verifiedPayment.processingFee ?? undefined,
    };

    const order = new Order({
      user: req.user?.id,
      displayId: await nextOrderDisplayId(),
      items: orderItems,
      customer: normalizedCustomer,
      shippingAddress: enrichedShippingAddress,
      shippingMethod,
      payment: recordedPayment,
      priority: orderPriority,
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
        parcel: deriveParcel(totalBillableSqFt(items, globalPricing), globalPricing.packaging),
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
    /*
     * A preview for every sheet, not only the first. This rendered
     * `orderItems.find(gangsheet)` and saved it with `items.$`, so on a
     * multi-sheet order every sheet after the first had no picture — in order
     * history, on the admin's order and on the printer's job.
     */
    void renderOrderSheetPreviews(order.id, orderItems);

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

    /*
     * The order is saved and paid, so what was in the cart has been bought.
     * Cleared here, not only by the store after the response: if the customer
     * closes the tab first, the saved cart would otherwise come back on their
     * next sign-in holding sheets they already paid for.
     */
    if (req.user?.id) {
      await User.updateOne({ _id: req.user.id }, { $set: { cart: [] } }).catch((err: any) => {
        console.warn(`[ORDER_CART] orderId=${orderId} could not clear the saved cart (non-fatal): ${err?.message}`);
      });
    }

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
    const { title: rawTitle, thumbnail, size, pricing, artboardData, autoName } = req.body;

    /*
     * Names are unique per customer. One the app chose (autosave, "Untitled gang
     * sheet") simply takes the next free number; one the customer typed is
     * refused if taken, so they're never silently given a different name.
     */
    const wanted = normalizeTitle(rawTitle) || UNTITLED_SHEET;
    let title = wanted;
    if (await isTitleTaken(req.user?.id, wanted)) {
      if (!autoName) throw titleTakenError(wanted);
      title = await uniqueTitle(req.user?.id, wanted);
    }

    const design = new Design({
      user: req.user?.id,
      title,
      // Kept as a file, not as base64 in this document — see designThumbnail.ts.
      thumbnail: await storeDesignThumbnail(thumbnail),
      size,
      pricing,
      artboardData
    });

    // A saved design carries the same artboard payload an order does, so it
    // overflows the same way — and losing a design to an opaque 500 is worse
    // than failing an order, since the work is not recoverable from a cart.
    assertPersistable(design.toObject(), { label: "design" });
    await design.save();

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

    /*
     * The typed text, matched literally.
     *
     * It went into the regex as written, so a name with brackets in it — which
     * copies now have ("Shirts (2)") — searched as a pattern: typing the "(" on
     * its own is an invalid regex and the search failed outright.
     */
    const designs = await Design.find({
      user: req.user?.id,
      title: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" }
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

    /*
     * Items store `assetId`, usually an asset's database id. The editor needs an
     * image address for a piece whose saved image is missing, and showed a broken
     * image when all it had was the id — so each id is sent with its address.
     */
    const artboardData = design.toObject().artboardData ?? { items: [] };
    const items = Array.isArray(artboardData.items) ? artboardData.items : [];
    const assetIds = [
      ...new Set(items.map((it: any) => String(it.assetId || "")).filter((id) => mongoose.isValidObjectId(id) && /^[a-f0-9]{24}$/i.test(id))),
    ];
    const addresses = new Map<string, string>();
    if (assetIds.length > 0) {
      const assets = await Asset.find({ _id: { $in: assetIds }, user: req.user?.id }).select("url").lean();
      for (const asset of assets as any[]) if (asset.url) addresses.set(String(asset._id), String(asset.url));
    }

    res.json({
      id: design.id,
      title: design.title,
      size: design.size,
      pricing: design.pricing,
      artboardData: {
        ...artboardData,
        items: items.map((it: any) => {
          const assetUrl = addresses.get(String(it.assetId));
          return assetUrl ? { ...it, assetUrl } : it;
        }),
      },
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
    if (title !== undefined) {
      const next = normalizeTitle(title);
      if (!next) {
        const error = new Error("A sheet needs a name.") as CustomError;
        error.statusCode = 400;
        throw error;
      }
      if (await isTitleTaken(req.user?.id, next, designId)) throw titleTakenError(next);
      updateData.title = next;
    }
    if (thumbnail !== undefined) updateData.thumbnail = await storeDesignThumbnail(thumbnail);
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
      // A copy is named for the customer, so it always gets a free name.
      title: await uniqueTitle(req.user?.id, newTitle),
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

    // Only the first sheet was described, so a three-sheet order read as one.
    const describeSheets = (order: any) => {
      const items = Array.isArray(order.items) ? order.items : [];
      if (items.length === 0) return null;
      if (items.length > 1) return `${items.length} sheets`;
      const it = items[0];
      return formatSheetSize(it.sheetWidthIn ?? it.widthIn, it.sheetHeightIn ?? it.heightIn);
    };

    const responseOrders = orders.map((order) => ({
      orderId: order.id,
      // Same order number the customer sees on their invoice and in emails.
      displayId: (order as any).displayId || null,
      status: customerOrderStatus(order.status),
      date: order.createdAt,
      total: order.pricing?.total ?? null,
      sheetSize: describeSheets(order),
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

    const formattedItems = (order.items || []).map((item) => {
      const description =
        formatSheetSize((item as any).sheetWidthIn ?? item.widthIn, (item as any).sheetHeightIn ?? item.heightIn) || "";

      return {
        name: item.name || "Unknown Item",
        description: description,
        quantity: item.quantity || 0,
        unitPrice: item.unitPrice || 0,
        subtotal: item.subtotal || 0,
        /*
         * The sheet's actual shape, not only a description string built from it.
         *
         * These were read to compose `description` and then dropped, so the only
         * consumer that needs them — reorder, which refills the cart from this
         * response — had nothing to work with and fell back to a constant. A
         * 60in sheet came back as a default-length one, quietly.
         */
        type: item.type || "gangsheet",
        widthIn: item.widthIn ?? null,
        heightIn: item.heightIn ?? null,
        sheetWidthIn: (item as any).sheetWidthIn ?? item.widthIn ?? null,
        sheetHeightIn: (item as any).sheetHeightIn ?? item.heightIn ?? null,
        // So the reordered line can point at the same artwork.
        designId: (item as any).designId ?? null,
        previewImage: resolveApiFile(req, (item as any).previewImage),
        /*
         * What reorder needs to rebuild the same sheet: where every graphic sat,
         * and the roll and spacing it was laid out with. Without the placements a
         * reordered sheet reached checkout with no artwork and became an order
         * the printer had nothing to print from.
         */
        artboardItems: Array.isArray((item as any).artboardItems) ? (item as any).artboardItems : undefined,
        // The roll it printed on, by the same rule the printer export uses —
        // orders placed before the roll was recorded printed at the legacy width.
        rollWidthIn: (item.type || "gangsheet") === "gangsheet" ? orderSheetWidthIn(item as any) : null,
        itemSpacingIn: (item as any).itemSpacingIn ?? null,
        sheetMarginIn: (item as any).sheetMarginIn ?? null,
      };
    });

    const pricing = order.pricing || {};

    res.json({
      orderId: order.id,
      displayId: (order as any).displayId || null,
      status: customerOrderStatus(order.status),
      // Missing, so the details view fell back to today's date for every order.
      date: order.createdAt,
      shippingMethod: (order as any).shippingMethod === "express" ? "express" : "standard",
      trackingNumber: order.trackingNumber || null,
      carrier: (order as any).carrier || null,
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
        lineItems: orderChargeLines(order),
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

    const rawBuffer = req.file.buffer;

    // Deduplication: if this user already uploaded the exact same file, reuse it.
    const contentHash = crypto.createHash("sha256").update(rawBuffer).digest("hex");
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
         * Reuse the stored verdict unless it was reached under older rules (or
         * none). Identical bytes cannot produce a different answer under the same
         * rules, so re-running the model would spend a call to reproduce a result
         * we already have — while a verdict from before a rule change would
         * silently keep missing what the new rule catches.
         */
        const fadeIsCurrent = foundAsset.fade?.version === TRANSPARENCY_CHECK_VERSION;
        const cachedFade = fadeIsCurrent ? foundAsset.fade : await detectFade(rawBuffer);
        if (!fadeIsCurrent) {
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
     * to travel a long way through this handler. It was uploaded to storage,
     * its metadata extraction failed into a swallowed `catch`, and the response
     * went back as a **201 with `widthPx: undefined`**. The client then computed
     * `undefined / dpi`, and placed an item on the sheet whose physical size was
     * NaN: no error anywhere, and a gang sheet that cannot be printed.
     *
     * So this is now a hard 400, and it runs *before* the upload —
     * there is no reason to spend the round trip and the storage on a file that
     * is about to be rejected.
     *
     */
    let widthPx: number | undefined, heightPx: number | undefined, dpi: number | undefined;

    /*
     * PDFs are refused as artwork. A stored PDF cannot be printed: sharp in this
     * build has no PDF support, so the export pipeline dropped PDF items from
     * the sheet without a word. The editor renders each page to a PNG before
     * uploading (`pdfRasterize.ts`), so only a caller bypassing it lands here.
     *
     * Checked by signature as well as type, so a PDF renamed .png gets this
     * message rather than "could not be read".
     */
    /*
     * SVG likewise: the editor renders it to a PNG at its real size before
     * uploading, so the print pipeline only ever composites raster artwork.
     */
    const head = rawBuffer.subarray(0, 256).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
    if (req.file.mimetype === "image/svg+xml" || head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
      const error = new Error(
        `“${req.file.originalname}” is an SVG. Add it from the editor, which converts it to an image at its real size, or upload a PNG or JPG.`,
      ) as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (
      req.file.mimetype === "application/pdf" ||
      rawBuffer.subarray(0, 5).toString("latin1") === "%PDF-"
    ) {
      const error = new Error(
        `“${req.file.originalname}” is a PDF. Add it from the editor, which converts each page to an image, or upload a PNG or JPG.`,
      ) as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // Upright before anything reads its size; see `uprightImage`.
    let fileBuffer = rawBuffer;
    try {
      fileBuffer = await uprightImage(rawBuffer);
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

    /*
     * Store the original, find the trim and run the fade check at the same time
     * — they only read the same bytes. They ran one after another, and with the
     * old trim re-encoding the whole image as PNG twice, a phone photo spent
     * seconds of CPU before the customer saw anything.
     */
    const [{ url: fileUrl }, trim, fade] = await Promise.all([
      storeArtwork(fileBuffer, "space-transfers/assets"),
      trimImage(fileBuffer).catch((e: any) => {
        console.warn(`[UPLOAD] trim failed for ${req.file!.originalname}: ${e?.message}`);
        return null;
      }),
      detectFade(fileBuffer),
    ]);

    const normalizedDpi = (!dpi || dpi < 150) ? 300 : dpi;
    const widthIn = widthPx && normalizedDpi ? +(widthPx / normalizedDpi).toFixed(4) : undefined;
    const heightIn = heightPx && normalizedDpi ? +(heightPx / normalizedDpi).toFixed(4) : undefined;

    // Trim and store the trimmed version alongside it.
    let trimmedUrl: string | undefined;
    let trimmedWidthPx: number | undefined;
    let trimmedHeightPx: number | undefined;
    let trimmedWidthIn: number | undefined;
    let trimmedHeightIn: number | undefined;
    try {
      if (trim) {
        // Nothing to trim (most photos): the original is the trimmed copy.
        trimmedUrl = trim.unchanged ? fileUrl : (await storeArtwork(trim.buffer, "space-transfers/trimmed")).url;
        trimmedWidthPx = trim.widthPx;
        trimmedHeightPx = trim.heightPx;
        trimmedWidthIn = trimmedWidthPx && normalizedDpi ? +(trimmedWidthPx / normalizedDpi).toFixed(4) : undefined;
        trimmedHeightIn = trimmedHeightPx && normalizedDpi ? +(trimmedHeightPx / normalizedDpi).toFixed(4) : undefined;
      }
    } catch {
      trimmedUrl = undefined;
    }

    // The thumbnail is written beside the original by storeArtwork, at the
    // path computeThumbUrl derives — nothing to generate here.
    const thumbnailUrl = computeThumbUrl(trimmedUrl || fileUrl);

    // The fade check ran alongside the upload above, on the buffer already in
    // memory — the client would otherwise re-download its own upload to inspect
    // the alpha channel. It short-circuits on images with no meaningful partial
    // alpha, so the common upload pays a few milliseconds and never reaches the model.
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
      /*
       * The billing shape of a sheet, so the editor quotes what the server will
       * actually charge. Without these the editor priced the artwork's bounding
       * box while the server bills the roll — the customer would have been shown
       * one number and charged another.
       */
      sheetWidthIn: pricing.sheetWidthIn,
      minSheetLengthIn: pricing.minSheetLengthIn,
      // The storefront shows this as a line on express orders, so it has to
      // know the rate or the cart total would not match what is charged.
      rushSurchargePct: pricing.rushSurchargePct,
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
    // A quote may only be asked for sheets the customer owns.
    const designIds = items
      .filter((it: any) => String(it?.type || "gangsheet").toLowerCase() === "gangsheet")
      .map((it: any) => it?.designId);
    if (designIds.some((id: unknown) => !id)) {
      const error = new Error("designId is required for gangsheet items") as CustomError;
      error.statusCode = 400;
      throw error;
    }
    const owned = await Design.countDocuments({ _id: { $in: [...new Set(designIds)] }, user: req.user?.id });
    if (owned !== new Set(designIds.map(String)).size) {
      const error = new Error("Design not found for cart item") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    /*
     * Priced by `priceItems`, the function the Stripe charge uses, so the total
     * checkout shows is the total the card is charged.
     *
     * This path used to price on its own: from the area stored on each design
     * (saved before the minimum sheet length existed, so older sheets quoted
     * low) and from `copies` only, while the charge reads `quantity`. Nothing
     * called it, and the storefront showed flat rates instead — so once live
     * carrier rates were on, the card was charged a shipping figure the
     * customer had never been shown.
     */
    const totals = await priceItems(items, shippingMethod, {
      state: String(req.body?.shippingState || ""),
      postalCode: String(shippingPostalCode || ""),
      country: String(shippingCountry || "US"),
      city: req.body?.shippingCity ? String(req.body.shippingCity) : undefined,
    });
    const pricing = await getGlobalPricing();

    res.status(200).json({
      items: items.map((it: any) => {
        const unitPrice = deriveItemUnitPrice(it, pricing);
        return {
          name: it?.name,
          unitPrice,
          quantity: itemQuantity(it),
          subtotal: roundToTwo(unitPrice * itemQuantity(it)),
        };
      }),
      subtotal: totals.subtotal,
      rushSurcharge: totals.rushSurcharge,
      shippingCost: totals.shippingCost,
      // Named so the storefront can say "USPS Ground Advantage" instead of just
      // a number, and so a fallback is visible rather than silent.
      shippingService: totals.shipping.serviceName,
      shippingSource: totals.shipping.source,
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
    const { billedPrice, sheetWidthIn, billedLengthIn, usedLengthIn } = req.body || {};

    const price = Number(billedPrice);
    const width = Number(sheetWidthIn);
    const billed = Number(billedLengthIn);
    const used = Number(usedLengthIn);
    if (![price, width, billed, used].every((n) => Number.isFinite(n) && n >= 0) || price <= 0) {
      const error = new Error("billedPrice, sheetWidthIn, billedLengthIn and usedLengthIn are required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    /*
     * About the minimum billable length, which is the rule. This used to say the
     * customer would be charged for a "full" 23.5 x 23.5in sheet — a figure no
     * setting held and nothing else charged.
     */
    const subject = "Unused gang sheet space notice";
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
        <h2 style="margin: 0 0 12px 0;">Unused gang sheet space</h2>
        <p style="margin: 0 0 12px 0;">
          Your artwork is ${used.toFixed(2)}in long. Gang sheets are billed from a ${billed.toFixed(2)}in minimum,
          so this ${width.toFixed(2)}in &times; ${billed.toFixed(2)}in sheet costs <strong>$${price.toFixed(2)}</strong>.
        </p>
        <p style="margin: 0; color: #6B7280; font-size: 12px;">
          You can add more artwork to the same sheet at no extra cost until it reaches ${billed.toFixed(2)}in.
        </p>
      </div>
    `;

    const sendResult = await sendEmail({ to: user.email, subject, html });
    console.log(
      `[GANGSHEET_WARN] user=${user.id} used=${used}in billed=${billed}in price=$${price.toFixed(2)} sent=${sendResult.sent}`,
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
      const description =
        formatSheetSize((item as any).sheetWidthIn ?? item.widthIn, (item as any).sheetHeightIn ?? item.heightIn) || "";
      return {
        name: item.name || "Unknown Item",
        description: description,
        quantity: item.quantity || 0,
        unitPrice: (item.unitPrice || 0).toFixed(2),
        subtotal: (item.subtotal || 0).toFixed(2)
      };
    });

    const pricing = order.pricing || {};
    // The same lines as the order details and the admin's copy of this invoice.
    const lineItems = orderChargeLines(order);

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

/*
 * `reorder` was removed.
 *
 * It created a live order the moment it was called — no cart, no address
 * confirmation, no payment step — and the store's Order Details modal called it
 * behind a button that toasted "Order placed successfully!". The order it wrote
 * carried no `paymentIntentId`, so it was unpaid, and it was priced by copying
 * the ORIGINAL order's stored `unitPrice` and tax ratio rather than going
 * through `deriveItemUnitPrice`. After any rate or minimum-length change it
 * would have charged the old amount.
 *
 * Reordering now fills the cart from `GET /customer/orders/:id` and goes through
 * checkout like any other order, which is what Order History already did.
 */
