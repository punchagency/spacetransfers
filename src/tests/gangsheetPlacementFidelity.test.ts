import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { exportGangsheetPng24 } from "../services/gangsheetExport.service.js";

/**
 * The printed sheet must match the artboard the customer approved.
 *
 * Rendered with the real export and read back pixel by pixel. Before this was
 * fixed, a real auto-nested layout printed 39% of its ink outside the cells
 * the artboard showed: pieces auto-nest had turned printed upright, copies
 * spread across more columns than the artboard used, and a piece the customer
 * rotated was squashed and turned back across its own cell.
 *
 * Every artwork here is split into a red left half and a blue right half, so
 * the tests can tell not only where a piece landed but which way it faces.
 */

const DPI = 20;
const PRINTER = "placement-fidelity-test";

after(() => {
  fs.rmSync(path.join(process.cwd(), "uploads", "exports", "printers", PRINTER), {
    recursive: true,
    force: true,
  });
});

const RED = [220, 38, 38];
const BLUE = [37, 99, 235];

/** A `wIn` × `hIn` artwork, red on its left half and blue on its right. */
const halves = async (wIn: number, hIn: number) => {
  const w = Math.round(wIn * 100);
  const h = Math.round(hIn * 100);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect width="${w / 2}" height="${h}" fill="rgb(${RED})"/>` +
    `<rect x="${w / 2}" width="${w / 2}" height="${h}" fill="rgb(${BLUE})"/></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
};

let jobSeq = 0;

/** Renders the sheet and returns a reader for the colour at a point in inches. */
const render = async (artboardItems: any[], sheetHeightIn = 10) => {
  const rendered = await exportGangsheetPng24({
    jobId: `fidelity-${process.pid}-${jobSeq++}`,
    printerId: PRINTER,
    sheetWidthIn: 23.5,
    sheetHeightIn,
    artboardItems,
    dpi: DPI,
    itemSpacingIn: 0.25,
    sheetMarginIn: 0.15,
  });
  const { data, info } = await sharp(rendered.filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return (xIn: number, yIn: number): "red" | "blue" | "empty" | "other" => {
    const x = Math.floor(xIn * DPI);
    const y = Math.floor(yIn * DPI);
    const i = (y * info.width + x) * 4;
    if (data[i + 3] < 128) return "empty";
    const near = (c: number[]) => Math.abs(data[i] - c[0]) + Math.abs(data[i + 1] - c[1]) + Math.abs(data[i + 2] - c[2]) < 60;
    return near(RED) ? "red" : near(BLUE) ? "blue" : "other";
  };
};

describe("printed placements match the artboard", () => {
  it("draws a piece auto-nest turned on its side, turned", async () => {
    // A 6x2in piece nested at (1,1) fills a 2in-wide, 6in-tall cell. A quarter
    // turn clockwise puts its left (red) half at the top.
    const at = await render([
      { assetId: "a", croppedUrl: await halves(6, 2), widthIn: 6, heightIn: 2, posX: 1, posY: 1, copies: 1, nestRotation: 90 },
    ]);
    assert.equal(at(2, 2.5), "red", "top of the cell");
    assert.equal(at(2, 5.5), "blue", "bottom of the cell");
    assert.equal(at(5, 2), "empty", "where the upright piece used to print");
  });

  it("draws a customer-rotated piece at its own size, turned", async () => {
    // The customer turned a 6x2in piece once: the store sends it as 2x6 with
    // rotation 90. It must fill the 2x6 cell, not be squashed into 2x6 and
    // turned back across it.
    const at = await render([
      { assetId: "b", croppedUrl: await halves(6, 2), widthIn: 2, heightIn: 6, posX: 1, posY: 1, copies: 1, rotation: 90 },
    ]);
    assert.equal(at(2, 2.5), "red");
    assert.equal(at(2, 5.5), "blue");
    assert.equal(at(4.5, 2), "empty");
  });

  it("wraps copies at the columns auto-nest chose", async () => {
    // Four 2in squares wrapped at two columns: a 2x2 block from (1,1).
    const at = await render([
      { assetId: "c", croppedUrl: await halves(2, 2), widthIn: 2, heightIn: 2, posX: 1, posY: 1, copies: 4, flowCols: 2 },
    ]);
    assert.notEqual(at(4.25, 4.25), "empty", "second row, second column");
    assert.equal(at(6.5, 2), "empty", "no third column");
  });

  it("mirrors a flipped piece", async () => {
    const at = await render([
      { assetId: "d", croppedUrl: await halves(6, 2), widthIn: 6, heightIn: 2, posX: 1, posY: 1, copies: 1, flipped: true },
    ]);
    assert.equal(at(2, 2), "blue", "left half, mirrored");
    assert.equal(at(6, 2), "red", "right half, mirrored");
  });
});
