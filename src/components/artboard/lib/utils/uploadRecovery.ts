/**
 * Bringing a board item up to date once its upload finally succeeds.
 *
 * The item was placed from the customer's own file, so everything it points at
 * is local to this browser. This swaps those for what the server stored, and
 * leaves alone whatever the customer did to the piece in the meantime: where
 * it sits, its width, its copies, its rotation — and its picture, if they
 * edited it.
 */
type Item = Record<string, any>;

/** Anything that exists only in this browser. */
const isLocalOnly = (value: unknown) => typeof value === "string" && value.startsWith("blob:");

/** Whether an item still depends on a file that never uploaded. */
export const isNotUploaded = (item: Item | null | undefined): boolean =>
  Boolean(item) &&
  [item!.url, item!.croppedUrl, item!.uncroppedUrl, item!.originalUrl, item!.assetId].some(isLocalOnly);

export const applyUploadedAsset = <T extends Item>(item: T, asset: Item, placedUrl: string): T => {
  const serverUrl = String(asset?.url || "");
  if (!serverUrl) return item;

  const sources = {
    assetId: asset.id,
    originalUrl: serverUrl,
    uncroppedUrl: serverUrl,
    uncroppedWidthPx: asset.widthPx,
    uncroppedHeightPx: asset.heightPx,
    uploadFailed: false,
  };

  // Edited since it was placed (background removed, recoloured…): the edit is
  // the picture now. Only what it was made from changes.
  if (item.url !== placedUrl) return { ...item, ...sources };

  const trimmed = item.autoCrop !== false && asset.trimmedUrl ? String(asset.trimmedUrl) : null;
  const widthPx = Number(trimmed ? asset.trimmedWidthPx : asset.widthPx) || 0;
  const heightPx = Number(trimmed ? asset.trimmedHeightPx : asset.heightPx) || 0;
  const display = trimmed || serverUrl;

  /*
   * The server's crop can differ from the browser's by a pixel or two. The
   * piece keeps the scale the customer left it at — the same pixels to the
   * inch — so it is neither stretched nor nudged under 300 DPI by a rounding
   * difference, and stays centred where it was. At a quarter turn the two
   * axes are swapped.
   */
  const oddQuarter = ((Math.round((item.rotation || 0) / 90) % 2) + 2) % 2 === 1;
  const alongWidthIn = oddQuarter ? item.heightIn : item.widthIn;
  const pxPerIn = Number(item.nativeWidthPx) > 0 && alongWidthIn > 0 ? item.nativeWidthPx / alongWidthIn : 0;
  let size: Record<string, number> = {};
  if (widthPx > 0 && heightPx > 0 && pxPerIn > 0) {
    const w = widthPx / pxPerIn;
    const h = heightPx / pxPerIn;
    const widthIn = oddQuarter ? h : w;
    const heightIn = oddQuarter ? w : h;
    size = {
      widthIn,
      heightIn,
      posX: item.posX + (item.widthIn - widthIn) / 2,
      posY: Math.max(0, item.posY + (item.heightIn - heightIn) / 2),
    };
  }

  return {
    ...item,
    ...sources,
    ...size,
    url: display,
    croppedUrl: display,
    croppedWidthPx: undefined,
    croppedHeightPx: undefined,
    nativeWidthPx: widthPx || item.nativeWidthPx,
  };
};
