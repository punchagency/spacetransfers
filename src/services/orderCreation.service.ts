import {
  printedSheetExtentIn,
  printedSheetLengthIn,
} from "./gangsheetExport.service.js";
import { deriveItemUnitPrice, itemQuantity, type GlobalPricing } from "./pricing.service.js";

/**
 * The parts of placing an order that depend only on what was sent: checking
 * the request, and turning each cart line into the order item that is priced,
 * stored and printed. The handler (`createOrder`) does the rest: shipping,
 * payment verification, saving and the follow-ups.
 */

interface CustomError extends Error {
  statusCode?: number;
}

const roundToTwo = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Refuses a request that is missing anything an order needs. */
export const assertOrderRequest = ({
  items,
  customer,
  shippingAddress,
  shippingMethod,
  payment,
  pricing,
}: {
  items: any;
  customer: any;
  shippingAddress: any;
  shippingMethod: any;
  payment: any;
  pricing: any;
}): void => {
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
};

/**
 * One cart line as the order records it: placements normalised, the roll width
 * and overflow checked, the length billed at what will actually print, and the
 * price worked out here rather than taken from the request.
 */
export const buildOrderItem = (item: any, globalPricing: GlobalPricing) => {
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

  const positivePx = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);
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
          flipped: Boolean(it.flipped),
          copies: typeof it.copies === "number" ? it.copies : 1,
          linked: Boolean(it.linked),
          /*
           * The image's pixel size. Checkout sent these and they were dropped
           * here, so a reordered sheet couldn't work out its DPI and flagged
           * sharp artwork as "resolution couldn't be read", and the print
           * export never got the size of browser-edited images it asks for.
           */
          croppedWidthPx: positivePx(it.croppedWidthPx),
          croppedHeightPx: positivePx(it.croppedHeightPx),
          nativeWidthPx: positivePx(it.nativeWidthPx),
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

  const recordedSpacingIn =
    typeof itemSpacingIn === "number" && itemSpacingIn >= 0 && itemSpacingIn <= 6 ? itemSpacingIn : undefined;
  const recordedMarginIn =
    typeof sheetMarginIn === "number" && sheetMarginIn >= 0 && sheetMarginIn <= 2 ? sheetMarginIn : undefined;

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
};
