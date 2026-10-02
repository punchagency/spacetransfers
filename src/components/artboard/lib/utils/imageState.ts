import type { ArtboardItem } from "../../types";

export const uncroppedSourceOf = (item: Pick<ArtboardItem, "uncroppedUrl" | "originalUrl" | "url">) =>
  item.uncroppedUrl || item.originalUrl || item.url;

/**
 * The fields to write after an edit replaced the piece's pixels with `url`.
 *
 * The edited image becomes what is shown, what prints, and the new uncropped
 * source, so a later crop toggle works from the edit rather than from the
 * upload. Geometry is the caller's business: some edits reframe, some do not.
 */
export const afterPixelEdit = (url: string, widthPx: number, heightPx: number) => ({
  url,
  croppedUrl: url,
  croppedWidthPx: widthPx,
  croppedHeightPx: heightPx,
  nativeWidthPx: widthPx,
  uncroppedUrl: url,
  uncroppedWidthPx: widthPx,
  uncroppedHeightPx: heightPx,
});

/** Everything that describes a piece's image and its size — what an AI history entry restores. */
export type ImageSnapshot = Pick<
  ArtboardItem,
  | "url"
  | "croppedUrl"
  | "croppedWidthPx"
  | "croppedHeightPx"
  | "nativeWidthPx"
  | "uncroppedUrl"
  | "uncroppedWidthPx"
  | "uncroppedHeightPx"
  | "dpi"
  | "autoCrop"
  | "widthIn"
  | "heightIn"
>;

export const captureImageSnapshot = (item: ArtboardItem): ImageSnapshot => ({
  url: item.url,
  croppedUrl: item.croppedUrl,
  croppedWidthPx: item.croppedWidthPx,
  croppedHeightPx: item.croppedHeightPx,
  nativeWidthPx: item.nativeWidthPx,
  uncroppedUrl: item.uncroppedUrl,
  uncroppedWidthPx: item.uncroppedWidthPx,
  uncroppedHeightPx: item.uncroppedHeightPx,
  dpi: item.dpi,
  autoCrop: item.autoCrop,
  widthIn: item.widthIn,
  heightIn: item.heightIn,
});

export const restoreImageSnapshot = <T extends ArtboardItem>(item: T, snapshot: ImageSnapshot): T => ({
  ...item,
  ...snapshot,
  posX: item.posX + (item.widthIn - snapshot.widthIn) / 2,
  posY: Math.max(0, item.posY + (item.heightIn - snapshot.heightIn) / 2),
});
