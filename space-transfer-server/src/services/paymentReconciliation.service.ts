import { Order } from "../models/order.model.js";
import { User } from "../models/user.model.js";
import { notifyAllAdmins } from "./adminNotifications.service.js";
import { isStripeConfigured, stripe } from "./stripe.service.js";
import { reportJobError } from "./monitoring.service.js";

/**
 * Catches a customer charged with no order to show for it.
 *
 * Checkout takes the payment first and saves the order second. If the browser
 * closes between the two, or saving is refused after the charge, the money is
 * taken and nothing records why. This compares recent successful payments with
 * orders and tells the admins about any that have none, once each.
 */

/** Long enough for checkout to save the order after the card succeeds. */
export const GRACE_MS = 10 * 60 * 1000;
/** How far back each pass looks. */
export const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
const ALERTED_KEY = "unmatchedAlertedAt";

export interface IntentSummary {
  id: string;
  status: string;
  amount: number;
  currency: string;
  created: number;
  metadata: Record<string, string>;
}

/**
 * The payments that need an admin: succeeded, made by our checkout (it stamps
 * `userId`), old enough that the order should exist, with no order and no
 * earlier alert.
 */
export const unmatchedPayments = (
  intents: IntentSummary[],
  orderIntentIds: Set<string>,
  now: number,
): IntentSummary[] =>
  intents.filter(
    (pi) =>
      pi.status === "succeeded" &&
      Boolean(pi.metadata?.userId) &&
      !pi.metadata?.[ALERTED_KEY] &&
      now - pi.created * 1000 >= GRACE_MS &&
      !orderIntentIds.has(pi.id),
  );

export interface ReconciliationDeps {
  configured: () => boolean;
  listIntents: (sinceSeconds: number) => Promise<IntentSummary[]>;
  orderIntentIds: (ids: string[]) => Promise<Set<string>>;
  customerEmail: (userId: string) => Promise<string | null>;
  alert: (args: { title: string; message: string; meta: Record<string, unknown> }) => Promise<void>;
  markAlerted: (id: string, at: string) => Promise<void>;
}

const defaultDeps: ReconciliationDeps = {
  configured: isStripeConfigured,
  listIntents: async (sinceSeconds) => {
    const out: IntentSummary[] = [];
    for await (const pi of stripe.paymentIntents.list({ created: { gte: sinceSeconds }, limit: 100 })) {
      out.push({
        id: pi.id,
        status: pi.status,
        amount: pi.amount_received || pi.amount,
        currency: pi.currency,
        created: pi.created,
        metadata: (pi.metadata || {}) as Record<string, string>,
      });
    }
    return out;
  },
  orderIntentIds: async (ids) => {
    const orders = await Order.find({ "payment.paymentIntentId": { $in: ids } })
      .select("payment.paymentIntentId")
      .lean();
    return new Set(orders.map((o: any) => String(o.payment?.paymentIntentId || "")));
  },
  customerEmail: async (userId) => {
    const user = await User.findById(userId).select("email").lean().catch(() => null);
    return (user as any)?.email ? String((user as any).email) : null;
  },
  alert: ({ title, message, meta }) =>
    notifyAllAdmins({ category: "orders", priority: "high", title, message, meta }).then(() => undefined),
  markAlerted: async (id, at) => {
    await stripe.paymentIntents.update(id, { metadata: { [ALERTED_KEY]: at } });
  },
};

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

/** One pass. Returns how many payments were reported. */
export const reconcilePayments = async (
  deps: ReconciliationDeps = defaultDeps,
  now: number = Date.now(),
): Promise<number> => {
  if (!deps.configured()) return 0;
  const intents = await deps.listIntents(Math.floor((now - LOOKBACK_MS) / 1000));
  const succeeded = intents.filter((pi) => pi.status === "succeeded");
  if (succeeded.length === 0) return 0;
  const withOrders = await deps.orderIntentIds(succeeded.map((pi) => pi.id));
  const missing = unmatchedPayments(succeeded, withOrders, now);

  for (const pi of missing) {
    const email = await deps.customerEmail(pi.metadata.userId);
    await deps.alert({
      title: "Payment received without an order",
      message:
        `${money(pi.amount, pi.currency)} was charged${email ? ` to ${email}` : ""} but no order was saved ` +
        `(Stripe payment ${pi.id}). Refund it in Stripe or contact the customer.`,
      meta: { paymentIntentId: pi.id, amountCents: pi.amount, userId: pi.metadata.userId },
    });
    // Recorded on the payment itself, so each one is reported once.
    await deps.markAlerted(pi.id, new Date(now).toISOString());
  }
  return missing.length;
};

let timer: ReturnType<typeof setInterval> | null = null;

export const startPaymentReconciliation = (intervalMs = 10 * 60 * 1000): void => {
  if (timer) return;
  const run = () =>
    reconcilePayments()
      .then((n) => {
        if (n > 0) console.warn(`[payments] ${n} payment(s) without an order reported to admins`);
      })
      .catch((e) => reportJobError("PAYMENT_RECONCILIATION", e));
  timer = setInterval(run, intervalMs);
  run();
};
