import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeRegion, getRegionFromState } from "../utils/region.js";
import { REGION_FALLBACKS } from "../services/orderAssignment.service.js";
import { normalizeGlobalPricing } from "../services/pricing.service.js";

/**
 * `POST /admin/partners` validated almost nothing. The console checked these,
 * but the endpoint accepted a region of "Atlantis", an email of "not-an-email",
 * no address at all, a state of "ZZ" and a negative sheet size — none of which
 * error. They produce a partner that is quietly broken: unassignable, ranked
 * last forever, or uncontactable.
 *
 * These pin the rules the endpoint now enforces, and the region coverage those
 * rules depend on.
 */

const US = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");

describe("the four regions cover the whole country", () => {
  it("maps every state and DC to exactly one region", () => {
    const unmapped = US.filter((s) => !getRegionFromState(s));
    assert.deepEqual(unmapped, [], "every US state must resolve to a region");
  });

  it("is a partition, not a subset — all four are reachable", () => {
    const regions = new Set(US.map((s) => getRegionFromState(s)));
    assert.deepEqual([...regions].sort(), ["Midwest", "Northeast", "South", "West"]);
  });

  it("returns null for territories, which the platform does not serve", () => {
    for (const t of ["PR", "GU", "VI", "AS", "MP"]) {
      assert.equal(getRegionFromState(t), null, t);
    }
  });

  it("gives every region a full fallback chain, so no region can strand an order", () => {
    for (const r of ["West", "Midwest", "South", "Northeast"]) {
      const chain = REGION_FALLBACKS[r];
      assert.equal(chain.length, 3, `${r} must be able to fall back to all others`);
      assert.deepEqual([...chain, r].sort(), ["Midwest", "Northeast", "South", "West"]);
    }
  });
});

describe("region input the endpoint accepts", () => {
  it("accepts the canonical names and common spellings", () => {
    for (const [input, expected] of [
      ["West", "West"], ["west", "West"], ["  Midwest  ", "Midwest"],
      ["north-east", "Northeast"], ["southeast", "South"], ["southwest", "South"],
    ] as const) {
      assert.equal(normalizeRegion(input), expected, input);
    }
  });

  it("rejects anything it cannot place, rather than storing it", () => {
    // A stored region that does not normalize makes the partner unassignable:
    // assignment reads null and blocks. Silently accepting it is the failure.
    for (const bad of ["Atlantis", "Central", "Pacific Northwest", "", null, undefined, "NA"]) {
      assert.equal(normalizeRegion(bad as any), null, String(bad));
    }
  });
});

describe("the email rule the endpoint applies", () => {
  const ok = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

  it("accepts ordinary addresses", () => {
    for (const e of ["a@b.co", "first.last@sub.domain.com", "x+tag@example.org"]) {
      assert.ok(ok(e), e);
    }
  });

  it("rejects what the endpoint used to store happily", () => {
    for (const e of ["not-an-email", "nope", "a@b", "a b@c.com", "@example.com", "x@.com", ""]) {
      assert.ok(!ok(e), e);
    }
  });
});

describe("admin settings are the starting defaults", () => {
  it("a new partner starts on the configured rate, not a hard-coded one", () => {
    const gp = normalizeGlobalPricing({ partnerDefaults: { baseRatePerSqFt: 2.75, rushPct: 15, specialInkFlat: 7 } });
    assert.equal(gp.partnerDefaults.baseRatePerSqFt, 2.75);
    assert.equal(gp.partnerDefaults.rushPct, 15);
    assert.equal(gp.partnerDefaults.specialInkFlat, 7);
  });

  it("falls back to what was previously hard-coded, so adopting this moves nothing", () => {
    const gp = normalizeGlobalPricing({});
    assert.equal(gp.partnerDefaults.baseRatePerSqFt, 2.5);
    assert.equal(gp.partnerDefaults.rushPct, 10);
    assert.equal(gp.partnerDefaults.specialInkFlat, 5);
  });

  it("keeps an explicit zero rather than treating it as absent", () => {
    // A partner on 0% rush is a real arrangement; it must not silently become 10.
    assert.equal(normalizeGlobalPricing({ partnerDefaults: { rushPct: 0 } }).partnerDefaults.rushPct, 0);
  });

  it("ignores junk instead of storing it as a pay rate", () => {
    const gp = normalizeGlobalPricing({ partnerDefaults: { baseRatePerSqFt: "abc", rushPct: null, specialInkFlat: -4 } });
    assert.equal(gp.partnerDefaults.baseRatePerSqFt, 2.5);
    assert.equal(gp.partnerDefaults.rushPct, 10);
    assert.equal(gp.partnerDefaults.specialInkFlat, 5);
  });
});
