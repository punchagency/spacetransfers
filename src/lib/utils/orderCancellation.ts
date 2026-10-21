/**
 * Cancelling an order from the customer's side. Before a print partner has the
 * order it is cancelled at once; after, the partner is asked and answers.
 */

export interface CancellationRequest {
  status: "PENDING" | "ACCEPTED" | "DECLINED";
  reason: string | null;
  requestedAt: string | null;
  respondedAt: string | null;
  declineReason: string | null;
}

export interface OrderCancellation {
  /** "now": cancelled straight away; "request": the partner is asked; null: not possible. */
  option: "now" | "request" | null;
  request: CancellationRequest | null;
}

/** What the dialog says for each way of cancelling. */
export const cancelCopy = (option: "now" | "request") =>
  option === "now"
    ? {
        title: "Cancel this order?",
        body: "It hasn't gone to a print partner yet, so it's cancelled straight away and you're refunded in full.",
        confirm: "Cancel order",
      }
    : {
        title: "Ask to cancel this order?",
        body: "Your print partner may already be working on it, so we'll ask them. If they agree, the order is cancelled and refunded in full. If it's too far along, they'll tell you why and it will ship as normal.",
        confirm: "Ask to cancel",
      };

/** The line shown on an order while a request is open or after it was declined. */
export const cancellationNote = (c: OrderCancellation | null | undefined) => {
  const r = c?.request;
  if (!r) return null;
  if (r.status === "PENDING") return { tone: "waiting" as const, text: "You asked to cancel this order. We're waiting for your print partner to answer." };
  if (r.status === "DECLINED") return { tone: "declined" as const, text: `It couldn't be cancelled: ${r.declineReason || "it was too far along."}` };
  return null;
};
