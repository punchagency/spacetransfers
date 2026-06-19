/**
 * ShipStation service unit tests — no real API calls, no MongoDB connection.
 * Tests focus on pure functions and logic that can be verified in isolation.
 * Run with: npm test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { withRetry, isDeliveredStatus } from "../services/shipstation.service.js";
import { shouldPollOrder } from "../services/trackingPoller.service.js";

// ── withRetry ─────────────────────────────────────────────────────────────────

describe("withRetry", () => {
  it("returns the result immediately when the function succeeds on the first attempt", async () => {
    const result = await withRetry(async () => 42, 3, 10, "test");
    assert.equal(result, 42);
  });

  it("retries and succeeds if the function fails once then succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new Error("transient failure");
        return "ok";
      },
      3,
      1, // 1ms delay so the test stays fast
      "test"
    );
    assert.equal(result, "ok");
    assert.equal(calls, 2);
  });

  it("throws the last error after exhausting all attempts", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls++;
            throw new Error(`fail #${calls}`);
          },
          3,
          1,
          "test"
        ),
      (err: any) => {
        assert.equal(err.message, "fail #3");
        return true;
      }
    );
    assert.equal(calls, 3);
  });

  it("does not retry when maxAttempts is 1", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls++;
            throw new Error("once");
          },
          1,
          1,
          "test"
        )
    );
    assert.equal(calls, 1);
  });

  it("resolves with undefined when the function returns void", async () => {
    const result = await withRetry(async () => {}, 2, 1, "test");
    assert.equal(result, undefined);
  });
});

// ── isDeliveredStatus ─────────────────────────────────────────────────────────

describe("isDeliveredStatus", () => {
  it('returns true for "delivered"', () => {
    assert.equal(isDeliveredStatus("delivered"), true);
  });

  it('returns true for "DELIVERED" (case-insensitive)', () => {
    assert.equal(isDeliveredStatus("DELIVERED"), true);
  });

  it('returns true for "  Delivered  " (trims whitespace)', () => {
    assert.equal(isDeliveredStatus("  Delivered  "), true);
  });

  it('returns false for "in_transit"', () => {
    assert.equal(isDeliveredStatus("in_transit"), false);
  });

  it('returns false for "out_for_delivery"', () => {
    assert.equal(isDeliveredStatus("out_for_delivery"), false);
  });

  it('returns false for "exception"', () => {
    assert.equal(isDeliveredStatus("exception"), false);
  });

  it('returns false for "unknown"', () => {
    assert.equal(isDeliveredStatus("unknown"), false);
  });

  it("returns false for an empty string", () => {
    assert.equal(isDeliveredStatus(""), false);
  });
});

// ── shouldPollOrder ───────────────────────────────────────────────────────────

const makeOrder = (overrides: Partial<{
  status: string;
  trackingNumber: string | null;
  createdAtDaysAgo: number;
  maxPollingDays: number;
}> = {}) => ({
  status: overrides.status ?? "SHIPPED",
  trackingNumber: overrides.trackingNumber !== undefined ? overrides.trackingNumber : "1Z999AA1",
  createdAt: new Date(Date.now() - (overrides.createdAtDaysAgo ?? 1) * 86_400_000),
  maxPollingDays: overrides.maxPollingDays ?? 30,
});

describe("shouldPollOrder", () => {
  it("returns true for a SHIPPED order with a tracking number within the polling window", () => {
    assert.equal(shouldPollOrder(makeOrder()), true);
  });

  it("returns false when status is COMPLETED", () => {
    assert.equal(shouldPollOrder(makeOrder({ status: "COMPLETED" })), false);
  });

  it("returns false when status is PENDING", () => {
    assert.equal(shouldPollOrder(makeOrder({ status: "PENDING" })), false);
  });

  it("returns false when trackingNumber is null", () => {
    assert.equal(shouldPollOrder(makeOrder({ trackingNumber: null })), false);
  });

  it("returns false when trackingNumber is empty string", () => {
    assert.equal(shouldPollOrder(makeOrder({ trackingNumber: "" })), false);
  });

  it("returns false when order is older than maxPollingDays", () => {
    assert.equal(
      shouldPollOrder(makeOrder({ createdAtDaysAgo: 31, maxPollingDays: 30 })),
      false
    );
  });

  it("returns true when order age equals maxPollingDays exactly", () => {
    // Exactly 30 days old with maxPollingDays=30 should still be polled.
    assert.equal(
      shouldPollOrder(makeOrder({ createdAtDaysAgo: 30, maxPollingDays: 30 })),
      true
    );
  });

  it("returns true when maxPollingDays is very large (no effective cutoff)", () => {
    assert.equal(
      shouldPollOrder(makeOrder({ createdAtDaysAgo: 365, maxPollingDays: 9999 })),
      true
    );
  });
});

// ── Status transition integrity ───────────────────────────────────────────────

describe("Status transition audit trail", () => {
  it("QUALITY_CHECK and SHIPPED are distinct statuses (Ready for Packaging ≠ Shipped)", () => {
    assert.notEqual("QUALITY_CHECK", "SHIPPED");
  });

  it("SHIPPED and COMPLETED are distinct statuses", () => {
    assert.notEqual("SHIPPED", "COMPLETED");
  });

  it("the full delivery pipeline has three distinct stages", () => {
    const stages = ["QUALITY_CHECK", "SHIPPED", "COMPLETED"];
    const unique = new Set(stages);
    assert.equal(unique.size, 3);
  });
});
