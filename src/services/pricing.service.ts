import { Settings } from "../models/settings.model.js";
import { predictShippingOrigin } from "./orderAssignment.service.js";
import {
  DEFAULT_PACKAGING_PROFILE,
  normalizePackagingProfile,
  type PackagingProfile,
} from "./packaging.service.js";
import {
  quoteShipping,
  type ShippingDestination,
  type ShippingMarkupPct,
  type ShippingQuote,
} from "./shipping.service.js";

/**
 * Single source of truth for what a customer is charged.
 *
 * Before this existed, five places computed an order's money and none of them
 * agreed. On a $100 express order the cart showed $119.99, Stripe charged
 * $132.99, and the saved order recorded $119.99 — so the customer saw one
 * number, paid another, and the record matched neither.
 *
 * Rates live in the `global_pricing` settings document, which the admin console
 * edits under Settings → General. Everything that touches money reads them from
 * here: the cart quote, the Stripe PaymentIntent, and the order that gets
 * saved. Changing a rate is an admin action, not a deploy.
 */

export interface GlobalPricing {
  baseRatePerSqFt: number;
  /**
   * The roll width every gang sheet is cut from, and the shortest length that
   * can be billed.
   *
   * A gang sheet consumes the full width of the roll whatever the artwork does,
   * and a run below the minimum length costs the same to set up as one at it.
   * Neither was implemented: price came from the bounding box of the artwork, so
   * a single 6x10in graphic on a 23.5in roll was billed 0.42 sq ft ($1.47)
   * instead of the 1.63 sq ft ($5.71) of roll it actually consumes — a four-fold
   * undercharge that grew worse the sparser the sheet.
   */
  sheetWidthIn: number;
  minSheetLengthIn: number;
  /**
   * The flat rates are no longer what a customer pays. They are the fallback
   * used when the carrier cannot be reached — see `shipping.service`.
   */
  shipping: { standard: number; express: number };
  shippingMarkupPct: ShippingMarkupPct;
  /**
   * Charged to the customer on a rush order, as a percentage of the subtotal.
   *
   * Separate from express shipping, which is a carrier pass-through: paying a
   * courier to move the parcel faster does nothing to move the job up a
   * partner's queue, and none of that premium reaches your margin. Rushing
   * *production* costs the partner's `rushPct`, and this is what covers it.
   */
  rushSurchargePct: number;
  /**
   * The rate every partner is paid at. Read through `getPartnerPayRate`.
   *
   * Named "defaults" because it began as the starting rate for a new partner
   * while each could still carry their own. Per-partner pricing has since been
   * removed — there is one rate for the whole network — so this is now the rate
   * itself rather than a default. Kept under this key so stored settings
   * documents do not need migrating.
   */
  partnerDefaults: {
    baseRatePerSqFt: number;
    rushPct: number;
    specialInkFlat: number;
  };
  packaging: PackagingProfile;
  taxRatePct: number;
}

/**
 * Used when the settings document does not exist yet. Mirrors the fallback the
 * admin `getGlobalPricing` endpoint returns, so a fresh install and a
 * configured one behave identically.
 */
export const DEFAULT_GLOBAL_PRICING: GlobalPricing = {
  /**
   * 3.50, because that is what the storefront has actually been charging.
   *
   * This default read 24.00 while nothing consumed it — the editor priced from
   * its own compiled constant of 3.50. Now that the field is authoritative,
   * a fresh install must start at the rate customers were really paying;
   * seeding 24.00 would have made deploying this a sevenfold price rise.
   */
  baseRatePerSqFt: 3.5,
  // The physical roll, and the shortest run worth setting up. Editable by an
  // admin like every other rate here, rather than compiled in.
  sheetWidthIn: 23.5,
  minSheetLengthIn: 10,
  shipping: { standard: 8.99, express: 24.99 },
  // A starting point, not a considered figure. Set it once a real parcel has
  // been costed — on a $9 parcel this recovers 90c, which will not cover a tube.
  shippingMarkupPct: 10,
  // Sized against the partner side: their rush is 10% of partner cost, and
  // partner cost runs well under the subtotal, so 10% of subtotal covers it
  // with room. Tune once real rush jobs have been costed.
  rushSurchargePct: 10,
  // The values that were previously hard-coded, so nothing moves by adopting
  // this — it only becomes visible and editable.
  partnerDefaults: { baseRatePerSqFt: 2.5, rushPct: 10, specialInkFlat: 5 },
  packaging: DEFAULT_PACKAGING_PROFILE,
  taxRatePct: 8.0,
};

