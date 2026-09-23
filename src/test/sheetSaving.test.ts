import { describe, expect, it } from "vitest";
import { artworkNotUploaded, titleTaken, nextUntitledName, UNTITLED_SHEET } from "../lib/utils/sheetSaving";

describe("artworkNotUploaded", () => {
  it("is true when any image exists only in this browser", () => {
    expect(artworkNotUploaded([{ url: "blob:http://localhost:5176/abc" }])).toBe(true);
    expect(artworkNotUploaded([{ url: "https://cdn/a.png", croppedUrl: "blob:http://x/1" }])).toBe(true);
    expect(artworkNotUploaded([{ url: "https://cdn/a.png" }, { assetId: "blob:http://x/2" }])).toBe(true);
  });

  it("is false for uploaded artwork, saved ids and inline images", () => {
    expect(
      artworkNotUploaded([
        { url: "https://cdn/a.png", croppedUrl: "https://cdn/a.png", assetId: "65f0c0ffee0000000000abcd" },
        { url: "data:image/png;base64,iVBORw0KGgo=" },
      ]),
    ).toBe(false);
    expect(artworkNotUploaded([])).toBe(false);
  });
});

describe("nextUntitledName", () => {
  it("uses the plain name when it is free", () => {
    expect(nextUntitledName([])).toBe(UNTITLED_SHEET);
    expect(nextUntitledName(["Spring tees", null, undefined])).toBe(UNTITLED_SHEET);
  });

  it("numbers the ones after it, so saved sheets are tellable apart", () => {
    expect(nextUntitledName([UNTITLED_SHEET])).toBe("Untitled gang sheet 2");
    expect(nextUntitledName([UNTITLED_SHEET, "Untitled gang sheet 2"])).toBe("Untitled gang sheet 3");
    // Gaps are reused rather than skipped.
    expect(nextUntitledName([UNTITLED_SHEET, "Untitled gang sheet 3"])).toBe("Untitled gang sheet 2");
  });

  it("ignores case and stray spacing when deciding what is taken", () => {
    expect(nextUntitledName(["  untitled GANG sheet "])).toBe("Untitled gang sheet 2");
  });
});

describe("titleTaken", () => {
  it("compares names the way the server does: ignoring case and spacing", () => {
    expect(titleTaken("Sheet  ONE", ["sheet one"])).toBe(true);
    expect(titleTaken("sheet one (2)", ["sheet one"])).toBe(false);
  });
});
