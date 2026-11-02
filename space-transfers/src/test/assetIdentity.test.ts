/**
 * Serialization-safety guarantees.
 *
 * These pin the fix for a production crash that recurred:
 *
 *     RangeError: Invalid string length
 *       at JSON.stringify (CheckoutModal.tsx, Editor.tsx)
 *
 * The cause was `JSON.stringify` being used as a *comparison* primitive on
 * objects that carry artwork as `data:` URLs. Comparing two carts, or snapshotting
 * a board to detect unsaved changes, cost the size of every image involved —
 * and past V8's ~512 MB string cap it throws rather than merely being slow.
 *
 * The invariant every test here defends: **cost must track item count, not
 * pixel count.** Anything that reintroduces a full image into a comparison or a
 * snapshot will fail these.
 */
import { describe, it, expect } from "vitest";
import {
  assetFingerprint,
  itemsEquivalent,
  itemListsEquivalent,
  stripEmbeddedData,
} from "../lib/utils/assetIdentity";
import { getGangsheetSnapshot } from "../lib/utils/gangsheetState";

/** A data URL of roughly `mb` megabytes, shaped like a real editor output. */
const dataUrl = (mb: number, fill = "A") =>
  `data:image/png;base64,${fill.repeat(Math.floor(mb * 1024 * 1024))}`;

const item = (over: Record<string, unknown> = {}) => ({
  id: 1,
  url: "https://res.cloudinary.com/demo/image/upload/v1/art.png",
  widthIn: 4,
  heightIn: 3,
  posX: 1,
  posY: 2,
  rotation: 0,
  copies: 1,
  ...over,
});