const roundToTwo = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Absent-or-junk becomes the fallback; an explicit 0 is kept, because free
 * shipping and a 0% tax rate are both legitimate settings.
 *
 * The null and empty-string cases are why this is not just `Number(value)`:
 * both coerce to 0, which is finite and non-negative, so the fallback never
 * fired and the rate silently became zero. That was harmless while nothing
 * read `baseRatePerSqFt`; now that it prices every sheet, clearing the field
 * in the admin form would have made every gang sheet free.
 */
/**
 * Bounds on the roll width. Nothing stopped 0 — which prices every sheet at
 * nothing and leaves the artboard no width — or a typo like 235.
 */
export const MIN_ROLL_WIDTH_IN = 6;
export const MAX_ROLL_WIDTH_IN = 64;

/** Why a roll width cannot be saved, or null when it can. */
export const rollWidthError = (value: unknown): string | null => {
  const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(n) && n >= MIN_ROLL_WIDTH_IN && n <= MAX_ROLL_WIDTH_IN
    ? null
    : `Roll width must be between ${MIN_ROLL_WIDTH_IN} and ${MAX_ROLL_WIDTH_IN} inches.`;
};

const finiteOr = (value: unknown, fallback: number): number => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * Coerces a stored settings value into usable rates, falling back
 * field-by-field rather than all-or-nothing: a settings document saved with one
 * bad value should not silently discard the operator's other three.
 *
 * Separate from the read so it can be exercised without a database.
 */
export const normalizeGlobalPricing = (value: unknown): GlobalPricing => {
  const v = (value as any) || {};
  return {
    baseRatePerSqFt: finiteOr(v.baseRatePerSqFt, DEFAULT_GLOBAL_PRICING.baseRatePerSqFt),
    sheetWidthIn: finiteOr(v.sheetWidthIn, DEFAULT_GLOBAL_PRICING.sheetWidthIn),
    minSheetLengthIn: finiteOr(v.minSheetLengthIn, DEFAULT_GLOBAL_PRICING.minSheetLengthIn),
    shipping: {
      standard: finiteOr(v.shipping?.standard, DEFAULT_GLOBAL_PRICING.shipping.standard),
      express: finiteOr(v.shipping?.express, DEFAULT_GLOBAL_PRICING.shipping.express),
    },
    shippingMarkupPct: finiteOr(
      v.shippingMarkupPct,
      DEFAULT_GLOBAL_PRICING.shippingMarkupPct,
    ),
    rushSurchargePct: finiteOr(
      v.rushSurchargePct,
      DEFAULT_GLOBAL_PRICING.rushSurchargePct,
    ),
    partnerDefaults: {
      baseRatePerSqFt: finiteOr(
        v.partnerDefaults?.baseRatePerSqFt,
        DEFAULT_GLOBAL_PRICING.partnerDefaults.baseRatePerSqFt,
      ),
      rushPct: finiteOr(v.partnerDefaults?.rushPct, DEFAULT_GLOBAL_PRICING.partnerDefaults.rushPct),
      specialInkFlat: finiteOr(
        v.partnerDefaults?.specialInkFlat,
        DEFAULT_GLOBAL_PRICING.partnerDefaults.specialInkFlat,
      ),
    },
    packaging: normalizePackagingProfile(v.packaging),
    taxRatePct: finiteOr(v.taxRatePct, DEFAULT_GLOBAL_PRICING.taxRatePct),
  };
};

/**
 * The rate every partner is paid at.
 *
 * There is one rate for the whole network, set by the admin. Partners used to
 * carry their own `settings.pricing`, so the same sheet cost a different amount
 * depending on who printed it and the console had no single number to show —
 * and nothing stopped a partner-level rate drifting above the retail rate.
 *
 * Returns the same shape the per-partner object had, so the cost breakdown is
 * unchanged: it still receives a pricing object, it just always receives this
 * one.
 */
export const getPartnerPayRate = async (): Promise<{
  baseRatePerSqFt: number;
  tiered: never[];
  surcharges: { rushPct: number; specialInkFlat: number };
}> => {
  const { partnerDefaults } = await getGlobalPricing();
  return {
    baseRatePerSqFt: partnerDefaults.baseRatePerSqFt,
    tiered: [],
    surcharges: {
      rushPct: partnerDefaults.rushPct,
      specialInkFlat: partnerDefaults.specialInkFlat,
    },
  };
};

/** Reads the configured rates from the settings document. */
export const getGlobalPricing = async (): Promise<GlobalPricing> => {
  const doc = await Settings.findOne({ key: "global_pricing" }).lean();
  return normalizeGlobalPricing((doc as any)?.value);
};

