import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { REGION_FALLBACKS } from "../services/orderAssignment.service.js";
import { getRegionFromState } from "../utils/region.js";

/**
 * Rates were quoted from a fixed origin (a fixed postcode in the environment, an Austin
 * postcode) while the label ships from the assigned partner's own address.
 * Because assignment matches a partner to the customer's region, real shipments
 * are short local hops that were priced as though they crossed the country —
 * a systematic error, always in the same direction for a given lane.
 */

describe("shipping origin follows the serving region", () => {
  it("maps a customer state to the region that will fulfil it", () => {
    assert.equal(getRegionFromState("NY"), "Northeast");
    assert.equal(getRegionFromState("CA"), "West");
    assert.equal(getRegionFromState("TX"), "South");
    assert.equal(getRegionFromState("IL"), "Midwest");
  });

  it("has a fallback chain for every region, so an origin is still derivable", () => {
    for (const region of ["Northeast", "West", "South", "Midwest"]) {
      assert.ok(
        Array.isArray(REGION_FALLBACKS[region]) && REGION_FALLBACKS[region].length > 0,
        `${region} needs at least one fallback`,
      );
      assert.ok(!REGION_FALLBACKS[region].includes(region), `${region} must not fall back to itself`);
    }
  });

  it("returns no region for a non-US or unknown state, so no origin is invented", () => {
    // Better to fall back to the configured warehouse than to guess a region.
    assert.equal(getRegionFromState("ZZ"), null);
    assert.equal(getRegionFromState(""), null);
    assert.equal(getRegionFromState(undefined as any), null);
  });

  it("shows why the fixed origin was wrong: NY and CA are not the same lane", () => {
    // Both were quoted from 78701. A NY customer served by a NY partner is a
    // local delivery; from Austin it is a cross-country one.
    assert.notEqual(getRegionFromState("NY"), getRegionFromState("TX"));
    assert.notEqual(getRegionFromState("CA"), getRegionFromState("TX"));
  });
});
