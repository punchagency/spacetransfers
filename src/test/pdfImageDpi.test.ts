import { describe, expect, it } from "vitest";
import { analysePageImages, pageRenderDpi } from "../components/artboard/lib/utils/pdfRasterize";

const OPS = {
  save: 1, restore: 2, transform: 3, fill: 4, showText: 5, paintImageXObject: 6, paintInlineImageXObject: 7,
  paintFormXObjectBegin: 8, paintFormXObjectEnd: 9, constructPath: 10, clip: 11, endPath: 12,
};
type Op = [keyof typeof OPS, unknown?];
const analyse = (ops: Op[], widthPt = 1152, heightPt = 2048) =>
  analysePageImages(ops.map(([name]) => OPS[name]), ops.map(([, args]) => args ?? null), OPS, widthPt, heightPt);

/** A picture of `w`×`h` pixels drawn `wPt`×`hPt` points large. */
const picture = (w: number, h: number, wPt: number, hPt: number): Op[] => [
  ["save"], ["transform", [wPt, 0, 0, hPt, 0, 0]], ["paintImageXObject", ["img_1", w, h]], ["restore"],
];

describe("the real resolution of a picture in a PDF", () => {
  it("is its pixels over the size it is drawn at", () => {
    // 819 px across a 16in (1152pt) page.
    const info = analyse(picture(819, 1456, 1152, 2048));
    expect(Math.round(info.imageDpi!)).toBe(51);
    expect(info.hasVector).toBe(false);
  });

  it("is full resolution for a picture with enough pixels", () => {
    expect(Math.round(analyse(picture(4800, 8533, 1152, 2048)).imageDpi!)).toBe(300);
  });

  it("follows nested transforms and forms", () => {
    const info = analyse([
      ["save"], ["transform", [2, 0, 0, 2, 0, 0]],
      ["paintFormXObjectBegin", [[1, 0, 0, 1, 10, 10], null]],
      ["transform", [576, 0, 0, 1024, 0, 0]], ["paintImageXObject", ["img_1", 1600, 2844]],
      ["paintFormXObjectEnd"], ["restore"],
    ]);
    // Drawn 1152pt (16in) wide in the end.
    expect(Math.round(info.imageDpi!)).toBe(100);
  });

  it("reads inline pictures", () => {
    const info = analyse([["transform", [1152, 0, 0, 2048, 0, 0]], ["paintInlineImageXObject", [{ width: 1600, height: 2844 }]]]);
    expect(Math.round(info.imageDpi!)).toBe(100);
  });

  it("ignores a small picture on a page of other artwork", () => {
    const info = analyse([["fill"], ...picture(40, 40, 100, 100)]);
    expect(info.imageDpi).toBeNull();
    expect(info.hasVector).toBe(true);
  });

  it("does not take a clipping path for drawn artwork", () => {
    const info = analyse([["constructPath", [[], [], []]], ["clip"], ["endPath"], ...picture(819, 1456, 1152, 2048)]);
    expect(info.hasVector).toBe(false);
  });

  it("reports the coarsest of several pictures", () => {
    const info = analyse([...picture(4800, 4000, 1152, 960), ...picture(600, 500, 1152, 960)]);
    expect(Math.round(info.imageDpi!)).toBe(38);
  });
});

describe("the resolution a PDF page is rendered at", () => {
  it("is print resolution for text and shapes", () => {
    expect(pageRenderDpi({ imageDpi: null, hasVector: true })).toBe(300);
  });

  it("is print resolution for a sharp picture", () => {
    expect(pageRenderDpi({ imageDpi: 420, hasVector: false })).toBe(300);
  });

  it("is the picture's own resolution when the page is only a soft picture", () => {
    expect(pageRenderDpi({ imageDpi: 212.4, hasVector: false })).toBe(212);
  });

  it("does not go below the floor an upload keeps its size at", () => {
    expect(pageRenderDpi({ imageDpi: 51, hasVector: false })).toBe(150);
  });

  it("stays at print resolution when text shares the page with a soft picture", () => {
    expect(pageRenderDpi({ imageDpi: 51, hasVector: true })).toBe(300);
  });
});