export type ShippingMethod = "standard" | "express";

/**
 * Express shipping means the customer asked for this order to be hurried, so it
 * is what sets production priority.
 *
 * The checkout has always promised "priority handling" on the express option
 * and charged for it, while `order.priority` was only ever set by an admin at
 * assignment — so the promise was sold and never kept.
 */
export const priorityForShippingMethod = (method: unknown): "NORMAL" | "URGENT" =>
  normalizeShippingMethod(method) === "express" ? "URGENT" : "NORMAL";

export const isUrgentPriority = (priority: unknown): boolean =>
  String(priority ?? "").trim().toUpperCase() === "URGENT";

export const normalizeShippingMethod = (method: unknown): ShippingMethod =>
  String(method || "").toLowerCase() === "express" ? "express" : "standard";

export interface OrderTotals {
  subtotal: number;
  /** Zero unless the order is URGENT. */
  rushSurcharge: number;
  shippingCost: number;
  tax: number;
  total: number;
  currency: "USD";
}

/**
 * The arithmetic, kept pure so it can be unit-tested and so the quote, the
 * charge and the saved order provably produce the same numbers from the same
 * inputs.
 *
 * Tax is applied to the subtotal only, not to shipping, and is not conditioned
 * on the destination country. The previous quote path taxed only when the
 * country string was exactly "United States" — so a client sending "US" got
 * zero tax — while the charge path taxed unconditionally. Since fulfilment is
 * US-only (ShipStation rejects non-US addresses outright), taxing
 * unconditionally is both simpler and the behaviour that was already being
 * charged.
 */
export const computeTotals = ({
  subtotal,
  shippingMethod,
  pricing,
  shippingCost: quotedShipping,
  priority,
}: {
  subtotal: number;
  shippingMethod: unknown;
  pricing: GlobalPricing;
  /** URGENT adds the rush surcharge. Anything else is treated as normal. */
  priority?: unknown;
  /**
   * The live carrier quote, where one could be obtained. Omitted, the
   * configured flat rate stands in — which is now a fallback rather than the
   * price, so callers that can reach the carrier should always pass this.
   */
  shippingCost?: number;
}): OrderTotals => {
  const safeSubtotal = roundToTwo(Math.max(0, finiteOr(subtotal, 0)));
  const method = normalizeShippingMethod(shippingMethod);
  const shippingCost = roundToTwo(
    quotedShipping === undefined ? pricing.shipping[method] : finiteOr(quotedShipping, pricing.shipping[method]),
  );
  const rushSurcharge = isUrgentPriority(priority)
    ? roundToTwo(safeSubtotal * (pricing.rushSurchargePct / 100))
    : 0;

  // Taxed with the subtotal, not with shipping: rushing production is part of
  // the goods-and-services charge, and shipping is excluded from the tax base.
  const tax = roundToTwo((safeSubtotal + rushSurcharge) * (pricing.taxRatePct / 100));
  const total = roundToTwo(safeSubtotal + rushSurcharge + shippingCost + tax);
  return { subtotal: safeSubtotal, rushSurcharge, shippingCost, tax, total, currency: "USD" };
};

/**
 * The area a gang sheet is billed on: width x height in square feet, to two
 * decimals.
 *
 * Two decimals because that is the area the editor shows and the customer
 * agrees to — "11.00 sq ft x $3.50 = $38.50". Billing the unrounded
 * 11.002018 sq ft would charge $38.51 for a sheet the cart said was $38.50.
 *
 * Deliberately unlike the partner-cost side, which prices exact area: there is
 * no displayed figure there, so rounding would only lose accuracy. Here the
 * displayed figure is the agreement.
 */
export const billableAreaSqFt = (widthIn: unknown, heightIn: unknown): number | null => {
  const w = Number(widthIn);
  const h = Number(heightIn);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return roundToTwo((w * h) / 144);
};

/**
 * The area a gang sheet is billed on, as opposed to the area its artwork covers.
 *
 * Width is the roll — artwork occupying 6in of a 23.5in roll still consumes the
 * whole width — and length is floored at the configured minimum. `heightIn` is
 * still read from the item because the length genuinely varies; the width is not,
 * so a client understating it cannot buy a cheaper sheet.
 */
export const billableSheetArea = (
  heightIn: unknown,
  pricing: GlobalPricing,
): number | null => {
  const h = Number(heightIn);
  if (!Number.isFinite(h) || h <= 0) return null;
  const billedLength = Math.max(h, pricing.minSheetLengthIn);
  return roundToTwo((pricing.sheetWidthIn * billedLength) / 144);
};

