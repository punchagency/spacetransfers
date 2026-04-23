import fs from "fs";
import path from "path";
import sharp from "sharp";
import { Asset } from "../models/asset.model.js";

const SHEET_DEFAULT_WIDTH_IN = 23.5;
const SHEET_DEFAULT_HEIGHT_IN = 23.5;
const GROUP_GAP_IN = 0.06;

const pad2 = (n: number) => String(n).padStart(2, "0");
const formatTimestamp = (d: Date) => {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
};

const isObjectIdString = (v: string) => /^[0-9a-fA-F]{24}$/.test(String(v || ""));

const looksLikeUrlOrPath = (v: string) => {
  const s = String(v || "");
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (s.startsWith("/uploads/")) return true;
  if (s.includes("/uploads/")) return true;
  return false;
};

const resolveLocalUploadPath = (url: string) => {
  const marker = "/uploads/";
  const idx = url.lastIndexOf(marker);
  if (idx === -1) return null;
  const filename = url.substring(idx + marker.length);
  const safeFilename = path.basename(filename);
  return path.join(process.cwd(), "uploads", safeFilename);
};

const loadImageBuffer = async (url: string) => {
  const local = resolveLocalUploadPath(url);
  if (local && fs.existsSync(local)) {
    return fs.promises.readFile(local);
  }

  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed_to_fetch_asset:${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  return null;
};

export const exportGangsheetPng24 = async ({
  jobId,
  printerId,
  sheetWidthIn,
  sheetHeightIn,
  artboardItems,
  dpi: dpiInput,
}: {
  jobId: string;
  printerId: string;
  sheetWidthIn?: number | null;
  sheetHeightIn?: number | null;
  artboardItems: Array<{
    assetId: string;
    croppedUrl?: string;
    widthIn: number;
    heightIn: number;
    posX: number;
    posY: number;
    rotation?: number;
    copies?: number;
  }>;
  dpi: number;
}): Promise<{
  fileName: string;
  filePath: string;
  byteSize: number;
  dpi: number;
  sheet: { widthIn: number; heightIn: number };
  validation: { ok: boolean; errors: string[]; meta?: any };
}> => {
  const dpi = Math.max(72, Math.min(1200, Math.round(Number(dpiInput) || 600)));
  const widthIn = Number(sheetWidthIn || SHEET_DEFAULT_WIDTH_IN) || SHEET_DEFAULT_WIDTH_IN;
  const heightIn = Number(sheetHeightIn || SHEET_DEFAULT_HEIGHT_IN) || SHEET_DEFAULT_HEIGHT_IN;
  const widthPx = Math.round(widthIn * dpi);
  const heightPx = Math.round(heightIn * dpi);

  const createdAt = new Date();
  const stamp = formatTimestamp(createdAt);
  const fileName = `gangsheet_${jobId}_${dpi}dpi_${stamp}.png`;
  const exportDir = path.join(process.cwd(), "uploads", "exports", "printers", printerId, jobId);
  await fs.promises.mkdir(exportDir, { recursive: true });
  const filePath = path.join(exportDir, fileName);

  const base = sharp({
    create: {
      width: widthPx,
      height: heightPx,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  const composites: sharp.OverlayOptions[] = [];
  const sourceResolutionErrors: string[] = [];
  for (const it of artboardItems) {
    const copies = Math.max(1, Number(it.copies || 1));
    const wIn = Math.max(0, Number(it.widthIn || 0));
    const hIn = Math.max(0, Number(it.heightIn || 0));
    if (!(wIn > 0) || !(hIn > 0)) continue;

    let srcUrl = String(it.croppedUrl || "");
    if (!srcUrl) {
      if (looksLikeUrlOrPath(it.assetId)) {
        srcUrl = String(it.assetId);
      } else if (isObjectIdString(it.assetId)) {
        const asset = await Asset.findById(it.assetId).select("url trimmedUrl").lean();
        srcUrl = String((asset as any)?.trimmedUrl || (asset as any)?.url || "");
      }
    }
    if (!srcUrl) continue;

    const buf = await loadImageBuffer(srcUrl);
    if (!buf) continue;

    const itemWidthPx = Math.round(wIn * dpi);
    const itemHeightPx = Math.round(hIn * dpi);
    const rotation = typeof it.rotation === "number" ? it.rotation : 0;

    const capacityCols = Math.max(1, Math.floor((widthIn + GROUP_GAP_IN) / Math.max(1e-6, wIn + GROUP_GAP_IN)));
    const cols = Math.max(1, Math.min(copies, capacityCols));

    for (let idx = 0; idx < copies; idx++) {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const xIn = Number(it.posX || 0) + col * (wIn + GROUP_GAP_IN);
      const yIn = Number(it.posY || 0) + row * (hIn + GROUP_GAP_IN);

      const centerXpx = Math.round((xIn + wIn / 2) * dpi);
      const centerYpx = Math.round((yIn + hIn / 2) * dpi);

      const srcMeta = await sharp(buf).metadata();
      if (
        (typeof srcMeta.width === "number" && srcMeta.width > 0 && srcMeta.width < itemWidthPx) ||
        (typeof srcMeta.height === "number" && srcMeta.height > 0 && srcMeta.height < itemHeightPx)
      ) {
        sourceResolutionErrors.push(`asset_${it.assetId}_insufficient_px`);
      }

    const prepared = await sharp(buf)
        .resize(itemWidthPx, itemHeightPx, { fit: "fill" })
        .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer({ resolveWithObject: true });

      const placedLeft = Math.round(centerXpx - prepared.info.width / 2);
      const placedTop = Math.round(centerYpx - prepared.info.height / 2);

      composites.push({
        input: prepared.data,
        left: placedLeft,
        top: placedTop,
      });
    }
  }

  const out = await base
    .composite(composites)
    .png({ compressionLevel: 0, adaptiveFiltering: false, palette: false, force: true })
    .withMetadata({ density: dpi, icc: "sRGB" as any })
    .toFile(filePath);

  const errors: string[] = [];
  const meta = await sharp(filePath).metadata();

  if (meta.format !== "png") errors.push("format_not_png");
  if (meta.width !== widthPx || meta.height !== heightPx) errors.push("pixel_dimensions_mismatch");
  if (!meta.hasAlpha) errors.push("alpha_missing");
  if (meta.channels !== 4) errors.push("not_rgba");
  if (typeof meta.density === "number" && Math.round(meta.density) !== dpi) errors.push("dpi_missing_or_incorrect");
  if (meta.space && String(meta.space).toLowerCase() !== "srgb") errors.push("colorspace_not_srgb");
  for (const e of sourceResolutionErrors) errors.push(e);

  const validation = {
    ok: errors.length === 0,
    errors,
    meta: {
      width: meta.width,
      height: meta.height,
      channels: meta.channels,
      density: meta.density,
      space: meta.space,
      hasAlpha: meta.hasAlpha,
      size: out.size,
    },
  };

  return {
    fileName,
    filePath,
    byteSize: out.size,
    dpi,
    sheet: { widthIn, heightIn },
    validation,
  };
};
