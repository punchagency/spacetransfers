import { describe, expect, it } from "vitest";
import { computeEffectiveDpi, dpiFromPixels, isLowDpi } from "../components/artboard/lib/utils/layoutHelpers";

describe("resolution is read on both sides of the image", () => {
  it("is the same either way for a piece in proportion", () => {
    expect(dpiFromPixels(1200, 900, 4, 3)).toBe(300);
  });

  it("is the weaker side for a piece stretched on one side", () => {
    // 420x300px drawn 1.4in wide but 3in tall: 300 across, 100 down.
    expect(dpiFromPixels(420, 300, 1.4, 3)).toBe(100);
    expect(dpiFromPixels(420, 300, 4.2, 1)).toBe(100);
  });

  it("does not turn a rounding difference in the height into a 299", () => {
    // Height stored to two decimals: 1767px / 5.89in is 299.99.
    expect(dpiFromPixels(1500, 1767, 5, 5.89)).toBe(300);
  });

  it("falls back to the width when the height is not known", () => {
    expect(dpiFromPixels(1200, null, 4, 3)).toBe(300);
  });
});

describe("a piece's reported resolution", () => {
  const piece = { url: "https://cdn/a.png", widthIn: 1.4, heightIn: 1, rotation: 0, nativeWidthPx: 420 };
  const measured = { measuredUrl: "https://cdn/a.png", measuredWidthPx: 420, measuredHeightPx: 300 };

  it("is unchanged for a piece in proportion", () => {
    expect(computeEffectiveDpi(piece)).toBe(300);
    expect(computeEffectiveDpi({ ...piece, ...measured })).toBe(300);
  });

  it("drops when one side is stretched, once the image has been measured", () => {
    const stretched = { ...piece, ...measured, heightIn: 3 };
    expect(computeEffectiveDpi(stretched)).toBe(100);
    expect(isLowDpi(stretched)).toBe(true);
  });

  it("handles a stretched piece that has been turned a quarter", () => {
    // Turned: the image's width now runs along heightIn.
    expect(computeEffectiveDpi({ ...piece, ...measured, rotation: 90, widthIn: 3, heightIn: 1.4 })).toBe(100);
  });

  it("ignores a measurement of an image the piece no longer shows", () => {
    expect(computeEffectiveDpi({ ...piece, ...measured, url: "https://cdn/edited.png", heightIn: 3 })).toBe(300);
  });

  it("uses the measurement when no pixel count was stored", () => {
    expect(computeEffectiveDpi({ url: "https://cdn/a.png", widthIn: 2.8, heightIn: 2, ...measured })).toBe(150);
  });
});
