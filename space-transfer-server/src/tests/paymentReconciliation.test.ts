import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GRACE_MS,
  reconcilePayments,
  unmatchedPayments,
  type IntentSummary,
  type ReconciliationDeps,
} from "../services/paymentReconciliation.service.js";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const ago = (ms: number) => Math.floor((NOW - ms) / 1000);
const intent = (over: Partial<IntentSummary> = {}): IntentSummary => ({
  id: "pi_1",
  status: "succeeded",
  amount: 2824,
  currency: "usd",
  created: ago(60 * 60 * 1000),
  metadata: { userId: "u1" },
  ...over,
});

describe("payments without an order", () => {
  it("flags a succeeded checkout payment that has no order", () => {
    assert.deepEqual(unmatchedPayments([intent()], new Set(), NOW).map((p) => p.id), ["pi_1"]);
  });

  it("leaves alone payments that have an order, are too recent, failed, weren't ours, or were already reported", () => {
    const cases = [
      intent({ id: "pi_order" }),
      intent({ id: "pi_recent", created: ago(GRACE_MS - 60_000) }),
      intent({ id: "pi_failed", status: "requires_payment_method" }),
      intent({ id: "pi_foreign", metadata: {} }),
      intent({ id: "pi_seen", metadata: { userId: "u1", unmatchedAlertedAt: "2026-09-30T11:00:00Z" } }),
    ];
    assert.deepEqual(unmatchedPayments(cases, new Set(["pi_order"]), NOW), []);
  });

  it("tells the admins once, with the amount and the customer, and remembers it", async () => {
    const alerts: string[] = [];
    const marked: string[] = [];
    const deps: ReconciliationDeps = {
      configured: () => true,
      listIntents: async () => [intent(), intent({ id: "pi_2", metadata: { userId: "u2" } })],
      orderIntentIds: async () => new Set(["pi_2"]),
      customerEmail: async (id) => (id === "u1" ? "ada@example.com" : null),
      alert: async ({ message }) => {
        alerts.push(message);
      },
      markAlerted: async (id) => {
        marked.push(id);
      },
    };
    assert.equal(await reconcilePayments(deps, NOW), 1);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /\$28\.24 was charged to ada@example\.com but no order was saved \(Stripe payment pi_1\)/);
    assert.deepEqual(marked, ["pi_1"]);
  });

  it("does nothing without Stripe", async () => {
    const deps = { configured: () => false } as unknown as ReconciliationDeps;
    assert.equal(await reconcilePayments(deps, NOW), 0);
  });
});
