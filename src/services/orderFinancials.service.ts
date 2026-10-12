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
  /** Returned to the customer, on a cancellation or as a refund on an order that stands. */
  refunded: number;
  /** Part of the payment kept back when the order was cancelled with a part refund. */
  keptOnCancel: number;
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
  /** Partners are paid once an order ships; until then profit is a forecast. A cancelled order's is final. */
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

/**
 * Whether an order's profit is final. A shipped order's is; so is a cancelled
 * one's — the refund is done and the card fee is what it cost.
 */
export const isOrderProfitSettled = (order: any): boolean =>
  String(order?.status || "").toUpperCase() === "CANCELLED" || isPartnerEarningRealized(order);

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
   * What was refunded is gone; what is left is the card fee, which Stripe keeps,
   * and whatever of the payment was deliberately kept back. On an order that
   * stands, a refund comes straight off the profit.
   */
  const cancelled = String(order?.status || "").toUpperCase() === "CANCELLED";
  const refunded = round2(num(order?.payment?.refundedAmount) ?? 0);

  const partnerPaidOnCancel = cancelled && order?.cancellation?.partnerPaid === true;

  // Only a card payment was ever really taken; an order without one kept nothing.
  const cardPaid = /^pi_/.test(String(order?.payment?.paymentIntentId || ""));
  const keptOnCancel = cancelled && cardPaid ? Math.max(0, round2(customerPaid - refunded)) : 0;

  const profit = cancelled
    ? round2(keptOnCancel - (processingFee ?? 0) - (partnerPaidOnCancel ? partnerCost ?? 0 : 0))
    : partnerCost === null
      ? null
      : round2(customerPaid - refunded - tax - shipping.cost - partnerCost - (processingFee ?? 0));

  return {
    customerPaid,
    cancelled,
    refunded,
    keptOnCancel,
    partnerPaidOnCancel,
    tax,
    shippingCharged,
    shippingCost: shipping.cost,
    shippingCostSource: shipping.source,
    partnerCost,
    processingFee: processingFee === null ? null : round2(processingFee),
    profit,
    profitRealized: isOrderProfitSettled(order),
    partnerBreakdown: breakdown ? { base: round2(breakdown.base), rushFee: round2(breakdown.rushFee) } : null,
  };
};
