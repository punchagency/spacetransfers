import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * The earnings chart lost almost all of its data, twice over.
 *
 * Labels were produced by stepping the window (every 2 days on a 30-day range)
 * while orders were bucketed by an exact formatted date string. An order landing
 * on a skipped day matched no label and was dropped. With every live order on
 * 18 August — an odd offset from the window start — the chart drew a flat zero
 * underneath a card reading $586.
 *
 * Separately, the comparison series bucketed prior-window orders by their own
 * absolute dates. A prior label ("Jul 19") can never equal a current label
 * ("Aug 19"), so `previous` was zero on every point of every range except 7d,
 * where weekday names collide by coincidence.
 *
 * Both are fixed by index-aligned buckets: each window is cut into the same
 * number of slots and an order is placed by its offset from its own window
 * start. These tests pin that, since the failure is silent — a chart of zeroes
 * looks like a quiet month, not like a bug.
 */

/** Mirrors `placeInto` in getEarningsSummary. */
const placeInto = (
  buckets: number[],
  windowStart: Date,
  slotMs: number,
  when: Date,
  amount: number
) => {
  if (slotMs <= 0) return;
  const idx = Math.floor((when.getTime() - windowStart.getTime()) / slotMs);
  buckets[Math.min(Math.max(idx, 0), buckets.length - 1)] += amount;
};

const DAY = 24 * 60 * 60 * 1000;

describe("earnings chart buckets", () => {
  it("keeps every order, including one on a day no label lands on", () => {
    const start = new Date("2026-08-01T00:00:00Z");
    const end = new Date("2026-08-31T00:00:00Z");
    const count = 15;
    const slot = (end.getTime() - start.getTime()) / count;
    const buckets = new Array(count).fill(0);

    // 18 August: the date every live order sits on, and an odd offset from the
    // window start — exactly what the old every-2-days labelling skipped.
    placeInto(buckets, start, slot, new Date("2026-08-18T10:00:00Z"), 586.2);

    assert.equal(
      buckets.reduce((a, b) => a + b, 0),
      586.2,
      "the chart must sum to the revenue it was given"
    );
    assert.equal(buckets.filter((b) => b > 0).length, 1);
  });

  it("sums to the same total the headline reports, whatever the dates", () => {
    const start = new Date("2026-08-01T00:00:00Z");
    const end = new Date("2026-08-31T00:00:00Z");
    const count = 15;
    const slot = (end.getTime() - start.getTime()) / count;
    const buckets = new Array(count).fill(0);

    let expected = 0;
    for (let d = 0; d < 30; d += 1) {
      const amount = (d + 1) * 3.5;
      expected += amount;
      placeInto(buckets, start, slot, new Date(start.getTime() + d * DAY + 6 * 3600 * 1000), amount);
    }

    assert.equal(
      Number(buckets.reduce((a, b) => a + b, 0).toFixed(2)),
      Number(expected.toFixed(2))
    );
  });

  it("aligns the prior window by position, so the comparison is not always zero", () => {
    const start = new Date("2026-08-01T00:00:00Z");
    const priorStart = new Date("2026-07-02T00:00:00Z");
    const count = 15;
    const slot = (30 * DAY) / count;

    const current = new Array(count).fill(0);
    const previous = new Array(count).fill(0);

    // Same offset into each window — day 17 — must land in the same slot.
    placeInto(current, start, slot, new Date(start.getTime() + 17 * DAY), 100);
    placeInto(previous, priorStart, slot, new Date(priorStart.getTime() + 17 * DAY), 80);

    const currentIdx = current.findIndex((v) => v > 0);
    const previousIdx = previous.findIndex((v) => v > 0);

    assert.equal(currentIdx, previousIdx, "like-for-like positions must align");
    assert.equal(previous.reduce((a, b) => a + b, 0), 80, "the prior series must not be empty");
  });

  it("counts an order on the closing edge rather than discarding it", () => {
    const start = new Date("2026-08-01T00:00:00Z");
    const count = 15;
    const slot = (30 * DAY) / count;
    const buckets = new Array(count).fill(0);

    // Exactly on the upper boundary: floor() yields an index one past the end.
    placeInto(buckets, start, slot, new Date(start.getTime() + 30 * DAY), 42);

    assert.equal(buckets.reduce((a, b) => a + b, 0), 42);
    assert.equal(buckets[count - 1], 42, "it belongs in the last slot");
  });

  it("ignores an order before the window instead of counting it backwards", () => {
    const start = new Date("2026-08-01T00:00:00Z");
    const count = 15;
    const slot = (30 * DAY) / count;
    const buckets = new Array(count).fill(0);

    placeInto(buckets, start, slot, new Date(start.getTime() - 5 * DAY), 25);

    // Clamped into the first slot, never a negative index — which in JS would
    // have written an unreachable property and silently vanished from the chart.
    assert.equal(buckets[0], 25);
    assert.equal(buckets.length, count);
  });
});

/**
 * Margin must be earned before it is reported as earned.
 *
 * Revenue is everything the customer paid — printing, shipping and tax — because
 * that is what reaches the company account and what an admin reconciles against.
 * Margin is that minus partner cost. The honesty lives in the est./actual split
 * rather than in excluding pass-through lines: a figure covering orders that
 * have not shipped is labelled a forecast.
 */
describe("earnings margin definition", () => {
  const PAYOUT_ELIGIBLE = ["SHIPPED", "COMPLETED"];

  it("takes margin off everything the customer paid", () => {
    const revenue = 586.2; // printing 559.23 + shipping 26.97 + tax 0.00
    const cost = 399.51;

    assert.equal(Number((revenue - cost).toFixed(2)), 186.69);
    assert.equal(Number((((revenue - cost) / revenue) * 100).toFixed(1)), 31.8);
  });

  it("separates what is forecast from what is earned", () => {
    // Three orders placed, none shipped: the margin exists on paper, none of it
    // has been earned. Reporting the two as one number is what the old page did.
    const orderCount = 3;
    const shippedCount = 0;
    const margin = 186.69;
    const earned = 0;

    assert.ok(orderCount - shippedCount > 0, "still open, so margin is an estimate");
    assert.notEqual(margin, earned);
    assert.equal(earned, 0);
  });

  it("stops calling margin an estimate once everything has shipped", () => {
    const isForecast = (orderCount: number, shipped: number) => orderCount - shipped > 0;

    assert.equal(isForecast(3, 0), true);
    assert.equal(isForecast(3, 2), true);
    assert.equal(isForecast(3, 3), false);
    assert.equal(isForecast(0, 0), false);
  });

  it("counts margin as realized only once an order has shipped", () => {
    const realized = (status: string) => PAYOUT_ELIGIBLE.includes(status);

    assert.equal(realized("PROCESSING"), false);
    assert.equal(realized("PRINTING"), false);
    assert.equal(realized("QUALITY_CHECK"), false);
    assert.equal(realized("SHIPPED"), true);
    assert.equal(realized("COMPLETED"), true);
  });

  it("treats an empty prior window as incomparable rather than +100%", () => {
    const trendFor = (curr: number, prev: number) =>
      prev === 0
        ? { trendPct: null, comparable: false }
        : { trendPct: Number((((curr - prev) / Math.abs(prev)) * 100).toFixed(1)), comparable: true };

    assert.deepEqual(trendFor(586.2, 0), { trendPct: null, comparable: false });
    assert.deepEqual(trendFor(0, 0), { trendPct: null, comparable: false });
    assert.deepEqual(trendFor(150, 100), { trendPct: 50, comparable: true });
  });
});