describe("assetFingerprint", () => {
  it("passes a hosted URL through as its own identity", () => {
    const url = "https://res.cloudinary.com/demo/image/upload/v1/art.png";
    expect(assetFingerprint(url)).toBe(url);
  });

  it("reduces a data URL to a constant-size token", () => {
    const fp = assetFingerprint(dataUrl(8));
    expect(fp.length).toBeLessThan(64);
    expect(fp).toContain("data:image/png;base64");
  });

  it("distinguishes data URLs of different sizes", () => {
    expect(assetFingerprint(dataUrl(1))).not.toBe(assetFingerprint(dataUrl(2)));
  });

  it("treats the same image as the same asset", () => {
    expect(assetFingerprint(dataUrl(3))).toBe(assetFingerprint(dataUrl(3)));
  });

  it("is cheap on a very large input", () => {
    // The point of the whole module: identity must not cost O(bytes).
    const huge = dataUrl(64);
    const started = performance.now();
    assetFingerprint(huge);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("handles absent and non-string values", () => {
    expect(assetFingerprint(undefined)).toBe("");
    expect(assetFingerprint(null)).toBe("");
    expect(assetFingerprint(123)).toBe("");
  });
});

describe("itemsEquivalent", () => {
  it("treats identical items as equal", () => {
    expect(itemsEquivalent(item(), item())).toBe(true);
  });

  it("detects a geometry change", () => {
    expect(itemsEquivalent(item(), item({ posX: 5 }))).toBe(false);
    expect(itemsEquivalent(item(), item({ copies: 3 }))).toBe(false);
  });

  it("detects a flag change", () => {
    expect(itemsEquivalent(item(), item({ locked: true }))).toBe(false);
  });

  it("detects the artwork being replaced", () => {
    expect(itemsEquivalent(item({ url: dataUrl(1) }), item({ url: dataUrl(2) }))).toBe(false);
  });

  it("ignores sub-millimetre float noise", () => {
    // Layout maths reintroduces tiny drift; treating it as a change would mark
    // an untouched board dirty and prompt about unsaved work.
    expect(itemsEquivalent(item(), item({ posX: 1 + 1e-9 }))).toBe(true);
  });

  it("compares two large-artwork items without serializing them", () => {
    const a = item({ url: dataUrl(32) });
    const b = item({ url: dataUrl(32) });
    const started = performance.now();
    expect(itemsEquivalent(a, b)).toBe(true);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("itemListsEquivalent", () => {
  it("matches equal lists and rejects different lengths", () => {
    expect(itemListsEquivalent([item()], [item()])).toBe(true);
    expect(itemListsEquivalent([item()], [])).toBe(false);
  });

  it("rejects non-arrays rather than throwing", () => {
    expect(itemListsEquivalent(null, [])).toBe(false);
    expect(itemListsEquivalent(undefined, undefined)).toBe(true);
  });

  it("survives a cart that JSON.stringify cannot represent", () => {
    // The exact CheckoutModal scenario. Eight 40MB images is ~320MB of base64;
    // stringifying two such carts is what threw RangeError. This must not.
    const cart = Array.from({ length: 8 }, (_, i) =>
      item({ id: i, url: dataUrl(40), croppedUrl: dataUrl(40) }),
    );
    const copy = cart.map((c) => ({ ...c }));

    expect(itemListsEquivalent(cart, copy)).toBe(true);
    expect(itemListsEquivalent(cart, copy.slice(1))).toBe(false);
  });
});

describe("getGangsheetSnapshot", () => {
  it("stays small regardless of artwork size", () => {
    // Editor compares this string on every change. If it embeds the images,
    // it is both enormous and capable of throwing.
    const items = Array.from({ length: 5 }, (_, i) => item({ id: i, url: dataUrl(20) }));
    const snapshot = getGangsheetSnapshot(items);

    expect(snapshot.length).toBeLessThan(4000);
    expect(snapshot).not.toContain("AAAA");
  });

  it("still detects the changes it exists to detect", () => {
    const base = [item()];
    expect(getGangsheetSnapshot(base)).toBe(getGangsheetSnapshot([item()]));
    expect(getGangsheetSnapshot(base)).not.toBe(getGangsheetSnapshot([item({ posY: 9 })]));
    expect(getGangsheetSnapshot(base)).not.toBe(getGangsheetSnapshot([item({ copies: 4 })]));
    expect(getGangsheetSnapshot(base)).not.toBe(
      getGangsheetSnapshot([item({ url: dataUrl(1) })]),
    );
  });

  it("returns a stable empty result for a non-array", () => {
    expect(getGangsheetSnapshot(null as any)).toBe("[]");
  });
});

describe("stripEmbeddedData", () => {
  it("removes data URLs and keeps everything else", () => {
    const stripped = stripEmbeddedData({
      url: dataUrl(4),
      hosted: "https://cdn.example/art.png",
      widthIn: 4,
      nested: { thumb: dataUrl(2), name: "shirt" },
    }) as any;

    expect(stripped.url).toBeNull();
    expect(stripped.hosted).toBe("https://cdn.example/art.png");
    expect(stripped.widthIn).toBe(4);
    expect(stripped.nested.thumb).toBeNull();
    expect(stripped.nested.name).toBe("shirt");
  });

  it("produces something JSON.stringify can handle", () => {
    const cart = Array.from({ length: 6 }, (_, i) => item({ id: i, url: dataUrl(40) }));
    const serialized = JSON.stringify(stripEmbeddedData(cart));
    expect(serialized.length).toBeLessThan(10_000);
  });

  it("terminates on a cyclic structure", () => {
    // Artboard items can hold parent back-references; an unguarded walk hangs.
    const cyclic: any = { url: "https://cdn.example/a.png" };
    cyclic.self = cyclic;
    expect(() => stripEmbeddedData(cyclic)).not.toThrow();
  });
});

describe("cart lines holding different versions of a sheet", () => {
  const line = { id: 1, widthIn: 23.5, heightIn: 12, name: "Team", designId: "d1", designSignature: "v1", price: 10 };

  it("are not equivalent when the sheet's contents differ", () => {
    expect(itemListsEquivalent([line], [{ ...line, designSignature: "v2" }])).toBe(false);
  });

  it("are not equivalent when one is marked as changed since it was added", () => {
    expect(itemListsEquivalent([line], [{ ...line, sheetChanged: true }])).toBe(false);
  });

  it("are equivalent when nothing the customer sees differs", () => {
    expect(itemListsEquivalent([line], [{ ...line, sheetChanged: false }])).toBe(true);
  });
});
