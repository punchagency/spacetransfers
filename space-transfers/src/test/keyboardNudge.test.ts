import { describe, expect, it } from "vitest";
import { describeArtwork, nudgeFor, nudgedPosition, resizedWidth } from "../lib/utils/keyboardNudge";

describe("moving artwork from the keyboard", () => {
  it("steps to the next grid line when the grid is on, so snapping can't undo it", () => {
    expect(nudgedPosition(1, 0.1, null)).toBe(1.1);
    expect(nudgedPosition(1, 0.1, 0.25)).toBe(1.25);
    expect(nudgedPosition(1, -0.1, 0.25)).toBe(0.75);
    expect(nudgedPosition(1.1, 0.1, 0.25)).toBe(1.25);
    expect(nudgedPosition(1.1, -0.1, 0.25)).toBe(1);
    expect(nudgedPosition(1, 1, 0.25)).toBe(2);
  });

  it("moves a tenth of an inch, an inch with Shift", () => {
    expect(nudgeFor("ArrowRight", false)).toEqual({ kind: "move", axis: "posX", by: 0.1 });
    expect(nudgeFor("ArrowUp", true)).toEqual({ kind: "move", axis: "posY", by: -1 });
    expect(nudgeFor("a", false)).toBeNull();
  });

  it("resizes by 5% within sensible limits", () => {
    expect(nudgeFor("+", false)).toEqual({ kind: "resize", factor: 1.05 });
    expect(resizedWidth(4, 1.05, 23)).toBe(4.2);
    expect(resizedWidth(0.26, 1 / 1.05, 23)).toBe(0.25);
    expect(resizedWidth(22.9, 1.05, 23)).toBe(23);
  });

  it("describes artwork in words", () => {
    expect(describeArtwork({ name: "logo.png", widthIn: 3, heightIn: 2.5, copies: 4, locked: true })).toBe("logo.png, 3.00 by 2.50 inches, 4 copies, locked");
  });
});
