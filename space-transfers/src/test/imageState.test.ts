import { describe, expect, it } from "vitest";
import {
  afterPixelEdit,
  captureImageSnapshot,
  restoreImageSnapshot,
  uncroppedSourceOf,
} from "../components/artboard/lib/utils/imageState";
import type { ArtboardItem } from "../components/artboard/types";

const upload: ArtboardItem = {
  id: 1,
  url: "https://cdn/x-trimmed.png",
  croppedUrl: "https://cdn/x-trimmed.png",
  croppedWidthPx: 900,
  croppedHeightPx: 450,
  nativeWidthPx: 900,
  originalUrl: "https://cdn/x.png",
  uncroppedUrl: "https://cdn/x.png",
  uncroppedWidthPx: 1200,
  uncroppedHeightPx: 600,
  assetId: "65f0c0ffee0000000000abcd",
  rotation: 0,
  locked: false,
  expanded: false,
  flipped: false,
  autoCrop: true,
  copies: 1,
  widthIn: 3,
  heightIn: 1.5,
  posX: 1,
  posY: 1,
  linked: true,
  price: 0,
};

describe("uncroppedSourceOf", () => {
  it("prefers the uncropped image, then the upload, then what is shown", () => {
    expect(uncroppedSourceOf(upload)).toBe("https://cdn/x.png");
    expect(uncroppedSourceOf({ ...upload, uncroppedUrl: undefined })).toBe("https://cdn/x.png");
    expect(uncroppedSourceOf({ url: "blob:x" })).toBe("blob:x");
  });
});

describe("afterPixelEdit", () => {
  it("makes the edit what is shown, printed and cropped from — and leaves the upload's identity alone", () => {
    const edited = { ...upload, ...afterPixelEdit("data:image/png;base64,cutout", 800, 400) };
    expect(edited.url).toBe("data:image/png;base64,cutout");
    expect(edited.croppedUrl).toBe(edited.url);
    expect(uncroppedSourceOf(edited)).toBe(edited.url);
    expect([edited.croppedWidthPx, edited.uncroppedWidthPx, edited.nativeWidthPx]).toEqual([800, 800, 800]);
    // Saving and checkout still resolve to the upload.
    expect(edited.originalUrl).toBe("https://cdn/x.png");
    expect(edited.assetId).toBe(upload.assetId);
  });

  it("means turning auto-crop off after removing a background keeps the background removed", () => {
    // The reported bug: the switch rebuilt the piece from originalUrl.
    const edited = { ...upload, ...afterPixelEdit("data:image/png;base64,cutout", 800, 400) };
    expect(uncroppedSourceOf(edited)).not.toBe(upload.originalUrl);
  });
});

describe("image snapshots", () => {
  it("restores the image, its pixel counts and its size, centred where the piece is now", () => {
    const before = captureImageSnapshot(upload);
    // A reframing edit shrank the box to 2x1, and the piece was then moved.
    const edited = { ...upload, ...afterPixelEdit("data:cut", 600, 300), widthIn: 2, heightIn: 1, posX: 5, posY: 5 };
    const reverted = restoreImageSnapshot(edited, before);
    expect(reverted.url).toBe(upload.url);
    expect(reverted.uncroppedUrl).toBe(upload.uncroppedUrl);
    expect([reverted.croppedWidthPx, reverted.nativeWidthPx]).toEqual([900, 900]);
    expect([reverted.widthIn, reverted.heightIn]).toEqual([3, 1.5]);
    // Same centre as the moved 2x1 piece: (6, 5.5).
    expect(reverted.posX + reverted.widthIn / 2).toBeCloseTo(6);
    expect(reverted.posY + reverted.heightIn / 2).toBeCloseTo(5.5);
  });

  it("never restores a piece above the top of the sheet", () => {
    const small = { ...upload, widthIn: 1, heightIn: 0.5, posY: 0 };
    expect(restoreImageSnapshot(small, captureImageSnapshot(upload)).posY).toBe(0);
  });
});
