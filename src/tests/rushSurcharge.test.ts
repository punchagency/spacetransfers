import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeTotals,
  isUrgentPriority,
  normalizeGlobalPricing,
  priorityForShippingMethod,
} from "../services/pricing.service.js";

/**
 * The checkout's express option has always said "priority handling" and charged
 * for it, while `order.priority` was set only by an admin at assignment. So the
 * promise was sold and never kept, and when an admin did mark an order urgent
 * the partner's 10% rush came straight out of margin — the customer had paid
 * nothing towards it.
 *
 * Express shipping does not fund it either: that premium is a carrier
 * pass-through and none of it reaches margin. Hence a separate rush surcharge.
 */

const pricing = normalizeGlobalPricing({
  baseRatePerSqFt: 3.5,
  shipping: { standard: 8.99, express: 24.99 },
  taxRatePct: 8,
  rushSurchargePct: 10,
});

describe("priority follows the customer's choice at checkout", () => {
  it("express means urgent", () => {
    assert.equal(priorityForShippingMethod("express"), "URGENT");
    assert.equal(priorityForShippingMethod("Express"), "URGENT");
  });

  it("everything else is normal", () => {
    for (const m of ["standard", "", null, undefined, "overnight"]) {
      assert.equal(priorityForShippingMethod(m), "NORMAL", String(m));
    }
  });

  it("recognises urgent regardless of case or padding", () => {
    assert.equal(isUrgentPriority(" urgent "), true);
    assert.equal(isUrgentPriority("URGENT"), true);
    assert.equal(isUrgentPriority("NORMAL"), false);
    assert.equal(isUrgentPriority(undefined), false);
  });
});

describe("rush surcharge", () => {
  const totals = (priority: string, method = "express") =>
    computeTotals({ subtotal: 100, shippingMethod: method, pricing, shippingCost: 20, priority });

  it("is zero on a normal order", () => {
    const t = totals("NORMAL", "standard");
    assert.equal(t.rushSurcharge, 0);
    assert.equal(t.total, 100 + 0 + 20 + 8);
  });

  it("adds the configured percentage of the subtotal on an urgent order", () => {
    const t = totals("URGENT");
    assert.equal(t.rushSurcharge, 10);
  });

  it("is taxed with the subtotal, because it is part of the work, not the postage", () => {
    const t = totals("URGENT");
    assert.equal(t.tax, 8.8); // 8% of (100 + 10), not of 100
    assert.equal(t.total, 100 + 10 + 20 + 8.8);
  });

  it("does not touch shipping, which is priced by the carrier", () => {
    assert.equal(totals("URGENT").shippingCost, 20);
    assert.equal(totals("NORMAL", "standard").shippingCost, 20);
  });

  it("can be switched off entirely", () => {
    const free = normalizeGlobalPricing({ rushSurchargePct: 0 });
    const t = computeTotals({ subtotal: 100, shippingMethod: "express", pricing: free, shippingCost: 20, priority: "URGENT" });
    assert.equal(t.rushSurcharge, 0);
  });

  it("defaults to 10% when unset, and keeps an explicit value", () => {
    assert.equal(normalizeGlobalPricing({}).rushSurchargePct, 10);
    assert.equal(normalizeGlobalPricing({ rushSurchargePct: 17.5 }).rushSurchargePct, 17.5);
  });

  it("covers the partner's rush rather than leaving it on margin", () => {
    // A partner at 10% rush on a cost that is ~70% of the subtotal takes about
    // 7% of subtotal; charging 10% of subtotal leaves the platform ahead.
    const subtotal = 100;
    const partnerCost = 70;
    const partnerRush = partnerCost * 0.1;
    const customerRush = computeTotals({
      subtotal, shippingMethod: "express", pricing, shippingCost: 20, priority: "URGENT",
    }).rushSurcharge;
    assert.ok(customerRush >= partnerRush, `${customerRush} should cover ${partnerRush}`);
  });
});

describe("priority is fixed at checkout", () => {
  it("has no write path outside order creation", async () => {
    // Guards the decision rather than the code: three surfaces could change
    // priority after payment, and each broke the same way. The admin toggle
    // moved only the partner side — flipping up paid a rush nobody was charged
    // for, flipping down kept a rush the customer would no longer receive and
    // read as *higher* margin. Assignment overwrote it by default. And a
    // partner could mark their own job urgent, raising their own payout 10%
    // with no approval and no audit trail.
    const { readFile, readdir } = await import("node:fs/promises");
    const controllersIn = async (dir: string) =>
      (await readdir(dir)).filter((f) => f.endsWith(".ts")).map((f) => `${dir}/${f}`);

    for (const file of [
      ...(await controllersIn("src/controllers/admin")),
      ...(await controllersIn("src/controllers/printer")),
      "src/routes/admin.routes.ts",
      "src/routes/printer.routes.ts",
    ]) {
      const src = await readFile(file, "utf8");
      assert.ok(!/updateOrderPriority|updateJobPriority/.test(src), `${file} still references a priority mutator`);
      assert.ok(!/\/priority"/.test(src), `${file} still exposes a priority route`);
    }

    // Order creation remains the one writer.
    const creation = await readFile("src/controllers/customer/orders.controller.ts", "utf8");
    assert.match(creation, /priorityForShippingMethod\(shippingMethod\)/);
  });

  it("assignment does not carry a priority", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/controllers/admin/orders.controller.ts", "utf8");
    const assign = src.slice(src.indexOf("export const assignOrder"), src.indexOf("export const assignOrder") + 6000);
    assert.ok(!/order\.priority\s*=/.test(assign), "assignOrder writes priority again");
  });
});
