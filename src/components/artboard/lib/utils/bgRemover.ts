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
 * 2. Apply the result as a BINARY mask: flood-filled background pixels become
 *    fully transparent; every foreground pixel is left byte-for-byte as it was.
 *
 * Foreground pixels are never rewritten. The previous implementation derived a
 * soft alpha from each pixel's brightness and then "un-premultiplied" its RGB
 * (dividing by that alpha). On a dark background that maths is destructive: a
 * near-black pixel gets a tiny alpha, so it turns semi-transparent AND its
 * colour is divided by a small number and blown out — bleaching dark/black
 * regions of the subject (the washed-out maroon border). A binary mask cannot
 * desaturate, lighten, or partially erase the subject: what wasn't background
 * keeps its exact original colour and opacity.
 */
function removeColorBackground(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  bgType: BgType,
): void {
  // How close a pixel must be to a WHITE bg to be flood-filled.
  const WHITE_TOL = 30;

  // Dark backgrounds need far stricter rules. A black backdrop and a dark
  // SUBJECT (a near-black bevel, a deep maroon extruded face, black linework)
  // sit at almost the same brightness, so a loose "is it dark?" threshold
  // floods straight out of the background and eats the artwork — that is what
  // deleted the dark bottom face of the tile. Two guards keep the subject safe:
  //
  //  • BLACK_TOL — a much tighter brightness ceiling, so only near-pure black
  //    counts as background rather than everything merely "a bit dark".
  //  • BLACK_CHROMA_TOL — a neutrality test. A real black backdrop is
  //    achromatic (r ≈ g ≈ b). The artwork's dark regions carry colour: a
  //    maroon bevel has a clear red cast, so max-channel minus min-channel is
  //    well above zero. Any pixel with meaningful chroma is treated as SUBJECT
  //    and is never flood-filled, no matter how dark it is.
  // A genuine black backdrop is essentially colourless (chroma ~0-3, allowing a
  // little for compression noise), so this stays deliberately tight — even a
  // very deep maroon still carries clearly more chroma than that and survives.
  const BLACK_TOL = 18;
  const BLACK_CHROMA_TOL = 8;

  // ── Step 1: flood-fill from edges ──────────────────────────────────────
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];

  const isBg = (flat: number): boolean => {
    const i = flat * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (bgType === "white") {
      return r >= 255 - WHITE_TOL && g >= 255 - WHITE_TOL && b >= 255 - WHITE_TOL;
    }
    const maxCh = Math.max(r, g, b);
    const minCh = Math.min(r, g, b);
    return maxCh <= BLACK_TOL && maxCh - minCh <= BLACK_CHROMA_TOL;
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

  // ── Step 2: binary mask — background out, foreground untouched ─────────
  // ONLY flood-filled background pixels are modified (alpha → 0). Object
  // pixels (visited === 0) keep their exact original RGB *and* original alpha:
  // no soft ramp, no un-premultiply, nothing that could lighten or fade them.
  // This is what guarantees a dark/black subject region stays fully opaque and
  // true to colour instead of being bleached.
  for (let i = 0; i < w * h; i++) {
    if (!visited[i]) continue;
    data[i * 4 + 3] = 0;
  }

  // ── Step 3: defringe the cut edge ──────────────────────────────────────
  // Anti-aliased pixels just inside the silhouette are a blend of subject and
  // old background. They stay opaque (we never fade the subject), so repaint
  // that thin rim with colour sampled from the clean interior — removing the
  // background-coloured halo without touching a single alpha value.
  decontaminateEdges(data, w, h, bgType);
}

/**
 * Edge colour decontamination ("defringe").
 *
 * Repaints the 1-px opaque rim of the cutout using colour drawn from the clean
 * interior of the subject, so no leftover background tint (a light halo on a
 * white bg, a dark one on black) rings the artwork. Strength scales with how
 * contaminated each rim pixel actually is, so uncontaminated edges are left
 * alone.
 *
 * Crucially it NEVER modifies alpha and never touches interior pixels — it
 * cannot erode the subject, punch holes, or make anything transparent. It is
 * purely cosmetic colour repair on the boundary.
 */
function decontaminateEdges(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  bgType: BgType | null,
): void {
  const n = w * h;
  const opaque = new Uint8Array(n);
  for (let i = 0; i < n; i++) opaque[i] = data[i * 4 + 3] > 0 ? 1 : 0;

  const isRim = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true;
        if (!opaque[ny * w + nx]) return true;
      }
    }
    return false;
  };

  // Sample only ORIGINAL neighbour colours, never partially-repainted ones.
  const out = new Uint8ClampedArray(data);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const flat = y * w + x;
      if (!opaque[flat] || !isRim(x, y)) continue;

      // Average colour of fully-interior opaque neighbours = the true subject
      // colour just inside this rim pixel.
      let cnt = 0, sr = 0, sg = 0, sb = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nf = ny * w + nx;
          if (opaque[nf] && !isRim(nx, ny)) {
            const ni = nf * 4;
            sr += data[ni]; sg += data[ni + 1]; sb += data[ni + 2];
            cnt++;
          }
        }
      }
      if (cnt === 0) continue; // thin sliver with no clean interior — leave it

      const ar = sr / cnt, ag = sg / cnt, ab = sb / cnt;
      const i = flat * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];

      let strength: number;
      if (bgType === "white") {
        strength = Math.min(1, Math.max(0, (Math.min(r, g, b) - 150) / 105));
      } else if (bgType === "black") {
        strength = Math.min(1, Math.max(0, (110 - Math.max(r, g, b)) / 110));
      } else {
        strength = 0.5; // unknown background: gentle uniform clean-up
      }

      out[i]     = Math.round(r + (ar - r) * strength);
      out[i + 1] = Math.round(g + (ag - g) * strength);
      out[i + 2] = Math.round(b + (ab - b) * strength);
      // Alpha deliberately untouched.
    }
  }

  data.set(out);
}

/**
 * Hard-binarizes an alpha matte so no foreground pixel is left semi-transparent.
 *
 * The AI model returns a soft matte; DTF printing has no translucency, and a
 * partially-transparent subject pixel composites against whatever is behind it
 * and reads as faded/bleached. Anything at or above the threshold becomes fully
 * opaque, everything below is dropped. RGB is never rewritten.
 */
function binarizeAlpha(data: Uint8ClampedArray, threshold = 128): void {
  for (let i = 3; i < data.length; i += 4) {
    data[i] = data[i] >= threshold ? 255 : 0;
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

  // Same guarantee as the colour-key path: the subject must come out fully
  // opaque and true to colour. The model's soft matte would otherwise leave the
  // silhouette's edge semi-transparent, which reads as a faded/bleached border.
  const aiData = ctx.getImageData(0, 0, w, h);
  binarizeAlpha(aiData.data);
  decontaminateEdges(aiData.data, w, h, null);
  ctx.putImageData(aiData, 0, 0);

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
