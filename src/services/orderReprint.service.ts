import { Order } from "../models/order.model.js";
import { nextOrderDisplayId } from "./orderNumber.service.js";
import { autoAssignOrder } from "./orderAssignment.service.js";

/**
 * A free replacement for an order that went wrong.
 *
 * It is a new order of the same sheets to the same address at no charge, so it
 * goes through production, shipping and partner pay like any other. Nothing is
 * taken from the customer; the business carries the print and the postage,
 * which is what its profit then shows.
 */

/** What the replacement is made of. Kept apart from saving it so it can be checked. */
export const buildReprintOrder = (original: any, actor: { id: string; name: string }, note: string, now = new Date()) => {
  const items = (Array.isArray(original?.items) ? original.items : []).map((item: any) => {
    const { _id, ...rest } = item;
    return rest;
  });
  const number = String(original?.displayId || original?._id || "");
  const quote = original?.shippingQuote ? { ...original.shippingQuote, chargedCost: 0 } : undefined;
  return {
    user: original.user,
    items,
    customer: original.customer,
    shippingAddress: original.shippingAddress,
    shippingMethod: original.shippingMethod,
    priority: original.priority,
    payment: { method: "card" as const },
    pricing: { subtotal: 0, rushSurcharge: 0, shippingCost: 0, tax: 0, total: 0, currency: String(original?.pricing?.currency || "USD") },
    shippingQuote: quote,
    reprintOf: { orderId: String(original._id), displayId: number },
    status: "PENDING" as const,
    statusTimeline: [
      {
        status: "PENDING",
        time: now,
        message: `Free reprint of ${number}${note ? `: ${note}` : ""}`,
        actorRole: "ADMIN",
        actorId: actor.id,
        actorName: actor.name,
      },
    ],
  };
};

export const reprintError = (original: any): string | null => {
  if (!Array.isArray(original?.items) || original.items.length === 0) return "This order has no sheets to reprint.";
  return null;
};

export const createReprintOrder = async (original: any, actor: { id: string; name: string }, note: string) => {
  const refusal = reprintError(original);
  if (refusal) throw Object.assign(new Error(refusal), { statusCode: 400 });

  const order = new Order({ ...buildReprintOrder(original, actor, note), displayId: await nextOrderDisplayId() });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await order.save();
      break;
    } catch (e: any) {
      const isDup = e?.code === 11000 && (e?.keyPattern?.displayId || e?.keyValue?.displayId);
      if (!isDup || attempt === 2) throw e;
      order.displayId = await nextOrderDisplayId();
    }
  }

  void autoAssignOrder(order.id).catch((err: any) => {
    console.warn(`[ORDER_ASSIGN] reprint orderId=${order.id} failed (non-fatal): ${err?.message}`);
  });

  return { orderId: String(order.id), displayId: String((order as any).displayId || order.id) };
};
