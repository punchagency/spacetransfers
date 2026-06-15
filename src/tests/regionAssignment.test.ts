/**
 * Region detection and assignment logic tests.
 * Run with: npm test
 * Uses Node.js built-in test runner (node:test).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRegion,
  getRegionFromState,
  getLatLngFromState,
  haversineMiles,
  REGION_CENTROIDS
} from "../utils/region.js";

// ── normalizeRegion ──────────────────────────────────────────────────────────

describe("normalizeRegion", () => {
  it("handles canonical casing", () => {
    assert.equal(normalizeRegion("West"), "West");
    assert.equal(normalizeRegion("Midwest"), "Midwest");
    assert.equal(normalizeRegion("South"), "South");
    assert.equal(normalizeRegion("Northeast"), "Northeast");
  });

  it("is case-insensitive", () => {
    assert.equal(normalizeRegion("WEST"), "West");
    assert.equal(normalizeRegion("south"), "South");
    assert.equal(normalizeRegion("NORTHEAST"), "Northeast");
    assert.equal(normalizeRegion("midwest"), "Midwest");
  });

  it("accepts common aliases", () => {
    assert.equal(normalizeRegion("west coast"), "West");
    assert.equal(normalizeRegion("west-coast"), "West");
    assert.equal(normalizeRegion("mid-west"), "Midwest");
    assert.equal(normalizeRegion("north-east"), "Northeast");
    assert.equal(normalizeRegion("southeast"), "South");
    assert.equal(normalizeRegion("southwest"), "South");
  });

  it("returns null for unrecognised input", () => {
    assert.equal(normalizeRegion("Pacific"), null);
    assert.equal(normalizeRegion(""), null);
    assert.equal(normalizeRegion(null), null);
    assert.equal(normalizeRegion(undefined), null);
  });
});

// ── getRegionFromState ───────────────────────────────────────────────────────

describe("getRegionFromState", () => {
  it("Texas → South", () => assert.equal(getRegionFromState("TX"), "South"));
  it("California → West", () => assert.equal(getRegionFromState("CA"), "West"));
  it("New York → Northeast", () => assert.equal(getRegionFromState("NY"), "Northeast"));
  it("Illinois → Midwest", () => assert.equal(getRegionFromState("IL"), "Midwest"));
  it("Florida → South", () => assert.equal(getRegionFromState("FL"), "South"));
  it("Washington → West", () => assert.equal(getRegionFromState("WA"), "West"));
  it("Ohio → Midwest", () => assert.equal(getRegionFromState("OH"), "Midwest"));
  it("Virginia → South", () => assert.equal(getRegionFromState("VA"), "South"));

  it("is case-insensitive", () => {
    assert.equal(getRegionFromState("tx"), "South");
    assert.equal(getRegionFromState("Ca"), "West");
  });

  it("returns null for unknown state codes — no default fallback to West", () => {
    assert.equal(getRegionFromState("XX"), null);
    assert.equal(getRegionFromState(""), null);
    assert.equal(getRegionFromState(undefined), null);
    assert.equal(getRegionFromState(null), null);
    assert.equal(getRegionFromState("ON"), null);   // Ontario, Canada
    assert.equal(getRegionFromState("BC"), null);   // British Columbia
    assert.equal(getRegionFromState("QC"), null);   // Quebec
    assert.equal(getRegionFromState("MX"), null);   // Mexico
    assert.equal(getRegionFromState("UK"), null);   // United Kingdom
  });

  it("DC → South", () => assert.equal(getRegionFromState("DC"), "South"));
  it("HI → West", () => assert.equal(getRegionFromState("HI"), "West"));
  it("AK → West", () => assert.equal(getRegionFromState("AK"), "West"));

  // Border states — ensure they map to the correct region
  it("KY → South (not Midwest)", () => assert.equal(getRegionFromState("KY"), "South"));
  it("MO → Midwest (not South)", () => assert.equal(getRegionFromState("MO"), "Midwest"));
  it("PA → Northeast (not Midwest)", () => assert.equal(getRegionFromState("PA"), "Northeast"));
  it("WV → South (not Northeast)", () => assert.equal(getRegionFromState("WV"), "South"));
});

// ── getLatLngFromState ───────────────────────────────────────────────────────

describe("getLatLngFromState", () => {
  it("returns coordinates for known states", () => {
    const tx = getLatLngFromState("TX");
    assert.ok(tx, "TX should return coords");
    assert.ok(tx!.lat > 25 && tx!.lat < 37, "TX latitude range");
    assert.ok(tx!.lon < -90 && tx!.lon > -107, "TX longitude range");
  });

  it("returns null for unknown state", () => {
    assert.equal(getLatLngFromState("XX"), null);
    assert.equal(getLatLngFromState(undefined), null);
  });
});

// ── haversineMiles ───────────────────────────────────────────────────────────

describe("haversineMiles", () => {
  it("Texas to California is roughly 1200–1500 miles", () => {
    const tx = getLatLngFromState("TX")!;
    const ca = getLatLngFromState("CA")!;
    const dist = haversineMiles(tx, ca);
    assert.ok(dist > 1200 && dist < 1600, `TX–CA distance was ${dist.toFixed(0)}mi, expected 1200–1600`);
  });

  it("same point = 0 miles", () => {
    const pt = { lat: 35, lon: -90 };
    assert.equal(haversineMiles(pt, pt), 0);
  });

  it("NY to LA is roughly 2400–2800 miles", () => {
    const ny = getLatLngFromState("NY")!;
    const ca = getLatLngFromState("CA")!;
    const dist = haversineMiles(ny, ca);
    assert.ok(dist > 2400 && dist < 2900, `NY–CA distance was ${dist.toFixed(0)}mi`);
  });
});

// ── Region consistency: customer vs printer same-pipeline check ──────────────

describe("Region consistency — same pipeline for customer and printer", () => {
  // Simulate how the assignment service resolves both sides
  const resolveRegion = (state: string | undefined | null) =>
    normalizeRegion(getRegionFromState(state ?? undefined));

  it("TX customer and TX printer are in the same region", () => {
    assert.equal(resolveRegion("TX"), resolveRegion("TX"));
  });

  it("CA customer and CA printer are in the same region", () => {
    assert.equal(resolveRegion("CA"), resolveRegion("CA"));
  });

  it("TX customer (South) and CA printer (West) are NOT in the same region", () => {
    assert.notEqual(resolveRegion("TX"), resolveRegion("CA"));
  });

  it("TX (South) and FL (South) are in the same region", () => {
    assert.equal(resolveRegion("TX"), resolveRegion("FL"));
  });

  it("NY (Northeast) and NJ (Northeast) are in the same region", () => {
    assert.equal(resolveRegion("NY"), resolveRegion("NJ"));
  });

  it("IL (Midwest) and OH (Midwest) are in the same region", () => {
    assert.equal(resolveRegion("IL"), resolveRegion("OH"));
  });
});

// ── REGION_CENTROIDS completeness ────────────────────────────────────────────

describe("REGION_CENTROIDS", () => {
  it("contains all four US regions", () => {
    assert.ok("West" in REGION_CENTROIDS);
    assert.ok("Midwest" in REGION_CENTROIDS);
    assert.ok("South" in REGION_CENTROIDS);
    assert.ok("Northeast" in REGION_CENTROIDS);
  });

  it("centroid coordinates are plausible US lat/lon", () => {
    for (const [region, coord] of Object.entries(REGION_CENTROIDS)) {
      assert.ok(
        coord.lat >= 24 && coord.lat <= 50,
        `${region} lat ${coord.lat} out of US range`
      );
      assert.ok(
        coord.lon >= -130 && coord.lon <= -65,
        `${region} lon ${coord.lon} out of US range`
      );
    }
  });
});

// ── Cross-region blocking — assignment must be prevented ────────────────────

describe("Cross-region blocking", () => {
  // Mirrors the exact resolution used in autoAssignOrder
  const resolveCustomerRegion = (state: string | undefined | null) =>
    getRegionFromState(state ?? undefined);
  const resolvePrinterRegion = (state: string | undefined | null) =>
    state ? normalizeRegion(getRegionFromState(state)) : null;

  it("TX (South) customer must NOT match CA (West) printer", () => {
    const cr = resolveCustomerRegion("TX");
    const pr = resolvePrinterRegion("CA");
    assert.notEqual(cr, pr, "South !== West — must be blocked");
  });

  it("TX (South) customer must NOT match WA (West) printer", () => {
    assert.notEqual(resolveCustomerRegion("TX"), resolvePrinterRegion("WA"));
  });

  it("NY (Northeast) customer must NOT match CA (West) printer", () => {
    assert.notEqual(resolveCustomerRegion("NY"), resolvePrinterRegion("CA"));
  });

  it("IL (Midwest) customer must NOT match FL (South) printer", () => {
    assert.notEqual(resolveCustomerRegion("IL"), resolvePrinterRegion("FL"));
  });

  it("unknown state customer resolves to null — cannot match any printer", () => {
    const cr = resolveCustomerRegion("ON"); // Ontario, Canada
    assert.equal(cr, null, "Non-US state must produce null — blocks all assignment");
  });

  it("empty state customer resolves to null — cannot match any printer", () => {
    assert.equal(resolveCustomerRegion(""), null);
    assert.equal(resolveCustomerRegion(undefined), null);
  });

  it("null customer region can never equal a valid printer region", () => {
    const cr = resolveCustomerRegion("XX"); // unknown
    const pr = resolvePrinterRegion("CA");  // West
    // null !== "West" → pool filter produces empty array → no assignment
    assert.notEqual(cr, pr);
    assert.equal(cr, null);
  });
});

// ── Same-region must still match correctly ───────────────────────────────────

describe("Same-region matching", () => {
  const resolveCustomerRegion = (state: string | undefined | null) =>
    getRegionFromState(state ?? undefined);
  const resolvePrinterRegion = (state: string | undefined | null) =>
    state ? normalizeRegion(getRegionFromState(state)) : null;

  const pairs: Array<[string, string, string]> = [
    ["TX", "FL", "South"],
    ["CA", "WA", "West"],
    ["NY", "NJ", "Northeast"],
    ["IL", "OH", "Midwest"],
    ["TX", "AL", "South"],
    ["AZ", "NV", "West"],
  ];

  for (const [customerState, printerState, expectedRegion] of pairs) {
    it(`${customerState} customer matches ${printerState} printer (both ${expectedRegion})`, () => {
      const cr = resolveCustomerRegion(customerState);
      const pr = resolvePrinterRegion(printerState);
      assert.equal(cr, expectedRegion);
      assert.equal(pr, expectedRegion);
      assert.equal(cr, pr, `${customerState}/${printerState} should both resolve to ${expectedRegion}`);
    });
  }
});
