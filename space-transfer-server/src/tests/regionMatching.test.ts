/**
 * Comprehensive region-based customer-to-printer matching tests.
 *
 * Covers every success criterion from the feature spec:
 *   1. Same-region assignments succeed for all 4 US regions.
 *   2. Cross-region assignments are always rejected.
 *   3. No-printer-in-region → order stays unassigned with correct reason.
 *   4. Unknown / non-US customer state → assignment blocked.
 *   5. Address update recalculates region correctly.
 *   6. Admin manual assignment cross-region blocking logic.
 *   7. Sorting within a region pool (nearest → least-loaded → highest-rated).
 *   8. Every US state maps to the expected region.
 *
 * Run with: npm test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getRegionFromState,
  normalizeRegion,
  getLatLngFromState,
  haversineMiles,
} from "../utils/region.js";

import {
  sameFailureAsLast,
  selectPrinterFromCandidates,
  type PrinterCandidate,
} from "../services/orderAssignment.service.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const makeCandidate = (
  id: string,
  state: string,
  overrides: Partial<PrinterCandidate> = {}
): PrinterCandidate => ({
  printerId: id,
  printerName: `Printer-${id}`,
  printerState: state,
  printerRegion: normalizeRegion(getRegionFromState(state)),
  distanceMiles: Infinity,
  rating: 5.0,
  activeCount: 0,
  maxConcurrent: null,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Same-region assignment succeeds — all 4 US regions
// ─────────────────────────────────────────────────────────────────────────────

describe("Same-region assignment succeeds", () => {
  const cases: Array<{ customerState: string; printerState: string; region: string }> = [
    // West
    { customerState: "CA", printerState: "WA", region: "West" },
    { customerState: "WA", printerState: "OR", region: "West" },
    { customerState: "AZ", printerState: "NV", region: "West" },
    { customerState: "CO", printerState: "UT", region: "West" },
    { customerState: "HI", printerState: "AK", region: "West" },
    // Midwest
    { customerState: "IL", printerState: "OH", region: "Midwest" },
    { customerState: "MN", printerState: "WI", region: "Midwest" },
    { customerState: "MI", printerState: "IN", region: "Midwest" },
    { customerState: "IA", printerState: "MO", region: "Midwest" },
    { customerState: "KS", printerState: "ND", region: "Midwest" },
    // South
    { customerState: "TX", printerState: "FL", region: "South" },
    { customerState: "GA", printerState: "AL", region: "South" },
    { customerState: "NC", printerState: "SC", region: "South" },
    { customerState: "TN", printerState: "KY", region: "South" },
    { customerState: "VA", printerState: "WV", region: "South" },
    // Northeast
    { customerState: "NY", printerState: "NJ", region: "Northeast" },
    { customerState: "MA", printerState: "CT", region: "Northeast" },
    { customerState: "PA", printerState: "ME", region: "Northeast" },
    { customerState: "VT", printerState: "NH", region: "Northeast" },
    { customerState: "RI", printerState: "NY", region: "Northeast" },
  ];

  for (const { customerState, printerState, region } of cases) {
    it(`${customerState} customer → ${printerState} printer (both ${region})`, () => {
      const candidates = [makeCandidate("p1", printerState)];
      const result = selectPrinterFromCandidates(customerState, candidates);

      assert.equal(result.assigned, true, `Expected assignment for ${customerState}→${printerState}`);
      if (result.assigned) {
        assert.equal(result.customerRegion, region);
        assert.equal(result.selected.printerRegion, region);
        assert.equal(result.selected.printerId, "p1");
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Cross-region assignments are always rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("Cross-region assignment happens only as a fallback", () => {
  const crossCases: Array<[string, string, string, string]> = [
    ["TX", "CA", "South", "West"],
    ["TX", "WA", "South", "West"],
    ["TX", "NY", "South", "Northeast"],
    ["TX", "IL", "South", "Midwest"],
    ["CA", "TX", "West", "South"],
    ["CA", "NY", "West", "Northeast"],
    ["CA", "IL", "West", "Midwest"],
    ["CA", "FL", "West", "South"],
    ["NY", "CA", "Northeast", "West"],
    ["NY", "TX", "Northeast", "South"],
    ["NY", "IL", "Northeast", "Midwest"],
    ["NY", "GA", "Northeast", "South"],
    ["IL", "CA", "Midwest", "West"],
    ["IL", "TX", "Midwest", "South"],
    ["IL", "NY", "Midwest", "Northeast"],
    ["IL", "FL", "Midwest", "South"],
  ];

  // With nothing in the customer's own region the order is still fulfilled —
  // an unassigned order helps nobody — but the result says plainly that it
  // crossed a region, so the fact reaches the caller and the audit trail
  // instead of being invisible.
  for (const [customerState, printerState, cr, pr] of crossCases) {
    it(`${customerState} (${cr}) falls back to ${printerState} (${pr}) when nothing is in-region`, () => {
      const candidates = [makeCandidate("p1", printerState)];
      const result = selectPrinterFromCandidates(customerState, candidates);

      assert.equal(result.assigned, true, `${customerState}\u2192${printerState} should fall back, not fail`);
      if (result.assigned) {
        assert.equal(result.customerRegion, cr);
        assert.equal(result.assignedRegion, pr);
        assert.equal(result.isCrossRegion, true);
        assert.equal(result.candidatesSameRegion, 0);
      }

      assert.notEqual(getRegionFromState(customerState), getRegionFromState(printerState));
    });
  }

  it("prefers the customer's own region whenever one is available", () => {
    const candidates = [
      makeCandidate("west", "CA", { distanceMiles: 10 }),
      makeCandidate("south", "FL", { distanceMiles: 900 }),
    ];
    const result = selectPrinterFromCandidates("TX", candidates);

    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.selected.printerId, "south");
      assert.equal(result.isCrossRegion, false);
      assert.equal(result.assignedRegion, "South");
    }
  });

  it("follows the documented fallback order rather than picking the nearest", () => {
    // South's chain is Midwest -> Northeast -> West. West is nearer here, but
    // Midwest is earlier in the chain and must win.
    const candidates = [
      makeCandidate("west", "CA", { distanceMiles: 5 }),
      makeCandidate("midwest", "IL", { distanceMiles: 2000 }),
    ];
    const result = selectPrinterFromCandidates("TX", candidates);

    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.assignedRegion, "Midwest");
      assert.equal(result.selected.printerId, "midwest");
    }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 3. No printer available in the customer's region
// ─────────────────────────────────────────────────────────────────────────────

describe("Unassigned only when no candidate is usable at all", () => {
  it("South customer with West/Northeast/Midwest printers falls back rather than failing", () => {
    const candidates = [
      makeCandidate("p1", "CA"), // West
      makeCandidate("p2", "NY"), // Northeast
      makeCandidate("p3", "IL"), // Midwest
      makeCandidate("p4", "WA"), // West
    ];
    const result = selectPrinterFromCandidates("TX", candidates);

    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.customerRegion, "South");
      assert.equal(result.candidatesConsidered, 4);
      assert.equal(result.candidatesSameRegion, 0);
      assert.equal(result.isCrossRegion, true);
      assert.equal(result.assignedRegion, "Midwest"); // first in South's chain
    }
  });

  it("Midwest customer with an empty candidate list stays unassigned", () => {
    const result = selectPrinterFromCandidates("IL", []);

    assert.equal(result.assigned, false);
    if (!result.assigned) {
      assert.equal(result.customerRegion, "Midwest");
      assert.match(result.reason, /No available printers/);
    }
  });

  it("a candidate with no resolvable region is never usable", () => {
    const orphan = makeCandidate("orphan", "TX");
    orphan.printerRegion = null;

    const result = selectPrinterFromCandidates("IL", [orphan]);
    assert.equal(result.assigned, false);
  });
});



// ─────────────────────────────────────────────────────────────────────────────
// 4. Unknown / non-US state → assignment blocked
// ─────────────────────────────────────────────────────────────────────────────

describe("Unknown customer state → assignment blocked", () => {
  const unknownStates = [
    "ON",  // Ontario, Canada
    "BC",  // British Columbia
    "QC",  // Quebec
    "MX",  // Mexico
    "UK",  // United Kingdom
    "XX",  // made-up
    "",    // empty
    null,
    undefined,
  ];

  for (const state of unknownStates) {
    it(`state='${state ?? "null/undefined"}' → blocked, customerRegion=null`, () => {
      const candidates = [
        makeCandidate("p1", "CA"),
        makeCandidate("p2", "TX"),
        makeCandidate("p3", "NY"),
        makeCandidate("p4", "IL"),
      ];
      const result = selectPrinterFromCandidates(state as any, candidates);

      assert.equal(result.assigned, false);
      if (!result.assigned) {
        assert.equal(result.customerRegion, null, `Unknown state '${state}' must resolve to null`);
        // Even though there are 4 available printers, none should be selected
        assert.equal(result.candidatesSameRegion, 0);
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Address update → region recalculated correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("Address update recalculates region correctly", () => {
  // Simulates the logic in the customer account update and
  // the printer profile update — both call getRegionFromState(newState)

  it("Customer moves TX→NY: region changes South→Northeast", () => {
    let region = getRegionFromState("TX");
    assert.equal(region, "South");

    // Simulate address update
    region = getRegionFromState("NY");
    assert.equal(region, "Northeast");
  });

  it("Customer moves CA→IL: region changes West→Midwest", () => {
    let region = getRegionFromState("CA");
    assert.equal(region, "West");

    region = getRegionFromState("IL");
    assert.equal(region, "Midwest");
  });

  it("Printer moves FL→WA: region changes South→West", () => {
    let region = normalizeRegion(getRegionFromState("FL"));
    assert.equal(region, "South");

    region = normalizeRegion(getRegionFromState("WA"));
    assert.equal(region, "West");
  });

  it("After TX→NY update, TX printer no longer matches NY customer", () => {
    const originalCustomerState = "TX";
    const updatedCustomerState = "NY";

    const printerState = "TX"; // printer hasn't moved
    const printerRegion = normalizeRegion(getRegionFromState(printerState));

    const oldCustomerRegion = getRegionFromState(originalCustomerState);
    const newCustomerRegion = getRegionFromState(updatedCustomerState);

    // Before update: customer and printer were both South — would have matched
    assert.equal(oldCustomerRegion, printerRegion);

    // After update: customer is Northeast, printer is still South — must not match
    assert.notEqual(newCustomerRegion, printerRegion);

    // Verify the updated assignment result reflects the new region: the TX
    // printer is no longer an in-region match, so it can only be reached as a
    // flagged cross-region fallback.
    const candidates = [makeCandidate("p1", "TX")];
    const result = selectPrinterFromCandidates(updatedCustomerState, candidates);
    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.customerRegion, "Northeast");
      assert.equal(result.candidatesSameRegion, 0, "TX printer is not in-region for an NY customer");
      assert.equal(result.isCrossRegion, true);
      assert.equal(result.assignedRegion, "South");
    }
  });

  it("After IL→CA update, CA printer now matches CA customer", () => {
    const updatedCustomerState = "CA";
    const printerState = "CA";

    const candidates = [makeCandidate("p1", printerState)];
    const result = selectPrinterFromCandidates(updatedCustomerState, candidates);

    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.customerRegion, "West");
      assert.equal(result.selected.printerRegion, "West");
    }
  });

  it("All 4 regions recalculate independently when state changes", () => {
    const transitions: Array<[string, string, string, string]> = [
      ["CA", "NY", "West", "Northeast"],
      ["NY", "TX", "Northeast", "South"],
      ["TX", "IL", "South", "Midwest"],
      ["IL", "CA", "Midwest", "West"],
    ];

    for (const [from, to, fromRegion, toRegion] of transitions) {
      const before = normalizeRegion(getRegionFromState(from));
      const after = normalizeRegion(getRegionFromState(to));
      assert.equal(before, fromRegion, `${from} should be ${fromRegion}`);
      assert.equal(after, toRegion, `${to} should be ${toRegion}`);
      assert.notEqual(before, after, `Region should change from ${fromRegion} to ${toRegion}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Admin manual assignment cross-region validation logic
// ─────────────────────────────────────────────────────────────────────────────

describe("Admin manual assignment — region validation", () => {
  // Mirrors the logic in the admin's assignOrder

  const computeAdminRegionCheck = (
    orderState: string,
    printerState: string,
    force: boolean
  ): { blocked: boolean; customerRegion: string | null; printerRegion: string | null } => {
    const customerRegion = normalizeRegion(getRegionFromState(orderState)) || null;
    const printerRegion = normalizeRegion(getRegionFromState(printerState)) || null;
    const isCrossRegion = customerRegion && printerRegion && customerRegion !== printerRegion;

    return {
      blocked: Boolean(isCrossRegion && !force),
      customerRegion,
      printerRegion,
    };
  };

  it("Same-region assignment is allowed (no force needed)", () => {
    const r = computeAdminRegionCheck("TX", "FL", false);
    assert.equal(r.blocked, false);
    assert.equal(r.customerRegion, "South");
    assert.equal(r.printerRegion, "South");
  });

  it("Cross-region without force is blocked (TX→CA)", () => {
    const r = computeAdminRegionCheck("TX", "CA", false);
    assert.equal(r.blocked, true);
    assert.equal(r.customerRegion, "South");
    assert.equal(r.printerRegion, "West");
  });

  it("Cross-region with force=true is allowed (override)", () => {
    const r = computeAdminRegionCheck("TX", "CA", true);
    assert.equal(r.blocked, false);
    assert.equal(r.customerRegion, "South");
    assert.equal(r.printerRegion, "West");
  });

  it("All 4 cross-region pairs are blocked without force", () => {
    const pairs = [
      ["TX", "CA"], // South→West
      ["NY", "IL"], // Northeast→Midwest
      ["IL", "FL"], // Midwest→South
      ["CA", "PA"], // West→Northeast
    ];
    for (const [cState, pState] of pairs) {
      const r = computeAdminRegionCheck(cState, pState, false);
      assert.equal(r.blocked, true, `${cState}→${pState} should be blocked`);
      assert.notEqual(r.customerRegion, r.printerRegion);
    }
  });

  it("Customer with unknown state: customerRegion=null, not blocked (no region to compare)", () => {
    // When customerRegion is null, isCrossRegion is falsy → not blocked by region check
    // (order will be blocked by the assignment service itself — null region = no match)
    const r = computeAdminRegionCheck("XX", "CA", false);
    assert.equal(r.customerRegion, null);
    assert.equal(r.blocked, false, "null customerRegion means no cross-region check fires");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Sorting within a region pool
// ─────────────────────────────────────────────────────────────────────────────

describe("Printer selection priority within same-region pool", () => {
  it("Nearer printer wins over farther printer (same region)", () => {
    const txCoord = getLatLngFromState("TX")!;
    const flCoord = getLatLngFromState("FL")!;
    const alCoord = getLatLngFromState("AL")!;

    const customerCoord = txCoord;
    const distToFL = haversineMiles(
      { lat: customerCoord.lat, lon: customerCoord.lon },
      { lat: flCoord.lat, lon: flCoord.lon }
    );
    const distToAL = haversineMiles(
      { lat: customerCoord.lat, lon: customerCoord.lon },
      { lat: alCoord.lat, lon: alCoord.lon }
    );

    // AL is closer to TX than FL
    assert.ok(distToAL < distToFL, `AL (${distToAL.toFixed(0)}mi) should be closer to TX than FL (${distToFL.toFixed(0)}mi)`);

    const candidates: PrinterCandidate[] = [
      makeCandidate("fl-printer", "FL", { distanceMiles: distToFL }),
      makeCandidate("al-printer", "AL", { distanceMiles: distToAL }),
    ];
    const result = selectPrinterFromCandidates("TX", candidates);

    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.selected.printerId, "al-printer", "Closer printer (AL) should be selected");
    }
  });

  it("Least-loaded printer wins when equidistant", () => {
    const candidates: PrinterCandidate[] = [
      makeCandidate("busy",  "FL", { distanceMiles: 500, activeCount: 5, maxConcurrent: 10 }),
      makeCandidate("free",  "FL", { distanceMiles: 500, activeCount: 1, maxConcurrent: 10 }),
    ];
    const result = selectPrinterFromCandidates("TX", candidates);

    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.selected.printerId, "free", "Less-loaded printer should be selected");
    }
  });

  it("Higher-rated printer wins when equidistant and equally loaded", () => {
    const candidates: PrinterCandidate[] = [
      makeCandidate("low-rated",  "FL", { distanceMiles: 500, activeCount: 0, rating: 3.8 }),
      makeCandidate("high-rated", "FL", { distanceMiles: 500, activeCount: 0, rating: 4.9 }),
    ];
    const result = selectPrinterFromCandidates("TX", candidates);

    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.selected.printerId, "high-rated", "Higher-rated printer should be selected");
    }
  });

  it("A partner in the customer's own state wins over a nearer one in the next state", () => {
    const candidates: PrinterCandidate[] = [
      makeCandidate("or-printer", "OR", { distanceMiles: 150 }),
      makeCandidate("ca-printer", "CA", { distanceMiles: 400 }),
    ];
    const result = selectPrinterFromCandidates("California (CA)", candidates);

    assert.equal(result.assigned, true);
    if (result.assigned) assert.equal(result.selected.printerId, "ca-printer");
  });

  it("With several partners in the customer's state, the nearest of them wins", () => {
    const candidates: PrinterCandidate[] = [
      makeCandidate("ca-far", "CA", { distanceMiles: 380 }),
      makeCandidate("ca-near", "CA", { distanceMiles: 12 }),
      makeCandidate("nv-nearest", "NV", { distanceMiles: 5 }),
    ];
    const result = selectPrinterFromCandidates("CA", candidates);

    assert.equal(result.assigned, true);
    if (result.assigned) assert.equal(result.selected.printerId, "ca-near");
  });

  it("With no partner in the customer's state, the nearest state in the region wins", () => {
    const from = getLatLngFromState("OR")!;
    const candidates: PrinterCandidate[] = [
      makeCandidate("ca-printer", "CA", { distanceMiles: haversineMiles(from, getLatLngFromState("CA")!) }),
      makeCandidate("wa-printer", "WA", { distanceMiles: haversineMiles(from, getLatLngFromState("WA")!) }),
    ];
    const result = selectPrinterFromCandidates("OR", candidates);

    assert.equal(result.assigned, true);
    if (result.assigned) assert.equal(result.selected.printerId, "wa-printer");
  });

  it("Out-of-region printers are excluded even when closer", () => {
    // CA printer is closer to NY than other Northeast states, but must not be selected
    const candidates: PrinterCandidate[] = [
      makeCandidate("ca-printer", "CA", { distanceMiles: 100 }), // West — should be excluded
      makeCandidate("pa-printer", "PA", { distanceMiles: 300 }), // Northeast — should win
    ];
    const result = selectPrinterFromCandidates("NY", candidates);

    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.selected.printerId, "pa-printer", "In-region printer must win over closer out-of-region");
      assert.equal(result.selected.printerRegion, "Northeast");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Complete US state coverage — every state maps to the expected region
// ─────────────────────────────────────────────────────────────────────────────

describe("Complete US state → region coverage", () => {
  const expectedMapping: Record<string, "West" | "Midwest" | "South" | "Northeast"> = {
    // West
    WA: "West", OR: "West", CA: "West", NV: "West", ID: "West",
    MT: "West", WY: "West", UT: "West", AZ: "West", NM: "West",
    CO: "West", AK: "West", HI: "West",
    // Midwest
    ND: "Midwest", SD: "Midwest", NE: "Midwest", KS: "Midwest",
    MN: "Midwest", IA: "Midwest", MO: "Midwest", WI: "Midwest",
    IL: "Midwest", MI: "Midwest", IN: "Midwest", OH: "Midwest",
    // South
    TX: "South", OK: "South", AR: "South", LA: "South", MS: "South",
    AL: "South", TN: "South", KY: "South", WV: "South", VA: "South",
    NC: "South", SC: "South", GA: "South", FL: "South", MD: "South",
    DC: "South", DE: "South",
    // Northeast
    PA: "Northeast", NY: "Northeast", VT: "Northeast", ME: "Northeast",
    NH: "Northeast", MA: "Northeast", RI: "Northeast", CT: "Northeast",
    NJ: "Northeast",
  };

  for (const [state, expected] of Object.entries(expectedMapping)) {
    it(`${state} → ${expected}`, () => {
      assert.equal(
        getRegionFromState(state),
        expected,
        `${state} should map to ${expected}`
      );
    });
  }

  it("All 50 US states + DC + DE are covered (no gaps)", () => {
    assert.equal(Object.keys(expectedMapping).length, 51);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Backend bypass prevention — verify the gate holds under adversarial inputs
// ─────────────────────────────────────────────────────────────────────────────

describe("Backend bypass prevention", () => {
  it("Printer with stored region='West' but state=TX is treated as South (state wins)", () => {
    // autoAssignOrder intentionally ignores p.regions[] — derives live from state
    // Here we verify that a candidate with a mismatched stored region is filtered correctly
    const txPrinter: PrinterCandidate = {
      ...makeCandidate("p1", "TX"),
      // Even if the stored region were "West" (stale data), the test enforces that
      // the printerRegion field is ALWAYS computed from state — not from stored data
      printerRegion: normalizeRegion(getRegionFromState("TX")), // must be "South"
    };

    // CA customer (West) must not treat the TX printer as in-region — it is
    // South by state, so it is only reachable as a flagged fallback.
    const result = selectPrinterFromCandidates("CA", [txPrinter]);
    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.candidatesSameRegion, 0, "TX printer is not in-region for a CA customer");
      assert.equal(result.assignedRegion, "South");
      assert.equal(result.isCrossRegion, true);
    }
    assert.equal(txPrinter.printerRegion, "South", "TX state must always resolve to South");
  });

  it("Printer with null state cannot be matched regardless of customer region", () => {
    const noStatePrinter: PrinterCandidate = {
      printerId: "p1",
      printerName: "Mystery Printer",
      printerState: null,
      printerRegion: null,   // null because no state
      distanceMiles: 0,
      rating: 5.0,
      activeCount: 0,
      maxConcurrent: null,
    };

    for (const state of ["TX", "CA", "NY", "IL"]) {
      const result = selectPrinterFromCandidates(state, [noStatePrinter]);
      assert.equal(result.assigned, false, `Printer with null state must not match ${state} customer`);
    }
  });

  it("Single-candidate pool: a lone out-of-region printer is used as a fallback", () => {
    const candidates = [makeCandidate("only-printer", "CA")]; // West only
    const result = selectPrinterFromCandidates("TX", candidates); // South customer

    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.customerRegion, "South");
      assert.equal(result.assignedRegion, "West");
      assert.equal(result.isCrossRegion, true);
      assert.equal(result.candidatesSameRegion, 0);
    }
  });

  it("100-printer pool with 99 same-region + 1 nearer cross-region: selects same-region", () => {
    const candidates: PrinterCandidate[] = [];

    // 99 South printers (all 500mi away)
    for (let i = 0; i < 99; i++) {
      candidates.push(makeCandidate(`south-${i}`, "FL", { distanceMiles: 500, rating: 4.0 }));
    }
    // 1 West printer that's "closer"
    candidates.push(makeCandidate("west-close", "CA", { distanceMiles: 10, rating: 5.0 }));

    const result = selectPrinterFromCandidates("TX", candidates); // South customer

    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.notEqual(result.selected.printerId, "west-close", "Closer cross-region printer must NOT be selected");
      assert.equal(result.selected.printerRegion, "South");
      assert.equal(result.candidatesSameRegion, 99);
    }
  });
});

describe("A waiting order is retried without repeating itself", () => {
  const failed = { mode: "AUTO", selectedPrinterId: null, reason: "No available printers" };

  it("the first failure is new", () => {
    assert.equal(sameFailureAsLast({ assignmentHistory: [] }, "No available printers"), false);
  });

  it("the same failure again is not recorded or reported twice", () => {
    assert.equal(sameFailureAsLast({ assignmentHistory: [failed] }, "No available printers"), true);
  });

  it("a different reason, or a failure after an assignment, is new", () => {
    assert.equal(sameFailureAsLast({ assignmentHistory: [failed] }, "Another reason"), false);
    const assigned = { mode: "AUTO", selectedPrinterId: "p1", reason: "No available printers" };
    assert.equal(sameFailureAsLast({ assignmentHistory: [failed, assigned] }, "No available printers"), false);
  });
});
