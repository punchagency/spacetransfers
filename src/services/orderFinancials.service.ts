import {
  canDerivePartnerEarning,
  getOrderPartnerCostBreakdown,
  isPartnerEarningRealized,
} from "./partnerEarnings.service.js";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type ShippingCostSource = "label" | "quote" | "at-cost";

export interface OrderFinancials {
  customerPaid: number;
  cancelled: boolean;
  /** Returned to the customer when the order was cancelled. */
  refunded: number;
  /** The order was cancelled but the partner is paid for the work they had started. */
  partnerPaidOnCancel: boolean;
  /** Collected for the state; not the business's money. */
  tax: number;
  shippingCharged: number;
  /** What shipping costs the business. */
  shippingCost: number;
  shippingCostSource: ShippingCostSource;
  partnerCost: number | null;
  /** Stripe's fee; null when it was never recorded for this order. */
  processingFee: number | null;
  /** Null when there is no partner cost to derive it from. */
  profit: number | null;
  /** Partners are paid once an order ships; until then profit is a forecast. */
  profitRealized: boolean;
  /** Pieces of the partner cost, for the order page. */
  partnerBreakdown: { base: number; rushFee: number } | null;
}

export const orderShippingCost = (order: any): { cost: number; source: ShippingCostSource } => {
  const label = num(order?.shipStationLabelCost);
  if (label !== null && label > 0) return { cost: round2(label), source: "label" };
  const quote = num(order?.shippingQuote?.carrierCost);
  if (quote !== null && quote > 0) return { cost: round2(quote), source: "quote" };
  return { cost: round2(num(order?.pricing?.shippingCost) ?? 0), source: "at-cost" };
};

export const computeOrderFinancials = (order: any, partnerPayRate: any): OrderFinancials => {
  const pricing = order?.pricing || {};
  const customerPaid = round2(num(pricing.total) ?? 0);
  const tax = round2(num(pricing.tax) ?? 0);
  const shippingCharged = round2(num(pricing.shippingCost) ?? 0);
  const shipping = orderShippingCost(order);
  const processingFee = num(order?.payment?.processingFee);

  const derivable = canDerivePartnerEarning(order);
  const breakdown = derivable ? getOrderPartnerCostBreakdown(order, partnerPayRate) : null;
  const partnerCost = breakdown ? round2(breakdown.subtotal) : null;

  /*
   * A cancelled order is not printed or shipped and its partner is not paid.
   * What was refunded is gone; what is left is the card fee, which Stripe keeps.
   */
  const cancelled = String(order?.status || "").toUpperCase() === "CANCELLED";
  const refunded = round2(num(order?.payment?.refundedAmount) ?? 0);

  const partnerPaidOnCancel = cancelled && order?.cancellation?.partnerPaid === true;

  const profit = cancelled
    ? round2(-(processingFee ?? 0) - (partnerPaidOnCancel ? partnerCost ?? 0 : 0))
    : partnerCost === null
      ? null
      : round2(customerPaid - tax - shipping.cost - partnerCost - (processingFee ?? 0));

  return {
    customerPaid,
    cancelled,
    refunded,
    partnerPaidOnCancel,
    tax,
    shippingCharged,
    shippingCost: shipping.cost,
    shippingCostSource: shipping.source,
    partnerCost,
    processingFee: processingFee === null ? null : round2(processingFee),
    profit,
    profitRealized: isPartnerEarningRealized(order),
    partnerBreakdown: breakdown ? { base: round2(breakdown.base), rushFee: round2(breakdown.rushFee) } : null,
  };
};
