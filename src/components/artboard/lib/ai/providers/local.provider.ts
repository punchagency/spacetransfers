import type { AiEditProvider, AiEditRequest, AiEditResult, AiIntentId } from "../types";
import { AiEditAbortedError } from "../types";

/**
 * Runs the operations the app can already do deterministically — background
 * removal (in-browser WASM segmentation) and AI upscaling (server endpoint with
 * sharp on the server).
 *
 * Registered at the highest priority so prompts like "remove the white
 * background" never spend a generative credit on work that has a better,
 * cheaper, offline-capable implementation.
 */

const LOCAL_INTENTS: AiIntentId[] = [
  "remove-bg",
  "make-transparent",
  "to-sticker",
  "upscale",
  "enhance",
  // Deterministic pixel work with one correct answer. Handled here rather than
  // generatively for accuracy, not just cost: a model asked to remove a colour
  // returns a repaint of the artwork with that colour mostly gone, and "mostly"
  // is a reprint when the removed colour was supposed to become transparency.
  "remove-color",
];

// A colour change can be handled in-browser as a dependable fallback when the
// generative provider is unavailable. It intentionally has lower priority than
// the server provider (see `localColorProvider` below): a configured model can
// still honour selective requests such as “make only the shirt red”, while the
// fallback gives customers a useful whole-artwork recolour offline.
const COLOR_NAMES: Record<string, string> = {
  red: "#ef4444", blue: "#2563eb", green: "#16a34a", yellow: "#eab308",
  orange: "#f97316", purple: "#9333ea", pink: "#ec4899", black: "#111827",
  white: "#ffffff", gray: "#6b7280", grey: "#6b7280", gold: "#d4a72c",
  silver: "#a8a29e", brown: "#92400e", teal: "#0f766e", cyan: "#0891b2",
  magenta: "#c026d3", navy: "#1e3a8a", beige: "#d6c3a1", cream: "#fff7d6",
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new AiEditAbortedError();
};

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image for editing"));
    img.src = url;
  });

const colorFromPrompt = (prompt: string): string | null => {
  const hex = prompt.match(/#[0-9a-f]{3,8}\b/i)?.[0];
  if (hex) return hex;
  const words = Array.from(prompt.toLowerCase().matchAll(/\b[a-z]+\b/g));
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const color = COLOR_NAMES[words[i][0]];
    if (color) return color;
  }
  return null;
};

/**
 * The colour as the customer named it ("red"), for messages — a picked swatch
 * or a typed hex has no name, so those are quoted as the hex.
 */
const colorLabel = (prompt: string, hex: string, picked: boolean): string => {
  if (picked) return hex;
  const named = Array.from(prompt.toLowerCase().matchAll(/\b[a-z]+\b/g))
    .map((m) => m[0])
    .find((word) => COLOR_NAMES[word] === hex.toLowerCase());
  return named ? `that ${named}` : hex;
};

/**
 * Pulls a target (and optional replacement) colour out of free text, for when
 * the user typed "remove the white background" instead of using the eyedropper.
 *
 * The replacement clause is matched first and its colour excluded from the
 * target search, because both sit in the same sentence: in "replace the white
 * with black", a single scan for colour words would otherwise pick whichever
 * comes last and remove the colour the user asked to add.
 */
