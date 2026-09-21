import { describe, expect, it } from "vitest";
import { describeWarning, summarizeCartWarnings } from "../lib/utils/checkoutWarnings";
import type { FadeVerdict } from "../components/artboard/lib/utils/fadeCheck";

/**
 * Checkout's "Design Validation" badge said "Review Warnings" whatever the cart
 * held. It now reports the artboard's own flags, per sheet.
 */
const piece = (url: string, widthIn: number, nativeWidthPx?: number) => ({ url, widthIn, heightIn: 2, rotation: 0, nativeWidthPx });
const clear: FadeVerdict = { hasFade: false, confidence: 1, kind: "none", reason: "", source: "heuristic" };
const faded: FadeVerdict = { hasFade: true, confidence: 0.9, kind: "fade", reason: "", source: "heuristic" };

describe("checkout warnings", () => {
  it("reports nothing for a clean cart", () => {
    const cart = [{ type: "gangsheet", items: [piece("a", 2, 900)] }];
    expect(summarizeCartWarnings(cart, new Map([["a", clear]]))).toEqual({ warnings: [], checking: false });
  });

  it("names the sheet and counts low-DPI, unreadable and see-through pieces separately", () => {
    const cart = [
      { type: "gangsheet", items: [piece("a", 2, 900)] },
      // 400px across 4in is 100 DPI; the second has no pixel count at all.
      { type: "gangsheet", items: [piece("b", 4, 400), { url: "c", widthIn: 2, heightIn: 2 }, piece("d", 2, 900)] },
    ];
    const verdicts = new Map([["a", clear], ["b", clear], ["c", clear], ["d", faded]]);
    const { warnings, checking } = summarizeCartWarnings(cart, verdicts);
    expect(checking).toBe(false);
    expect(warnings).toEqual([
      { sheet: 2, kind: "low-dpi", count: 1 },
      { sheet: 2, kind: "unknown-dpi", count: 1 },
      { sheet: 2, kind: "transparency", count: 1 },
    ]);
    expect(describeWarning(warnings[0], 2)).toBe(
      "Sheet 2: 1 image below 300 DPI at the printed size — may print soft or pixelated",
    );
    expect(describeWarning(warnings[1], 2)).toMatch(/check it's sharp$/);
    // With one sheet there is nothing to disambiguate.
    expect(describeWarning({ sheet: 1, kind: "transparency", count: 2 }, 1)).toMatch(/^2 images with fades/);
  });

  it("says it is still checking until every image has a transparency verdict", () => {
    const cart = [{ type: "gangsheet", items: [piece("a", 2, 900)] }];
    expect(summarizeCartWarnings(cart, new Map()).checking).toBe(true);
  });

  it("skips cart lines that are not sheets", () => {
    const cart = [{ type: "other", name: "Gift card" }, { type: "gangsheet", items: [piece("a", 4, 400)] }];
    expect(summarizeCartWarnings(cart, new Map([["a", clear]])).warnings).toEqual([
      { sheet: 1, kind: "low-dpi", count: 1 },
    ]);
  });
});
