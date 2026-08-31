import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getRegionFromState, normalizeRegion } from "../utils/region.js";

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

// Mirrors the resolver in admin.controller.
const resolveOrderRegion = (order: any, map?: Map<string, string | null>): string | null => {
  const fromAddress = normalizeRegion(getRegionFromState(order?.shippingAddress?.state));
  if (fromAddress) return fromAddress;
  const userId = order?.user ? String(order.user) : null;
  const fromUser = userId && map ? map.get(userId) : null;
  return normalizeRegion(order?.customer?.region) || normalizeRegion(fromUser || undefined) || null;
};

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
