import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getRegionFromState,
  resolveOrderRegion,
  resolvePartnerRegion,
  resolveRegionInfo
} from "../utils/region.js";

/**
 * An order's region must come from the shipping address, because that is where
 * the parcel goes and it is what `autoAssignOrder` routes on.
 *
 * The console used to prefer `customer.region` and then the customer's profile
 * region, so an order shipping to California and assigned to a Californian
 * partner was displayed as a cross-region assignment — "expect longer transit
 * and higher shipping cost" — purely because that customer's profile said
 * Midwest. The engine and the screen disagreed about the same order.
 */

describe("an order's region follows the parcel", () => {
  it("uses the shipping address even when the profile says otherwise", () => {
    const order = { shippingAddress: { state: "CA" }, user: "u1", customer: { region: "Midwest" } };
    const map = new Map([["u1", "Midwest"]]);
    assert.equal(resolveOrderRegion(order, map), "West");
  });

  it("agrees with what assignment routes on, for every region", () => {
    for (const [state, region] of [["CA","West"],["IL","Midwest"],["TX","South"],["NY","Northeast"]] as const) {
      const order = { shippingAddress: { state }, user: "u1", customer: { region: "Northeast" } };
      // `autoAssignOrder` computes exactly this from the same field.
      assert.equal(resolveOrderRegion(order, new Map([["u1", "South"]])), region, state);
      assert.equal(getRegionFromState(state), region, `${state} via assignment`);
    }
  });

  it("does not invent a cross-region flag for a local order", () => {
    // West customer, West printer: the badge warns of longer transit and higher
    // cost, so a false positive is not cosmetic.
    const customerRegion = resolveOrderRegion(
      { shippingAddress: { state: "CA" }, user: "u1" },
      new Map([["u1", "Midwest"]]),
    );
    const printerRegion = "West";
    assert.equal(Boolean(customerRegion && printerRegion && customerRegion !== printerRegion), false);
  });

  it("falls back to the profile only when the address gives nothing", () => {
    const map = new Map([["u1", "Midwest"]]);
    assert.equal(resolveOrderRegion({ user: "u1" }, map), "Midwest");
    assert.equal(resolveOrderRegion({ shippingAddress: { state: "ZZ" }, user: "u1" }, map), "Midwest");
    assert.equal(resolveOrderRegion({ shippingAddress: { state: "" }, customer: { region: "South" } }), "South");
  });

  it("returns null rather than guessing when nothing is known", () => {
    assert.equal(resolveOrderRegion({}), null);
    assert.equal(resolveOrderRegion({ shippingAddress: { state: "ZZ" } }), null);
  });
});

/**
 * The orders table and the order details page must never disagree.
 *
 * They did: the table read a stored `crossRegionAssignment` snapshot written
 * only by the auto-assign path, which nothing ever cleared, while the details
 * page recomputed from the currently assigned partner. Reassigning DTF-0241
 * back to an in-region partner left the table badging "→ Northeast" against a
 * details page that showed no crossing at all.
 *
 * Both now call `resolveRegionInfo`, so these cases pin the shared behaviour.
 */
describe("cross-region is derived from who is assigned right now", () => {
  const westPartner = { defaultShippingAddress: { state: "CA" }, regions: ["West"] };
  const northeastPartner = { defaultShippingAddress: { state: "NY" }, regions: ["Northeast"] };

  it("clears once a cross-region order is reassigned back in-region", () => {
    const order = { shippingAddress: { state: "CA" }, assignedPrinter: westPartner };
    const info = resolveRegionInfo(order);
    assert.equal(info.customerRegion, "West");
    assert.equal(info.printerRegion, "West");
    assert.equal(info.crossRegion, false);
  });

  it("flags a genuine crossing regardless of how it was assigned", () => {
    // Manual assignment never wrote the snapshot, so the table used to show
    // nothing here while the details page warned about longer transit.
    const order = { shippingAddress: { state: "CA" }, assignedPrinter: northeastPartner };
    const info = resolveRegionInfo(order);
    assert.equal(info.crossRegion, true);
    assert.equal(info.customerRegion, "West");
    assert.equal(info.printerRegion, "Northeast");
  });

  it("treats an unassigned order as not crossing", () => {
    const info = resolveRegionInfo({ shippingAddress: { state: "CA" }, assignedPrinter: null });
    assert.equal(info.printerRegion, null);
    assert.equal(info.crossRegion, false);
  });

  it("does not call an unknown region a crossing", () => {
    // A gap is not a costly fallback; badging it sends an admin chasing nothing.
    assert.equal(resolveRegionInfo({ shippingAddress: { state: "ZZ" }, assignedPrinter: westPartner }).crossRegion, false);
    assert.equal(resolveRegionInfo({ shippingAddress: { state: "CA" }, assignedPrinter: {} }).crossRegion, false);
  });
});

describe("a partner's region comes from where they print", () => {
  it("prefers the business address over the list of areas served", () => {
    // A partner serving three regions has one address; `regions` says where they
    // are willing to ship to, not where the film is.
    const partner = { defaultShippingAddress: { state: "CA" }, regions: ["Northeast", "South"] };
    assert.equal(resolvePartnerRegion(partner), "West");
  });

  it("falls back through businessAddress, then the served list", () => {
    assert.equal(resolvePartnerRegion({ businessAddress: { state: "TX" }, regions: ["West"] }), "South");
    assert.equal(resolvePartnerRegion({ regions: ["Midwest"] }), "Midwest");
    assert.equal(resolvePartnerRegion({}), null);
    assert.equal(resolvePartnerRegion(null), null);
  });
});
