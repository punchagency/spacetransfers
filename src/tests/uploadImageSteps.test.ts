import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { trimImage } from "../utils/aiCrop.js";
import { uprightImage } from "../utils/uprightImage.js";

/**
 * The two image steps of an upload, made cheaper on 2026-09-22: a photo with
 * nothing to trim used to be re-saved as a PNG ~8x its size, and a phone photo
 * stored sideways (EXIF orientation) was sized, trimmed and printed sideways.
 */
const solid = (w: number, h: number, colour = { r: 30, g: 90, b: 200 }) =>
  sharp({ create: { width: w, height: h, channels: 3, background: colour } });

describe("trimImage", () => {
  it("does no work when there is nothing to trim", async () => {
    // Busy content right to the edges, like a photo.
    const noise = Buffer.alloc(400 * 300 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 256;
    const photo = await sharp(noise, { raw: { width: 400, height: 300, channels: 3 } }).jpeg().toBuffer();
    const r = await trimImage(photo);
    assert.ok(r && r.unchanged, "a photo with no plain border must come back unchanged");
    assert.equal(r!.widthPx, 400);
    assert.equal(r!.heightPx, 300);
  });

  it("crops a plain border, losslessly", async () => {
    const art = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#ffffff" } })
      .composite([{ input: await solid(200, 100).png().toBuffer(), left: 200, top: 150 }])
      .jpeg()
      .toBuffer();
    const r = await trimImage(art);
    assert.ok(r && !r.unchanged);
    if (r && !r.unchanged) {
      assert.ok(Math.abs(r.widthPx - 200) <= 2 && Math.abs(r.heightPx - 100) <= 2, `got ${r.widthPx}x${r.heightPx}`);
      assert.equal((await sharp(r.buffer).metadata()).format, "png");
    }
  });

  it("crops to the visible pixels of a transparent image", async () => {
    const logo = await sharp({ create: { width: 500, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await solid(100, 60).png().toBuffer(), left: 50, top: 70 }])
      .png()
      .toBuffer();
    const r = await trimImage(logo);
    assert.ok(r && !r.unchanged);
    assert.ok(Math.abs(r!.widthPx - 100) <= 2 && Math.abs(r!.heightPx - 60) <= 2, `got ${r!.widthPx}x${r!.heightPx}`);
  });
});

describe("uprightImage", () => {
  it("turns a sideways phone photo upright and clears the tag", async () => {
    // Stored 400 wide x 300 tall, tagged "rotate 90°" — really a 300x400 portrait.
    const sideways = await solid(400, 300).jpeg().withMetadata({ orientation: 6, density: 300 }).toBuffer();
    const out = await uprightImage(sideways);
    const meta = await sharp(out).metadata();
    assert.equal(meta.width, 300);
    assert.equal(meta.height, 400);
    assert.equal(meta.orientation ?? 1, 1);
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.density, 300, "the print resolution survives");
  });

  it("leaves an upright image exactly as it arrived", async () => {
    const upright = await solid(400, 300).jpeg().toBuffer();
    assert.equal(await uprightImage(upright), upright);
  });
});
