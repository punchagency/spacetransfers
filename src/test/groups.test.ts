import { describe, expect, it } from "vitest";
import {
  calculateGridLayout,
  collapseGroups,
  fitGroupsToPrintableArea,
  flipGroupHorizontally,
  footprintBounds,
  planLocalDisplacement,
  resolveDragPlacement,
  rotateGroupClockwise,
} from "../components/artboard/lib/utils/layoutHelpers";

const SHEET = 23.5;
const MARGIN = 0.15;
const GAP = 0.25;

const piece = (id: number, widthIn: number, heightIn: number, posX: number, posY: number, extra: Record<string, unknown> = {}): any => ({
  id, widthIn, heightIn, posX, posY, copies: 1, rotation: 0, ...extra,
});

/** Where each member sits relative to the first — what "kept together" means. */
const offsets = (members: any[]) => members.map((m) => [+(m.posX - members[0].posX).toFixed(4), +(m.posY - members[0].posY).toFixed(4)]);

describe("collapseGroups", () => {
  it("stands each group in for its members as one rigid block", () => {
    const items = [piece(1, 2, 2, 5, 5, { groupId: "g" }), piece(2, 3, 1, 8, 5, { groupId: "g" }), piece(3, 4, 4, 0.15, 10)];
    const collapsed = collapseGroups(items, SHEET, MARGIN, GAP);
    expect(collapsed.hasGroups).toBe(true);
    expect(collapsed.items).toHaveLength(2);
    const unit = collapsed.items.find((it) => it.rigid)!;
    expect([unit.posX, unit.posY, unit.widthIn, unit.heightIn]).toEqual([5, 5, 6, 2]);
    expect(collapsed.unitOf(1)).toBe(unit.id);
    expect(collapsed.unitOf(3)).toBe(3);
  });

  it("ignores a group of one", () => {
    expect(collapseGroups([piece(1, 2, 2, 5, 5, { groupId: "g" })], SHEET, MARGIN, GAP).hasGroups).toBe(false);
  });
});

describe("auto-nest keeps a group together", () => {
  it("moves the members by one offset and never turns them", () => {
    // Laid out awkwardly far down the sheet, beside loose pieces.
    const group = [piece(1, 3, 5, 10, 40, { groupId: "g" }), piece(2, 5, 3, 13.5, 40, { groupId: "g" })];
    const loose = [piece(3, 6, 6, 0.15, 0.15), piece(4, 10.83, 16.25, 7, 0.15)];
    const packed = calculateGridLayout([...group, ...loose], SHEET, GAP, true, MARGIN) as any[];
    const members = packed.filter((it) => it.groupId === "g");
    expect(offsets(members)).toEqual(offsets(group));
    expect(members.every((m) => (m.nestRotation ?? 0) === 0)).toBe(true);
    // Nested up the sheet rather than left where it was.
    expect(members[0].posY).toBeLessThan(40);
  });
});

describe("making room keeps a group together", () => {
  it("displaces a whole group, not one member of it", () => {
    const group = [piece(1, 3, 3, 0.15, 0.15, { groupId: "g" }), piece(2, 3, 3, 3.4, 0.15, { groupId: "g" })];
    // Dropped on top of the first member.
    const dropped = piece(9, 3, 3, 0.15, 0.15);
    const moves = planLocalDisplacement([...group, dropped], [9], SHEET, MARGIN, GAP);
    // Both members move, by the same offset: the group slides aside as one.
    const m1 = moves.get(1)!;
    const m2 = moves.get(2)!;
    expect(m1).toBeDefined();
    expect(m2).toBeDefined();
    expect(+(m2.posX - m1.posX).toFixed(4)).toBe(3.25);
    expect(+(m2.posY - m1.posY).toFixed(4)).toBe(0);
    expect(moves.has(9)).toBe(false);
  });

  it("lets a group's own members sit closer than the spacing", () => {
    // Arranged by hand 0.05in apart; dragging the group must not be refused for it.
    const group = [piece(1, 3, 3, 2, 2, { groupId: "g" }), piece(2, 3, 3, 5.05, 2, { groupId: "g" })];
    expect(resolveDragPlacement(group, [1, 2], SHEET, MARGIN, GAP).valid).toBe(true);
  });
});

