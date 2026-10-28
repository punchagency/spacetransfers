import mongoose from "mongoose";
import { Asset } from "../models/asset.model.js";
import { GROUP_GAP_IN, computeRotatedBounds, orderSheetWidthIn, resolvePlacement } from "./gangsheetExport.service.js";
import { publicUrlForKey, storedKeyFor, thumbKeyFor } from "./storage.service.js";

/**
 * The designs on an order's sheets, as people pick them: drawn where they
 * print, so a customer can point at the ones that came out wrong and an admin
 * can reprint just those. Positions come from the export's own placement
 * arithmetic, so the picture matches the print.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const isObjectId = (v: unknown) => typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v);
const looksLikeUrl = (v: unknown) => typeof v === "string" && (/^https?:\/\//.test(v) || v.startsWith("/"));

const spacingOf = (item: any) => ({
  gapIn: typeof item?.itemSpacingIn === "number" && item.itemSpacingIn >= 0 ? item.itemSpacingIn : GROUP_GAP_IN,
  marginIn: typeof item?.sheetMarginIn === "number" && item.sheetMarginIn >= 0 ? item.sheetMarginIn : 0,
});

export interface SheetDesign {
  /** Its place in the sheet's artboard items. */
  index: number;
  name: string;
  imageUrl: string | null;
  /** The small copy stored beside an upload, for drawing the sheet; the full image when there is none. */
  thumbUrl: string | null;
  copies: number;
  /** The image before it is turned, and how it is turned and flipped when printed. */
  imageW: number;
  imageH: number;
  rotation: number;
  flipped: boolean;
  /** The centre of every copy, in sheet inches. */
  centers: { x: number; y: number }[];
  /** The size of one copy as printed. */
  widthIn: number;
  heightIn: number;
}

export interface SheetDesignsView {
  index: number;
  name: string;
  widthIn: number;
  heightIn: number;
  designs: SheetDesign[];
}

/** The 200px thumbnail every stored upload has beside it, or null for anything stored elsewhere. */
export const thumbOf = (url: string | null): string | null => {
  const key = url ? storedKeyFor(url) : null;
  return key ? publicUrlForKey(thumbKeyFor(key)) : null;
};

/** Every design on one sheet, laid out as it prints. */
export const describeSheet = (
  item: any,
  index: number,
  imageOf: (artboardItem: any) => string | null,
  names: Map<string, string> = new Map(),
): SheetDesignsView => {
  const widthIn = orderSheetWidthIn(item);
  const { gapIn, marginIn } = spacingOf(item);
  const effective = widthIn - 2 * marginIn;
  let bottom = 0;
  const designs: SheetDesign[] = (Array.isArray(item?.artboardItems) ? item.artboardItems : []).map((it: any, i: number) => {
    const p = resolvePlacement(it, effective, gapIn);
    const drawn = computeRotatedBounds(p.imageW, p.imageH, p.totalRotation);
    const centers: { x: number; y: number }[] = [];
    for (let c = 0; c < p.copies; c++) {
      const x = Number(it.posX || 0) + (c % p.cols) * (p.cellW + gapIn) + p.cellW / 2;
      const y = Number(it.posY || 0) + Math.floor(c / p.cols) * (p.cellH + gapIn) + p.cellH / 2;
      centers.push({ x: round2(x), y: round2(y) });
      bottom = Math.max(bottom, y + drawn.hIn / 2);
    }
    const asset = String(it.assetId || "");
    return {
      index: i,
      name: names.get(asset) || `Design ${i + 1}`,
      imageUrl: imageOf(it),
      thumbUrl: thumbOf(imageOf(it)),
      copies: p.copies,
      imageW: p.imageW,
      imageH: p.imageH,
      rotation: p.totalRotation,
      flipped: Boolean(it.flipped),
      centers,
      widthIn: round2(drawn.wIn),
      heightIn: round2(drawn.hIn),
    };
  });
  return {
    index,
    name: String(item?.name || `Sheet ${index + 1}`),
    widthIn,
    heightIn: round2(Math.max(bottom + marginIn, 1)),
    designs,
  };
};

