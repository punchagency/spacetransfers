import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * The orders table opens on unassigned orders, because they are the only kind
 * that needs an admin to act.
 *
 * Sorting the fetched page in the browser would not achieve it: the list uses
 * keyset pagination, so an unassigned order sitting on page three stays on page
 * three. MongoDB cannot sort a `find()` on a computed flag either, and sorting
 * on `assignedPrinter` itself groups the assigned rows by partner ObjectId
 * rather than by recency. So the two blocks are paged separately and the cursor
 * records which block it left off in.
 *
 * The cursor is the fragile part — get it wrong and rows are silently skipped or
 * repeated — so its parsing is pinned here.
 */

/** Mirrors the cursor parsing in getAllOrders. */
const parseCursor = (cursor: string | undefined) => {
  if (!cursor || typeof cursor !== "string" || !cursor.includes("_")) {
    return { block: "u" as const, hasFilter: false, ts: null as number | null, id: null as string | null };
  }
  const parts = cursor.split("_");
  const [blockRaw, tsRaw, idRaw] = parts.length >= 3 ? parts : ["a", parts[0], parts[1]];
  const ts = Number(tsRaw);
  const validId = typeof idRaw === "string" && /^[0-9a-fA-F]{24}$/.test(idRaw);
  if ((blockRaw === "u" || blockRaw === "a") && Number.isFinite(ts) && validId) {
    return { block: blockRaw as "u" | "a", hasFilter: true, ts, id: idRaw };
  }
  return { block: "u" as const, hasFilter: false, ts: null, id: null };
};

const OID = "6a845603e0d5b5d73e33c64a";

describe("orders cursor carries its block", () => {
  it("starts in the unassigned block when there is no cursor", () => {
    const c = parseCursor(undefined);
    assert.equal(c.block, "u");
    assert.equal(c.hasFilter, false);
  });

  it("round-trips an unassigned cursor", () => {
    const c = parseCursor(`u_1756600000000_${OID}`);
    assert.equal(c.block, "u");
    assert.equal(c.ts, 1756600000000);
    assert.equal(c.id, OID);
    assert.equal(c.hasFilter, true);
  });

  it("round-trips an assigned cursor", () => {
    const c = parseCursor(`a_1756600000000_${OID}`);
    assert.equal(c.block, "a");
    assert.equal(c.hasFilter, true);
  });

  it("treats a two-part cursor as the assigned block", () => {
    // Emitted before unassigned-first ordering existed; a tab open across the
    // deploy must not skip rows or restart from the top.
    const c = parseCursor(`1756600000000_${OID}`);
    assert.equal(c.block, "a");
    assert.equal(c.ts, 1756600000000);
    assert.equal(c.id, OID);
  });

  it("falls back to the first page rather than trusting a malformed cursor", () => {
    for (const bad of ["_", "x_1_2", `z_1756600000000_${OID}`, "u_notanumber_" + OID, `u_1756600000000_nope`]) {
      const c = parseCursor(bad);
      assert.equal(c.hasFilter, false, bad);
      assert.equal(c.block, "u", bad);
    }
  });
});

describe("which block a row belongs to", () => {
  // The next cursor must continue from the block of the LAST returned row, not
  // the block the request started in — a page can span the boundary.
  const blockOf = (row: { assignedPrinter?: unknown } | undefined) =>
    row && row.assignedPrinter ? "a" : "u";

  it("reads a row with no partner as unassigned", () => {
    assert.equal(blockOf({ assignedPrinter: null }), "u");
    assert.equal(blockOf({}), "u");
  });

  it("reads a row with a partner as assigned", () => {
    assert.equal(blockOf({ assignedPrinter: OID }), "a");
  });

  it("follows the last row when a page spans both blocks", () => {
    // Two unassigned then three assigned: the cursor must say "a", or the next
    // page would re-read the unassigned block and repeat rows.
    const pageRows = [
      { assignedPrinter: null },
      { assignedPrinter: null },
      { assignedPrinter: OID },
      { assignedPrinter: OID },
      { assignedPrinter: OID }
    ];
    assert.equal(blockOf(pageRows[pageRows.length - 1]), "a");
  });

  it("stays in the unassigned block while the page is entirely unassigned", () => {
    const pageRows = [{ assignedPrinter: null }, { assignedPrinter: null }];
    assert.equal(blockOf(pageRows[pageRows.length - 1]), "u");
  });
});
