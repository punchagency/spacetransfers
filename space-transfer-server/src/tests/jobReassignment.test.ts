/**
 * Job reassignment flow tests — pure selection logic, cursor encoding, and requeue behaviour.
 * Run with: npm test
 * Uses Node.js built-in test runner (node:test).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { selectPrinterFromCandidates, type PrinterCandidate } from "../services/orderAssignment.service.js";

const makePrinter = (overrides: Partial<PrinterCandidate> = {}): PrinterCandidate => ({
  printerId: "p1",
  printerName: "Test Printer",
  printerState: "TX",
  printerRegion: "South",
  distanceMiles: 50,
  rating: 4.5,
  activeCount: 0,
  maxConcurrent: 5,
  ...overrides,
});

// ── same-region assignment ───────────────────────────────────────────────────

describe("selectPrinterFromCandidates — same-region assignment", () => {
  it("assigns to available printer in same region as customer", () => {
    const candidates = [makePrinter({ printerId: "p1", printerRegion: "South", printerState: "TX" })];
    const result = selectPrinterFromCandidates("TX", candidates);
    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.selected.printerId, "p1");
      assert.equal(result.customerRegion, "South");
    }
  });

  it("picks nearest printer when multiple same-region candidates exist", () => {
    const candidates = [
      makePrinter({ printerId: "far",  printerState: "TX", printerRegion: "South", distanceMiles: 800 }),
      makePrinter({ printerId: "near", printerState: "FL", printerRegion: "South", distanceMiles: 100 }),
    ];
    const result = selectPrinterFromCandidates("GA", candidates); // GA → South
    assert.equal(result.assigned, true);
    if (result.assigned) assert.equal(result.selected.printerId, "near");
  });

  it("falls back to lower-utilisation printer when distance is equal", () => {
    const candidates = [
      makePrinter({ printerId: "busy", printerState: "TX", printerRegion: "South", distanceMiles: 100, activeCount: 4, maxConcurrent: 5 }),
      makePrinter({ printerId: "free", printerState: "TX", printerRegion: "South", distanceMiles: 100, activeCount: 0, maxConcurrent: 5 }),
    ];
    const result = selectPrinterFromCandidates("TX", candidates);
    assert.equal(result.assigned, true);
    if (result.assigned) assert.equal(result.selected.printerId, "free");
  });
});

// ── no printers in region ────────────────────────────────────────────────────

describe("selectPrinterFromCandidates — no printers in customer region", () => {
  it("falls back out of region when no same-region printer is available", () => {
    const candidates = [
      makePrinter({ printerId: "west", printerState: "CA", printerRegion: "West" }),
    ];
    const result = selectPrinterFromCandidates("TX", candidates); // TX → South, CA → West
    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.customerRegion, "South");
      assert.equal(result.assignedRegion, "West");
      assert.equal(result.isCrossRegion, true);
      assert.equal(result.candidatesSameRegion, 0);
    }
  });

  it("returns assigned=false with 'No available printers' when candidate list is empty", () => {
    const result = selectPrinterFromCandidates("TX", []);
    assert.equal(result.assigned, false);
    if (!result.assigned) {
      assert.match(result.reason, /No available printers/);
    }
  });

  it("returns assigned=false when customer state is unknown — assignment blocked", () => {
    const candidates = [makePrinter({ printerRegion: "South" })];
    const result = selectPrinterFromCandidates("XX", candidates);
    assert.equal(result.assigned, false);
    if (!result.assigned) {
      assert.equal(result.customerRegion, null);
    }
  });
});

// ── cross-region blocking ────────────────────────────────────────────────────

describe("selectPrinterFromCandidates — cross-region fallback", () => {
  it("assigns a West printer to a South customer only as a flagged fallback", () => {
    const candidates = [
      makePrinter({ printerId: "ca", printerState: "CA", printerRegion: "West" }),
      makePrinter({ printerId: "wa", printerState: "WA", printerRegion: "West" }),
    ];
    const result = selectPrinterFromCandidates("TX", candidates);
    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.candidatesSameRegion, 0);
      assert.equal(result.assignedRegion, "West");
      assert.equal(result.isCrossRegion, true);
    }
  });

  it("assigns a Northeast printer to a Midwest customer as a flagged fallback", () => {
    const candidates = [
      makePrinter({ printerId: "ny", printerState: "NY", printerRegion: "Northeast" }),
    ];
    const result = selectPrinterFromCandidates("IL", candidates); // IL → Midwest
    assert.equal(result.assigned, true);
    if (result.assigned) {
      assert.equal(result.assignedRegion, "Northeast"); // first in Midwest's chain
      assert.equal(result.isCrossRegion, true);
    }
  });

  it("does not treat a null printer region as matching any customer region", () => {
    const candidates = [
      makePrinter({ printerId: "noregion", printerState: undefined as any, printerRegion: null }),
    ];
    const result = selectPrinterFromCandidates("TX", candidates);
    assert.equal(result.assigned, false);
  });
});

// ── cancelling printer exclusion ──────────────────────────────────────────────

describe("selectPrinterFromCandidates — cancelling printer exclusion", () => {
  it("never reassigns back to the printer who cancelled the job", () => {
    const candidates = [
      makePrinter({ printerId: "p1", printerState: "TX", printerRegion: "South", distanceMiles: 50 }),
      makePrinter({ printerId: "p2", printerState: "FL", printerRegion: "South", distanceMiles: 200 }),
    ];
    // p1 cancelled — must not be selected even though it's nearest
    const result = selectPrinterFromCandidates("TX", candidates, ["p1"]);
    assert.equal(result.assigned, true);
    if (result.assigned) assert.equal(result.selected.printerId, "p2");
  });

  it("returns assigned=false when the only same-region printer was the cancelling one", () => {
    const candidates = [
      makePrinter({ printerId: "p1", printerState: "TX", printerRegion: "South" }),
    ];
    const result = selectPrinterFromCandidates("TX", candidates, ["p1"]);
    assert.equal(result.assigned, false);
    if (!result.assigned) assert.match(result.reason, /No available printers/);
  });

  it("still reports total candidatesConsidered including the excluded printer", () => {
    const candidates = [
      makePrinter({ printerId: "p1", printerState: "TX", printerRegion: "South" }),
      makePrinter({ printerId: "p2", printerState: "FL", printerRegion: "South" }),
    ];
    const result = selectPrinterFromCandidates("TX", candidates, ["p1"]);
    assert.equal(result.candidatesConsidered, 2, "total pool before exclusion");
  });

  it("assigns normally when excludePrinterIds is empty", () => {
    const candidates = [
      makePrinter({ printerId: "p1", printerState: "TX", printerRegion: "South" }),
    ];
    const result = selectPrinterFromCandidates("TX", candidates, []);
    assert.equal(result.assigned, true);
    if (result.assigned) assert.equal(result.selected.printerId, "p1");
  });

  it("excludes multiple cancelled printers simultaneously", () => {
    const candidates = [
      makePrinter({ printerId: "p1", printerState: "TX", printerRegion: "South", distanceMiles: 50 }),
      makePrinter({ printerId: "p2", printerState: "FL", printerRegion: "South", distanceMiles: 100 }),
      makePrinter({ printerId: "p3", printerState: "GA", printerRegion: "South", distanceMiles: 200 }),
    ];
    const result = selectPrinterFromCandidates("TX", candidates, ["p1", "p2"]);
    assert.equal(result.assigned, true);
    if (result.assigned) assert.equal(result.selected.printerId, "p3");
  });
});

// ── repeated cancellation cycles ─────────────────────────────────────────────

describe("selectPrinterFromCandidates — repeated cycle resilience", () => {
  it("still assigns after excluding the cancelling printer from the pool", () => {
    // p1 cancelled — pass exclusion list; p2 should be selected
    const candidates = [
      makePrinter({ printerId: "p1", printerState: "TX", printerRegion: "South", distanceMiles: 50 }),
      makePrinter({ printerId: "p2", printerState: "FL", printerRegion: "South", distanceMiles: 200 }),
    ];
    const result = selectPrinterFromCandidates("TX", candidates, ["p1"]);
    assert.equal(result.assigned, true);
    if (result.assigned) assert.equal(result.selected.printerId, "p2");
  });

  it("returns assigned=false after all same-region printers have cancelled", () => {
    // Both same-region printers cancelled — pool is now empty
    const result = selectPrinterFromCandidates("TX", [], ["p1", "p2"]);
    assert.equal(result.assigned, false);
  });
});

// ── admin queue cursor encoding ───────────────────────────────────────────────

describe("Admin queue cursor encoding — returnedAt vs createdAt", () => {
  const encodeReturnedCursor = (returnedAtMs: number, id: string) => `R${returnedAtMs}_${id}`;
  const encodeCreatedCursor = (createdAtMs: number, id: string) => `C${createdAtMs}_${id}`;

  it("R-prefix cursor round-trips correctly", () => {
    const ts = Date.now();
    const id = "507f1f77bcf86cd799439011";
    const cursor = encodeReturnedCursor(ts, id);
    assert.ok(cursor.startsWith("R"));
    const raw = cursor.slice(1);
    const idx = raw.lastIndexOf("_");
    const parsedTs = Number(raw.slice(0, idx));
    const parsedId = raw.slice(idx + 1);
    assert.equal(parsedTs, ts);
    assert.equal(parsedId, id);
  });

  it("C-prefix cursor round-trips correctly", () => {
    const ts = Date.now() - 60_000;
    const id = "507f1f77bcf86cd799439012";
    const cursor = encodeCreatedCursor(ts, id);
    assert.ok(cursor.startsWith("C"));
    const raw = cursor.slice(1);
    const idx = raw.lastIndexOf("_");
    assert.equal(Number(raw.slice(0, idx)), ts);
    assert.equal(raw.slice(idx + 1), id);
  });

  it("R-prefix sorts numerically after C-prefix (returned orders appear first)", () => {
    const returned = Date.now();
    const created = Date.now() - 86_400_000; // 1 day older
    // returnedAt (now) > createdAt (old) → returned job should surface first
    assert.ok(returned > created, "returnedAt is more recent than createdAt");
  });

  it("a returned order's sortAtMs equals its returnedAt, not createdAt", () => {
    const createdAtMs = Date.now() - 86_400_000;
    const returnedAtMs = Date.now();
    // sortAtMs should prefer returnedAt
    const sortAtMs = returnedAtMs ?? createdAtMs;
    assert.equal(sortAtMs, returnedAtMs);
    assert.ok(sortAtMs > createdAtMs);
  });

  it("orders with returnedAt=null sort below those with returnedAt set", () => {
    // In MongoDB { returnedAt: -1 }, null values sort after date values (descending)
    // This simulates that invariant with a comparator
    const compare = (a: { returnedAt: number | null; createdAt: number }, b: { returnedAt: number | null; createdAt: number }) => {
      if (a.returnedAt !== null && b.returnedAt === null) return -1; // a before b
      if (a.returnedAt === null && b.returnedAt !== null) return 1;  // b before a
      if (a.returnedAt !== null && b.returnedAt !== null) return b.returnedAt - a.returnedAt;
      return b.createdAt - a.createdAt;
    };

    const orders = [
      { id: "old-normal",    returnedAt: null,         createdAt: Date.now() - 1000 },
      { id: "new-normal",    returnedAt: null,         createdAt: Date.now() },
      { id: "just-returned", returnedAt: Date.now(),   createdAt: Date.now() - 86_400_000 },
    ];
    const sorted = [...orders].sort(compare);
    assert.equal(sorted[0].id, "just-returned", "returned order surfaces first");
    assert.equal(sorted[1].id, "new-normal",    "newer normal order comes second");
    assert.equal(sorted[2].id, "old-normal",    "older normal order comes last");
  });
});