/** Every sheet on an order with its designs, images resolved as the print resolves them. */
export const describeOrderDesigns = async (order: any, resolveFile: (v: unknown) => string | null): Promise<SheetDesignsView[]> => {
  // Indexed by place in the order's items, which is how picks name a sheet.
  const items: any[] = Array.isArray(order?.items) ? order.items : [];
  const sheets = items.filter((it) => Array.isArray(it?.artboardItems) && it.artboardItems.length > 0);
  const assetIds = [
    ...new Set(sheets.flatMap((s: any) => (s.artboardItems || []).map((it: any) => String(it.assetId || "")).filter(isObjectId))),
  ];
  const assets: any[] = assetIds.length
    ? await Asset.find({ _id: { $in: assetIds.map((id) => new mongoose.Types.ObjectId(id)) } }).select("url trimmedUrl originalFilename").lean()
    : [];
  const byId = new Map(assets.map((a) => [String(a._id), a]));
  const names = new Map(assets.filter((a) => a.originalFilename).map((a) => [String(a._id), String(a.originalFilename)]));
  const imageOf = (it: any) => {
    const asset = byId.get(String(it.assetId || ""));
    const raw = it.croppedUrl || (looksLikeUrl(it.assetId) ? it.assetId : asset?.trimmedUrl || asset?.url || "");
    return raw ? resolveFile(raw) : null;
  };
  return sheets.map((sheet: any) => describeSheet(sheet, items.indexOf(sheet), imageOf, names));
};

/** A design and how many of its copies. */
export interface DesignPick {
  design: number;
  copies: number;
}

/**
 * A new sheet holding only the chosen designs, packed in rows from the top so
 * it is no longer than it needs to be. Each keeps its size, turn and flip; its
 * copies wrap into the columns that fit, written down so the print agrees.
 */
export const packDesigns = (item: any, picks: DesignPick[]) => {
  const all: any[] = Array.isArray(item?.artboardItems) ? item.artboardItems : [];
  const widthIn = orderSheetWidthIn(item);
  const { gapIn, marginIn } = spacingOf(item);
  const effective = widthIn - 2 * marginIn;
  const ordered = [...picks].sort((a, b) => {
    const ia = all[a.design];
    const ib = all[b.design];
    return Number(ia.posY) - Number(ib.posY) || Number(ia.posX) - Number(ib.posX);
  });

  let x = marginIn;
  let y = marginIn;
  let shelf = 0;
  const placed = ordered.map(({ design, copies }) => {
    const { _id, ...it } = all[design];
    const p = resolvePlacement({ ...it, copies, flowCols: undefined }, effective, gapIn);
    const rows = Math.ceil(p.copies / p.cols);
    const blockW = p.cols * p.cellW + (p.cols - 1) * gapIn;
    const blockH = rows * p.cellH + (rows - 1) * gapIn;
    // A turn that isn't a quarter draws past its cell; leave room for it.
    const drawn = computeRotatedBounds(p.imageW, p.imageH, p.totalRotation);
    const padX = Math.max(0, (drawn.wIn - p.cellW) / 2);
    const padY = Math.max(0, (drawn.hIn - p.cellH) / 2);
    const footW = blockW + 2 * padX;
    const footH = blockH + 2 * padY;
    if (x > marginIn && x + footW > widthIn - marginIn + 1e-6) {
      y += shelf + gapIn;
      x = marginIn;
      shelf = 0;
    }
    const out = { ...it, copies: p.copies, flowCols: p.cols, posX: round2(x + padX), posY: round2(y + padY) };
    x += footW + gapIn;
    shelf = Math.max(shelf, footH);
    return out;
  });
  return { artboardItems: placed, sheetHeightIn: Math.ceil((y + shelf + marginIn) * 100) / 100 };
};

/**
 * Checks a choice of designs against the order: real sheets and designs, each
 * once, and no more copies than were printed. Returns them grouped by sheet.
 */
export const groupDesignPicks = (items: any[], picks: unknown): Map<number, DesignPick[]> => {
  const fail = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
  if (!Array.isArray(picks) || picks.length === 0) throw fail("Choose at least one design to reprint.");
  const bySheet = new Map<number, DesignPick[]>();
  const seen = new Set<string>();
  for (const pick of picks as any[]) {
    const sheet = Number(pick?.sheet);
    const design = Number(pick?.design);
    const item = Number.isInteger(sheet) ? items[sheet] : undefined;
    const art = item && Number.isInteger(design) ? (item.artboardItems || [])[design] : undefined;
    if (!art || seen.has(`${sheet}:${design}`)) throw fail("One of the chosen designs isn't on this order.");
    seen.add(`${sheet}:${design}`);
    const most = Math.max(1, Math.floor(Number(art.copies) || 1));
    const copies = pick?.copies === undefined ? most : Number(pick.copies);
    if (!Number.isInteger(copies) || copies < 1 || copies > most) throw fail(`Reprint between 1 and ${most} copies of that design.`);
    bySheet.set(sheet, [...(bySheet.get(sheet) || []), { design, copies }]);
  }
  return bySheet;
};
