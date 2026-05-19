import { removeBackground } from "@imgly/background-removal";

export interface BgRemovalResult {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  originalWidthPx: number;
  originalHeightPx: number;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result as string);
    reader.onerror = rej;
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

function hasVisiblePixels(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return true;
  }
  return false;
}

function trimTransparentCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): { dataUrl: string; cw: number; ch: number } | null {
  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  const outCtx = out.getContext("2d")!;
  outCtx.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return { dataUrl: out.toDataURL("image/png"), cw, ch };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}

type BgType = "white" | "black";

/**
 * Samples the four corners of the image to detect if the background is a
 * plain solid white or black colour. Returns null for everything else.
 */
function detectSolidBackground(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): BgType | null {
  const size = Math.max(4, Math.min(20, Math.floor(Math.min(w, h) / 8)));
  const corners = [
    [0, 0],
    [w - size, 0],
    [0, h - size],
    [w - size, h - size],
  ] as const;

  let whitish = 0, blackish = 0, total = 0;

  for (const [cx, cy] of corners) {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const x = Math.max(0, Math.min(w - 1, cx + dx));
        const y = Math.max(0, Math.min(h - 1, cy + dy));
        const i = (y * w + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        total++;
        if (r > 230 && g > 230 && b > 230) whitish++;
        else if (r < 25 && g < 25 && b < 25) blackish++;
      }
    }
  }

  // Require 85 % of corner pixels to agree on the background colour.
  if (whitish / total >= 0.85) return "white";
  if (blackish / total >= 0.85) return "black";
  return null;
}

/**
 * Removes a solid white or black background while keeping all object
 * detail — including fine particles and soft edges — intact.
 *
 * Strategy:
 * 1. Flood-fill from all four image edges to find the connected background
 *    region (using a colour tolerance).  This means isolated white/black
 *    pixels that belong to the object are never touched.
 * 2. For every background pixel compute a smooth alpha via the standard
 *    compositing un-premultiply formula so that anti-aliased edges and
 *    semi-transparent fringe are correctly recovered rather than hard-cut.
 */
function removeColorBackground(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  bgType: BgType,
): void {
  // How close a pixel must be to the bg colour to be flood-filled.
  const FLOOD_TOL = 30;
  // Range over which the alpha blends from 0 → 1 at edges.
  const EDGE_SOFT = 55;

  // ── Step 1: flood-fill from edges ──────────────────────────────────────
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];

  const isBg = (flat: number): boolean => {
    const i = flat * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return bgType === "white"
      ? r >= 255 - FLOOD_TOL && g >= 255 - FLOOD_TOL && b >= 255 - FLOOD_TOL
      : r <= FLOOD_TOL && g <= FLOOD_TOL && b <= FLOOD_TOL;
  };

  const push = (flat: number) => {
    if (flat >= 0 && flat < w * h && !visited[flat] && isBg(flat)) {
      visited[flat] = 1;
      stack.push(flat);
    }
  };

  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    push(y * w);
    push(y * w + w - 1);
  }

  while (stack.length) {
    const flat = stack.pop()!;
    const px = flat % w, py = (flat / w) | 0;
    if (px > 0) push(flat - 1);
    if (px < w - 1) push(flat + 1);
    if (py > 0) push(flat - w);
    if (py < h - 1) push(flat + w);
  }

  // ── Step 2: apply alpha only to flood-filled (background) pixels ───────
  // Object pixels (visited === 0) are left completely untouched, preserving
  // every particle even if it happens to be white or black.
  for (let i = 0; i < w * h; i++) {
    if (!visited[i]) continue;

    const idx = i * 4;
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];

    let alpha: number;

    if (bgType === "white") {
      // Pixels closer to pure white get lower alpha.
      // min-channel = how non-white the pixel is (0 = pure white, 255 = no white).
      alpha = Math.min(1, (255 - Math.min(r, g, b)) / EDGE_SOFT);
      // Un-premultiply from white to recover the true foreground colour.
      if (alpha > 0.02) {
        data[idx]     = clamp(Math.round((r - (1 - alpha) * 255) / alpha));
        data[idx + 1] = clamp(Math.round((g - (1 - alpha) * 255) / alpha));
        data[idx + 2] = clamp(Math.round((b - (1 - alpha) * 255) / alpha));
      }
    } else {
      // Pixels closer to pure black get lower alpha.
      // max-channel = how non-black the pixel is (0 = pure black, 255 = no black).
      alpha = Math.min(1, Math.max(r, g, b) / EDGE_SOFT);
      // Un-premultiply from black (divide by alpha).
      if (alpha > 0.02) {
        data[idx]     = clamp(Math.round(r / alpha));
        data[idx + 1] = clamp(Math.round(g / alpha));
        data[idx + 2] = clamp(Math.round(b / alpha));
      }
    }

    data[idx + 3] = Math.round(alpha * 255);
  }
}

