import { describe, it, expect } from "vitest";

/**
 * Select-all in the Assign Orders modal, extracted so the two defects it had
 * can be pinned. Both came from comparing set *size* against the filtered
 * length instead of checking membership.
 */

type Row = { id: string };

export const allFilteredSelected = (filtered: Row[], selected: Set<string>) =>
  filtered.length > 0 && filtered.every((o) => selected.has(o.id));

export const toggleAll = (filtered: Row[], selected: Set<string>): Set<string> => {
  const next = new Set(selected);
  if (allFilteredSelected(filtered, selected)) filtered.forEach((o) => next.delete(o.id));
  else filtered.forEach((o) => next.add(o.id));
  return next;
};

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe("select all", () => {
  it("selects every visible row", () => {
    expect([...toggleAll(rows("a", "b", "c"), new Set())]).toEqual(["a", "b", "c"]);
  });

  it("clears them again when all are already selected", () => {
    expect([...toggleAll(rows("a", "b"), new Set(["a", "b"]))]).toEqual([]);
  });

  it("keeps selections that the current search hides", () => {
    // Chose 'a' with no search, then searched so only 'b' matches.
    // The old code replaced the set and dropped 'a' without saying so.
    const next = toggleAll(rows("b"), new Set(["a"]));
    expect([...next].sort()).toEqual(["a", "b"]);
  });

  it("does not report 'all selected' when the counts match but the rows differ", () => {
    // One selected, one visible, different row — the old size check said true,
    // so the control read "Clear" and wiped an invisible selection.
    expect(allFilteredSelected(rows("b"), new Set(["a"]))).toBe(false);
  });

  it("clears only the visible rows, leaving hidden selections alone", () => {
    const next = toggleAll(rows("b"), new Set(["a", "b"]));
    expect([...next]).toEqual(["a"]);
  });

  it("is never 'all selected' when nothing is visible", () => {
    // Otherwise an empty filtered list reads as fully selected.
    expect(allFilteredSelected([], new Set())).toBe(false);
    expect(allFilteredSelected([], new Set(["a"]))).toBe(false);
  });
});
