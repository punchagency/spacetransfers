/**
 * How an order is described to people outside the shop floor — the customer's
 * order history, their invoice, and the admin's copy of that invoice.
 *
 * These were written out separately in each place and had drifted: none listed
 * Express's rush fee or the admin's adjustments, so on an Express order (or one
 * with a discount) the lines did not add up to the total printed under them,
 * and the admin's invoice showed adjustments the customer's did not.
 */

/**
 * The customer-facing status. Deliberately coarser than the internal states: a
 * customer needs to know their sheet is being made, not whether it is on the
 * press or in quality check. Those two had no label, so the raw codes
 * ("QUALITY_CHECK") were shown in order history.
 */
export const customerOrderStatus = (status: unknown): string => {
  switch (String(status || "").toUpperCase()) {
    case "PENDING":
      return "Pending";
    case "PROCESSING":
    case "PRINTING":
    case "QUALITY_CHECK":
      return "Processing";
    case "SHIPPED":
      return "Shipped";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return "Processing";
  }
};

/** A sheet's size as people read it: `23.5" × 19.2"`, not `23.5" x 19.21333"`. */
export const formatSheetSize = (widthIn: unknown, heightIn: unknown): string | null => {
  const w = Number(widthIn);
  const h = Number(heightIn);
  if (!(w > 0) || !(h > 0)) return null;
  return `${w.toFixed(1)}" × ${h.toFixed(1)}"`;
};

export interface ChargeLine {
  label: string;
  amount: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Every charge on the order, in the order they are added up, so the lines sum
 * to `pricing.total`: subtotal, rush production (Express), shipping, tax, then
 * any admin adjustment (discounts and credits negative).
 */
export const orderChargeLines = (order: any): ChargeLine[] => {
  const pricing = order?.pricing || {};
  const express = String(order?.shippingMethod || "").toLowerCase() === "express";
  const lines: ChargeLine[] = [{ label: "Subtotal", amount: round2(Number(pricing.subtotal) || 0) }];
  const rush = Number(pricing.rushSurcharge) || 0;
  if (rush > 0) lines.push({ label: "Rush production", amount: round2(rush) });
  lines.push({
    label: express ? "Express shipping" : "Standard shipping",
    amount: round2(Number(pricing.shippingCost) || 0),
  });
  lines.push({ label: "Tax", amount: round2(Number(pricing.tax) || 0) });
  for (const adj of Array.isArray(pricing.adjustments) ? pricing.adjustments : []) {
    const type = String(adj?.type || "adjustment");
    const amount = Number(adj?.amount) || 0;
    const negative = type === "discount" || type === "credit";
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    lines.push({
      label: adj?.reason ? `${label} (${adj.reason})` : label,
      amount: round2(negative ? -amount : amount),
    });
  }
  return lines;
};