describe("rotateGroupClockwise", () => {
  it("turns every member and swings the arrangement around the group's centre", () => {
    // Side by side: A left, B right. A quarter turn clockwise puts A above B.
    const a = piece(1, 2, 1, 2, 2, { groupId: "g" });
    const b = piece(2, 2, 1, 4.5, 2, { groupId: "g" });
    const before = footprintBounds([a, b], SHEET, MARGIN, GAP);
    const [ra, rb] = rotateGroupClockwise([a, b], SHEET, MARGIN, GAP);
    expect([ra.rotation, rb.rotation]).toEqual([90, 90]);
    expect([ra.widthIn, ra.heightIn]).toEqual([1, 2]);
    expect(ra.posY).toBeLessThan(rb.posY);
    expect(ra.posX).toBeCloseTo(rb.posX);
    // Same centre after the turn.
    const after = footprintBounds([ra, rb], SHEET, MARGIN, GAP);
    expect(after.x + after.w / 2).toBeCloseTo(before.x + before.w / 2);
    expect(after.y + after.h / 2).toBeCloseTo(before.y + before.h / 2);
  });

  it("returns to where it started after four turns", () => {
    let group = [piece(1, 2, 1, 2, 2, { groupId: "g" }), piece(2, 1, 3, 4.5, 2.5, { groupId: "g" })];
    const start = group.map((m) => [m.posX, m.posY, m.widthIn, m.heightIn]);
    for (let i = 0; i < 4; i++) group = rotateGroupClockwise(group, SHEET, MARGIN, GAP) as any;
    group.forEach((m, i) => {
      expect(m.rotation).toBe(0);
      expect(m.posX).toBeCloseTo(start[i][0]);
      expect(m.posY).toBeCloseTo(start[i][1]);
    });
  });
});

describe("flipGroupHorizontally", () => {
  it("mirrors positions across the group and flips every member", () => {
    const a = piece(1, 2, 1, 2, 2, { groupId: "g" });
    const b = piece(2, 1, 1, 5, 2, { groupId: "g" });
    const [fa, fb] = flipGroupHorizontally([a, b], SHEET, MARGIN, GAP) as any[];
    expect([fa.flipped, fb.flipped]).toEqual([true, true]);
    // B was on the right edge of the group; now it is on the left.
    expect(fb.posX).toBeCloseTo(2);
    expect(fa.posX).toBeCloseTo(4);
    // Flipping twice is the original.
    const [ga, gb] = flipGroupHorizontally([fa, fb], SHEET, MARGIN, GAP) as any[];
    expect([ga.posX, gb.posX, ga.flipped, gb.flipped]).toEqual([2, 5, false, false]);
  });
});

describe("fitGroupsToPrintableArea", () => {
  it("brings a group back inside the margins with one offset", () => {
    // Hanging off the right edge and into the top margin.
    const group = [piece(1, 4, 2, 18, 0, { groupId: "g" }), piece(2, 3, 2, 22.5, 1, { groupId: "g" })];
    const { items, movedIds } = fitGroupsToPrintableArea(group, SHEET, MARGIN, GAP);
    expect(movedIds.size).toBe(2);
    expect(offsets(items)).toEqual(offsets(group));
    const box = footprintBounds(items, SHEET, MARGIN, GAP);
    expect(box.x + box.w).toBeLessThanOrEqual(SHEET - MARGIN + 1e-6);
    expect(box.y).toBeGreaterThanOrEqual(MARGIN - 1e-6);
  });

  it("leaves a group that already fits exactly as it is", () => {
    const group = [piece(1, 2, 2, 3, 3, { groupId: "g" }), piece(2, 2, 2, 6, 3, { groupId: "g" })];
    const result = fitGroupsToPrintableArea(group, SHEET, MARGIN, GAP);
    expect(result.items).toBe(group);
    expect(result.movedIds.size).toBe(0);
  });
});