export async function removeBackgroundAI(
  url: string,
  onProgress?: (phase: string, pct: number) => void,
): Promise<BgRemovalResult> {
  const fetchRes = await fetch(url);
  const inputBlob = await fetchRes.blob();

  const origDataUrl = await blobToDataUrl(inputBlob);
  const origImg = await loadImage(origDataUrl);
  const origW = origImg.naturalWidth;
  const origH = origImg.naturalHeight;

  // Draw the source image so we can inspect its pixels.
  onProgress?.("Analyzing image...", 5);
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = origW;
  srcCanvas.height = origH;
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true })!;
  srcCtx.drawImage(origImg, 0, 0);
  const imageData = srcCtx.getImageData(0, 0, origW, origH);

  const bgType = detectSolidBackground(imageData.data, origW, origH);

  if (bgType) {
    // Fast path: plain white / black background — use colour-keying.
    // This path never crops and never touches isolated particles.
    onProgress?.("Removing background...", 30);
    removeColorBackground(imageData.data, origW, origH, bgType);

    if (!hasVisiblePixels(imageData.data)) {
      throw new Error("No subject detected — the entire image was removed");
    }

    srcCtx.putImageData(imageData, 0, 0);

    const trimmed = trimTransparentCanvas(srcCanvas, srcCtx, origW, origH);
    if (!trimmed) {
      throw new Error("No subject detected — the entire image was removed");
    }

    onProgress?.("Done", 100);

    return {
      dataUrl: trimmed.dataUrl,
      widthPx: trimmed.cw,
      heightPx: trimmed.ch,
      originalWidthPx: origW,
      originalHeightPx: origH,
    };
  }

  // Slow path: non-solid background — use the AI model.
  const outputBlob = await removeBackground(inputBlob, {
    progress: (key: string, current: number, total: number) => {
      if (!onProgress) return;
      const pct = total > 0 ? Math.min(99, Math.round((current / total) * 100)) : 0;
      let phase = "Processing...";
      if (key.startsWith("fetch:")) phase = "Downloading AI model...";
      else if (key.includes("inference")) phase = "Removing background...";
      else if (key.startsWith("compute:")) phase = "Analyzing image...";
      onProgress(phase, pct);
    },
    output: { format: "image/png", quality: 1 },
  });

  const resultDataUrl = await blobToDataUrl(outputBlob);
  const resultImg = await loadImage(resultDataUrl);
  const w = resultImg.naturalWidth;
  const h = resultImg.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(resultImg, 0, 0);

  const trimmed = trimTransparentCanvas(canvas, ctx, w, h);
  if (!trimmed) {
    throw new Error("No subject detected — the entire image was removed");
  }

  onProgress?.("Done", 100);

  return {
    dataUrl: trimmed.dataUrl,
    widthPx: trimmed.cw,
    heightPx: trimmed.ch,
    originalWidthPx: origW,
    originalHeightPx: origH,
  };
}