const parseColorSpec = (prompt: string): { target: string | null; replacement: string | null } => {
  const replacementMatch = prompt.match(
    /\b(?:with|to|into|for)\s+(?:a|an|the)?\s*(#[0-9a-f]{3,8}\b|[a-z]+)\b/i,
  );
  const replacement = replacementMatch ? colorFromPrompt(replacementMatch[1]) : null;

  const withoutReplacement = replacementMatch
    ? prompt.slice(0, replacementMatch.index) + prompt.slice(replacementMatch.index! + replacementMatch[0].length)
    : prompt;

  return { target: colorFromPrompt(withoutReplacement), replacement };
};

/** Recolours the visible artwork while retaining its shading and transparency. */
const recolorImage = async (
  imageUrl: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<{ dataUrl: string; widthPx: number; heightPx: number }> => {
  const color = colorFromPrompt(prompt);
  if (!color) {
    throw new Error("Name a colour, for example “make the artwork forest green” or “change it to #2563eb”.");
  }
  const image = await loadImage(imageUrl);
  throwIfAborted(signal);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable in this browser");

  context.drawImage(image, 0, 0);
  // The `color` blend mode changes hue/saturation but keeps the artwork's
  // luminance, detail, and alpha — substantially better for print art than a
  // flat `source-in` silhouette.
  context.globalCompositeOperation = "color";
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "source-over";

  return { dataUrl: canvas.toDataURL("image/png"), widthPx: canvas.width, heightPx: canvas.height };
};

/**
 * Wraps a transparent cutout in a solid contour border, the way a die-cut
 * sticker is manufactured. The silhouette is dilated by stamping the cutout at
 * points around a circle of `radius`, filling the union with the border colour,
 * then laying the original artwork back on top.
 */
const applyStickerBorder = async (
  cutoutUrl: string,
  borderColor = "#ffffff",
): Promise<{ dataUrl: string; widthPx: number; heightPx: number }> => {
  const img = await loadImage(cutoutUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  // Border scales with the artwork so it reads the same at any print size.
  const radius = Math.max(2, Math.round(Math.min(w, h) * 0.03));

  const canvas = document.createElement("canvas");
  canvas.width = w + radius * 2;
  canvas.height = h + radius * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser");

  const STAMPS = 32;
  for (let i = 0; i < STAMPS; i++) {
    const angle = (i / STAMPS) * Math.PI * 2;
    ctx.drawImage(
      img,
      radius + Math.cos(angle) * radius,
      radius + Math.sin(angle) * radius,
    );
  }

  // Flatten the dilated silhouette to a single solid colour.
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = borderColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Lay the untouched artwork back over the border.
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(img, radius, radius);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    widthPx: canvas.width,
    heightPx: canvas.height,
  };
};

/**
 * Kept separate from `localProvider` so it is tried only after the server AI.
 * This is a graceful fallback, not a replacement for selective generative
 * recolouring when a provider is configured.
 */
export const localColorProvider: AiEditProvider = {
  id: "local-colour-fallback",
  label: "Built-in colour",
  priority: 20,
  supports: (intent) => intent === "change-color",
  isAvailable: () => true,

  async edit({ imageUrl, prompt, signal, onProgress }: AiEditRequest): Promise<AiEditResult> {
    throwIfAborted(signal);
    onProgress?.({ phase: "Applying colour…", pct: 25 });
    const result = await recolorImage(imageUrl, prompt, signal);
    throwIfAborted(signal);
    onProgress?.({ phase: "Done", pct: 100 });
    return {
      url: result.dataUrl,
      widthPx: result.widthPx,
      heightPx: result.heightPx,
      reframed: false,
      provider: "local-colour-fallback",
    };
  },
};

export const localProvider: AiEditProvider = {
  id: "local",
  label: "Built-in",
  priority: 0,
  supports: (intent) => LOCAL_INTENTS.includes(intent),
  isAvailable: () => true,

  async edit({ imageUrl, prompt, intent, options, signal, onProgress }: AiEditRequest): Promise<AiEditResult> {
    throwIfAborted(signal);

    if (intent === "remove-color") {
      // The eyedropper's exact pick wins over anything inferred from prose —
      // it is the more precise signal, and it is what the user just clicked.
      const parsed = parseColorSpec(prompt);
      const targetColor = options?.targetColor ?? parsed.target;
      if (!targetColor) {
        // Thrown rather than guessed. The registry falls through to the
        // generative provider on a throw, which can act on a vaguer description
        // than a hex match can — so this is a handoff, not a dead end.
        throw new Error(
          "Which colour should I remove? Click a colour in the image, or name it — “remove the white background”.",
        );
      }

      const { removeColor, nearestImageColor } = await import("../../utils/colorRemover");
      throwIfAborted(signal);

      // A colour *named* in the prompt ("remove the red") is a family, so it is
      // matched to the artwork's own nearest shade. A swatch pick or a typed
      // hex is exact and used as given.
      const named = !options?.targetColor && !/#[0-9a-f]{3,8}\b/i.test(prompt);
      const matchColor = (named && (await nearestImageColor(imageUrl, targetColor))) || targetColor;
      throwIfAborted(signal);

      const result = await removeColor(imageUrl, {
        targetColor: matchColor,
        replacementColor: options?.replacementColor ?? parsed.replacement,
        tolerance: options?.tolerance ?? 25,
        onProgress: (phase, pct) => onProgress?.({ phase, pct }),
      });
      throwIfAborted(signal);

      // A pick that matched almost nothing is reported instead of applied. The
      // alternative is an "edit applied" message over a visually identical
      // image, which reads as the feature being broken.
      if (result.affectedRatio < 0.0005) {
        throw new Error(
          `I couldn't find ${colorLabel(prompt, targetColor, Boolean(options?.targetColor))} in this image. ` +
            "Click the colour in the swatches above instead — set them to Wide to catch nearby shades.",
        );
      }

      onProgress?.({ phase: "Done", pct: 100 });
      return {
        url: result.dataUrl,
        widthPx: result.widthPx,
        heightPx: result.heightPx,
        // Alpha changed but the canvas did not — the artwork stays exactly where
        // and how big it was on the sheet.
        reframed: false,
        provider: "local",
      };
    }

    if (intent === "upscale" || intent === "enhance") {
      onProgress?.({ phase: "Sending to the upscaler…", pct: 8 });
      const { upscaleImageAI } = await import("../../utils/upscaler");
      throwIfAborted(signal);

      // The server picks its own model tier and can't stream progress, so ramp a
      // synthetic bar to a ceiling short of 100 — it only completes on the real result.
      let pct = 12;
      const ticker = window.setInterval(() => {
        pct = Math.min(88, pct + 4);
        onProgress?.({ phase: "Upscaling…", pct });
      }, 700);

      try {
        const result = await upscaleImageAI(imageUrl, 2);
        throwIfAborted(signal);
        onProgress?.({ phase: "Done", pct: 100 });
        return {
          url: result.upscaledUrl,
          widthPx: result.widthPx,
          heightPx: result.heightPx,
          // Pure resolution change — the print box must not move or resize.
          reframed: false,
          provider: "local",
        };
      } finally {
        window.clearInterval(ticker);
      }
    }

    // remove-bg | make-transparent | to-sticker all start from a cutout.
    onProgress?.({ phase: "Loading segmentation model…", pct: 4 });
    const { removeBackgroundAI } = await import("../../utils/bgRemover");
    throwIfAborted(signal);

    const cutout = await removeBackgroundAI(imageUrl, (phase, p) => {
      // Reserve the tail of the bar for the sticker border pass.
      const ceiling = intent === "to-sticker" ? 80 : 100;
      onProgress?.({ phase, pct: Math.round((p / 100) * ceiling) });
    });
    throwIfAborted(signal);

    if (intent !== "to-sticker") {
      return {
        url: cutout.dataUrl,
        widthPx: cutout.widthPx,
        heightPx: cutout.heightPx,
        originalWidthPx: cutout.originalWidthPx,
        originalHeightPx: cutout.originalHeightPx,
        // The cutout is trimmed to the subject, so the bounding box shrank.
        reframed: true,
        provider: "local",
      };
    }

    onProgress?.({ phase: "Cutting sticker border…", pct: 88 });
    const sticker = await applyStickerBorder(cutout.dataUrl);
    throwIfAborted(signal);
    onProgress?.({ phase: "Done", pct: 100 });

    return {
      url: sticker.dataUrl,
      widthPx: sticker.widthPx,
      heightPx: sticker.heightPx,
      originalWidthPx: cutout.originalWidthPx,
      originalHeightPx: cutout.originalHeightPx,
      reframed: true,
      provider: "local",
    };
  },
};
