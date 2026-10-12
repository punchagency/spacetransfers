import { describe, expect, it } from "vitest";
import { applyUploadedAsset, isNotUploaded } from "../components/artboard/lib/utils/uploadRecovery";

const placed: Record<string, any> = {
  id: 7, url: "blob:http://x/local", croppedUrl: "blob:http://x/local", originalUrl: "blob:http://x/file", uncroppedUrl: "blob:http://x/file",
  widthIn: 4, heightIn: 2, posX: 3, posY: 5, copies: 3, rotation: 0, autoCrop: true, uploadFailed: true, nativeWidthPx: 1200,
};
const asset = {
  id: "a1", url: "https://cdn/original.png", trimmedUrl: "https://cdn/trimmed.png",
  widthPx: 1500, heightPx: 900, trimmedWidthPx: 1000, trimmedHeightPx: 520,
};

describe("an image that never uploaded", () => {
  it("is recognised by anything it points at that exists only in this browser", () => {
    expect(isNotUploaded(placed)).toBe(true);
    expect(isNotUploaded({ url: "data:image/png;base64,xx", originalUrl: "blob:http://x/file" })).toBe(true);
    expect(isNotUploaded({ url: "https://cdn/a.png", originalUrl: "https://cdn/a.png" })).toBe(false);
  });
});

describe("once its upload succeeds", () => {
  it("points at the stored image and is no longer local-only", () => {
    const next = applyUploadedAsset(placed, asset, placed.url);
    expect(next.url).toBe("https://cdn/trimmed.png");
    expect(next.croppedUrl).toBe("https://cdn/trimmed.png");
    expect(next.originalUrl).toBe("https://cdn/original.png");
    expect(next.assetId).toBe("a1");
    expect(next.uploadFailed).toBe(false);
    expect(isNotUploaded(next)).toBe(false);
  });

  it("keeps its copies and the scale the customer left it at, centred where it was", () => {
    // Placed at 1200px across 4in: 300 pixels to the inch.
    const next = applyUploadedAsset(placed, asset, placed.url);
    expect(next.copies).toBe(3);
    expect(next.nativeWidthPx / next.widthIn).toBeCloseTo(300, 5);
    expect(next.heightIn).toBeCloseTo(520 / 300, 5);
    expect(next.posX + next.widthIn / 2).toBeCloseTo(3 + 4 / 2, 5);
    expect(next.posY + next.heightIn / 2).toBeCloseTo(5 + 2 / 2, 5);
  });

  it("does not drop under print resolution because the server's crop is a few pixels tighter", () => {
    const local: Record<string, any> = { ...placed, nativeWidthPx: 941, widthIn: 941 / 300, heightIn: 535 / 300 };
    const next = applyUploadedAsset(local, { ...asset, trimmedWidthPx: 935, trimmedHeightPx: 530 }, local.url);
    expect(Math.round(next.nativeWidthPx / next.widthIn)).toBe(300);
  });

  it("swaps the axes for a piece turned a quarter", () => {
    const turned: Record<string, any> = { ...placed, rotation: 90, widthIn: 2, heightIn: 4 };
    const next = applyUploadedAsset(turned, asset, turned.url);
    // 1200px ran along its 4in side.
    expect(next.heightIn).toBeCloseTo(1000 / 300, 5);
    expect(next.widthIn).toBeCloseTo(520 / 300, 5);
  });

  it("uses the whole image when auto crop is off", () => {
    const whole: Record<string, any> = { ...placed, autoCrop: false };
    const next = applyUploadedAsset(whole, asset, placed.url);
    expect(next.url).toBe("https://cdn/original.png");
    expect(next.nativeWidthPx).toBe(1500);
  });

  it("keeps an edit made while it was waiting, and only updates what it was made from", () => {
    const edited: Record<string, any> = { ...placed, url: "data:image/png;base64,cutout", croppedUrl: "data:image/png;base64,cutout" };
    const next = applyUploadedAsset(edited, asset, placed.url);
    expect(next.url).toBe("data:image/png;base64,cutout");
    expect(next.heightIn).toBe(2);
    expect(next.originalUrl).toBe("https://cdn/original.png");
    expect(isNotUploaded(next)).toBe(false);
  });
});