/** What a gang sheet of a given area costs at the configured retail rate. */
export const sheetUnitPrice = (areaSqFt: number, pricing: GlobalPricing): number =>
  roundToTwo(roundToTwo(finiteOr(areaSqFt, 0)) * pricing.baseRatePerSqFt);

const badRequest = (message: string) => {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 400;
  return error;
};

/**
 * The price of one line, derived from what will physically be produced.
 *
 * The client's `unitPrice` is not consulted. It used to be the only input, and
 * it is a free-floating number attached to nothing — a request could name its
 * own subtotal and both the Stripe charge and the saved order would honour it.
 * Area cannot be lied about profitably in the same way: the dimensions that set
 * the price are the dimensions the partner prints to, so understating them
 * buys a smaller sheet rather than a cheaper one.
 */
export const deriveItemUnitPrice = (item: unknown, pricing: GlobalPricing): number => {
  const it = (item as any) || {};
  const type = String(it.type || "gangsheet").toLowerCase();

  if (type !== "gangsheet") {
    throw badRequest(`Unsupported item type: ${String(it.type)}`);
  }

  // Billed on the roll, with a minimum length — not on the artwork's bounds.
  const areaSqFt = billableSheetArea(it.heightIn, pricing);
  if (areaSqFt == null) {
    // Not a fallback to the client's figure: a sheet with no positive length
    // has nothing to print and no basis for a price. Accepting one at the
    // client's `unitPrice` is how a zero-area order could be placed for the
    // price of shipping alone.
    throw badRequest("Each gang sheet requires a positive heightIn");
  }

  return sheetUnitPrice(areaSqFt, pricing);
};

/** Quantity as a whole number of sheets, at least one. */
export const itemQuantity = (item: unknown): number => {
  const it = (item as any) || {};
  return Math.max(1, Math.floor(finiteOr(it.quantity ?? it.copies, 1)));
};

/**
 * Subtotal for a list of line items, priced server-side from each item's
 * dimensions rather than from the prices the caller supplied.
 */
export const computeSubtotal = (items: unknown[], pricing: GlobalPricing): number =>
  roundToTwo(
    (Array.isArray(items) ? items : []).reduce(
      (sum: number, it: any) => sum + itemQuantity(it) * deriveItemUnitPrice(it, pricing),
      0,
    ),
  );

/**
 * Load the configured rates, quote the carrier, and price a set of items.
 *
 * `destination` is what makes a live rate possible. Without it the flat
 * fallback is used, which is why the Stripe intent must be given the address
 * the checkout already collected — otherwise the intent and the saved order
 * would be built from different shipping numbers.
 */
export const priceItems = async (
  items: unknown[],
  shippingMethod: unknown,
  destination?: ShippingDestination | null,
): Promise<OrderTotals & { shipping: ShippingQuote }> => {
  // Priority is derived, not passed: it follows the shipping method, so the
  // intent cannot disagree with the order about whether a rush was charged.
  const pricing = await getGlobalPricing();
  const subtotal = computeSubtotal(items, pricing);
  const method = normalizeShippingMethod(shippingMethod);

  const shipping = await quoteShipping({
    totalSqFt: totalBillableSqFt(items, pricing),
    method,
    destination: destination ?? null,
    packaging: pricing.packaging,
    markupPct: pricing.shippingMarkupPct,
    fallbackRates: pricing.shipping,
    origin: destination?.state
      ? await predictShippingOrigin(destination.state).catch(() => null)
      : null,
  });

  return {
    ...computeTotals({
      subtotal,
      shippingMethod: method,
      pricing,
      shippingCost: shipping.cost,
      priority: priorityForShippingMethod(method),
    }),
    shipping,
  };
};

/** Total billed area across a set of line items — what the parcel is sized from. */
/**
 * The area a shipment is packed for.
 *
 * This measured the artwork's bounding box, so a sparse sheet was parcelled as
 * though only the printed part travelled. What actually ships is the roll — full
 * width, minimum length — so a 6x10in graphic was being packed as 0.42 sq ft of
 * film when 1.63 sq ft of roll goes in the tube. Under-declaring weight and size
 * is what gets charged back by the carrier.
 *
 * Same rule as the price, from the same settings, so the parcel and the invoice
 * describe the same object.
 */
export const totalBillableSqFt = (items: unknown[], pricing?: GlobalPricing): number =>
  (Array.isArray(items) ? items : []).reduce((sum: number, it: any) => {
    const area = pricing
      ? billableSheetArea(it?.heightIn, pricing)
      : billableAreaSqFt(it?.widthIn, it?.heightIn);
    return area == null ? sum : sum + area * itemQuantity(it);
  }, 0);
