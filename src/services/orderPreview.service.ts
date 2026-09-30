import { Order } from "../models/order.model.js";
import { exportGangsheetPng24, orderSheetWidthIn } from "./gangsheetExport.service.js";

/**
 * Renders a preview picture for every gang sheet on an order and stores each on
 * its own item (`items.<i>.previewImage`).
 *
 * Only the first sheet used to get one — the order was rendered with
 * `items.find(gangsheet)` and saved with the positional `items.$` — so every
 * later sheet on a multi-sheet order showed no picture anywhere. Failures are
 * logged per sheet and never fail the order.
 */
export const renderOrderSheetPreviews = async (
  orderId: string,
  items: any[],
  opts: { onlyMissing?: boolean } = {},
): Promise<number> => {
  let rendered = 0;
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item?.type !== "gangsheet" || !Array.isArray(item.artboardItems) || item.artboardItems.length === 0) continue;
    if (opts.onlyMissing && typeof item.previewImage === "string" && item.previewImage) continue;
    try {
      const out = await exportGangsheetPng24({
        // The sheet's own spacing and margin — without them the thumbnail laid
        // copies out on the export's fallback gap.
        itemSpacingIn: item.itemSpacingIn,
        sheetMarginIn: item.sheetMarginIn,
        jobId: String(orderId),
        printerId: "order-preview",
        // The roll this order was built on — see `orderSheetWidthIn`.
        sheetWidthIn: orderSheetWidthIn(item),
        sheetHeightIn: typeof item.sheetHeightIn === "number" ? item.sheetHeightIn : undefined,
        artboardItems: item.artboardItems.map((it: any) => ({
          assetId: String(it.assetId || ""),
          widthIn: Number(it.widthIn),
          heightIn: Number(it.heightIn),
          posX: Number(it.posX),
          posY: Number(it.posY),
          rotation: typeof it.rotation === "number" ? it.rotation : 0,
          flipped: Boolean(it.flipped),
          copies: typeof it.copies === "number" ? it.copies : 1,
          nestRotation: it.nestRotation,
          flowCols: it.flowCols,
        })),
        dpi: 600,
        cropToContent: true,
        format: "webp",
      });
      // Stored as a path, not a URL: the host is added when it is read (see
      // resolveApiFile), so the record survives a change of domain.
      await Order.updateOne({ _id: orderId }, { $set: { [`items.${i}.previewImage`]: out.relativePath } });
      rendered += 1;
    } catch (err: any) {
      console.warn(`[ORDER_THUMB] orderId=${orderId} sheet=${i} thumbnail failed (non-fatal): ${err?.message}`);
    }
  }
  return rendered;
};
