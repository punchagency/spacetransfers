import { describe, expect, it } from "vitest";
import { autoNestWouldUndoRotation, calculateGridLayout } from "../components/artboard/lib/utils/layoutHelpers";

/**
 * With auto-nest on, a quarter turn the packer disagrees with was undone by its
 * own quarter turn, leaving the footprint put and the artwork upside down.
 * Rotate now asks first and declines with a message; auto-nest is unchanged.
 */
const SHEET = 23.5;
const MARGIN = 0.15;
const GAP = 0.25;
const piece = (over: any = {}) => ({
  id: 1, url: "x", rotation: 0, locked: false, expanded: false, flipped: false, autoCrop: false,
  copies: 1, widthIn: 4, heightIn: 1, posX: MARGIN, posY: MARGIN, linked: true, price: 0, ...over,
});
// The board as auto-nest leaves it, which is what Rotate sees.
const nested = (items: any[]) => calculateGridLayout(items, SHEET, GAP, true, MARGIN) as any[];

describe("rotate with auto-nest on", () => {
  it("reports a conflict when auto-nest would turn the piece straight back", () => {
    const board = nested([piece()]);
    expect(autoNestWouldUndoRotation(board, new Set([1]), SHEET, GAP, MARGIN)).toBe(true);
  });

  it("also for a piece auto-nest had already turned", () => {
    const board = nested([piece({ widthIn: 10.8, heightIn: 16.3 })]);
    expect(board[0].nestRotation).toBe(90);
    expect(autoNestWouldUndoRotation(board, new Set([1]), SHEET, GAP, MARGIN)).toBe(true);
  });

  it("lets a square turn — auto-nest never turns one back", () => {
    const board = nested([piece({ widthIn: 3, heightIn: 3 })]);
    expect(autoNestWouldUndoRotation(board, new Set([1]), SHEET, GAP, MARGIN)).toBe(false);
  });

  it("has nothing to say about an empty selection, and leaves the board untouched", () => {
    const board = nested([piece()]);
    const snapshot = JSON.stringify(board);
    expect(autoNestWouldUndoRotation(board, new Set(), SHEET, GAP, MARGIN)).toBe(false);
    autoNestWouldUndoRotation(board, new Set([1]), SHEET, GAP, MARGIN);
    expect(JSON.stringify(board)).toBe(snapshot);
  });
});
