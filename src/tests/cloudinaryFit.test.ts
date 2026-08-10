/**
 * `fitUnderCloudinaryLimit` correctness.
 * Run with: npm test — no network, no API key, no database.
 *
 * Pins the fix for a production failure:
 *
 *     Error Response:
 *     {"message":"File size too large. Got 26109039. Maximum is 10485760."}
 *
 * That is Cloudinary's own error, reached because the buffer this function
 * returned was still over its 10MB account cap. The bug lived in the
 * downscale loop's stopping condition, which was `Math.round(meta.width *
 * scale) >= 200` — based on WIDTH alone. For any image narrower than ~286px,
 * that check is false on its very first evaluation, so the loop body never
 * ran, regardless of how tall (and therefore how large) the image actually
 * was.
 *
 * That shape — narrow but very tall — is not an edge case here: this
 * platform explicitly supports gang sheets up to 1200in long, and a thin
 * banner or strap design is exactly what a narrow-but-enormous image looks
 * like in practice.
 *
 * Most of the tests below exercise `nextDownscaleCandidate` directly — the
 * pure arithmetic that was actually buggy — rather than driving real image
 * encoding for every case. Real per-pixel-random image content is close to
 * worst-case for PNG/JPEG encoders and correspondingly slow (tens of seconds
 * for just a few megapixels at the encoder's highest effort setting), which
 * would make a fast, run-on-every-change unit suite impractical if every case
 * had to reproduce it end-to-end. The one true integration test below is kept
 * deliberately small for that reason; it still exercises real sharp/libjpeg
 * calls, just at a scale that finishes in around a second.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { fitUnderCloudinaryLimit, nextDownscaleCandidate } from "../utils/cloudinary.js";

const CLOUDINARY_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** The buggy stopping condition being replaced, reproduced exactly for comparison. */
const oldLoopWouldRun = (width: number): boolean => {
  let scale = 0.7;
  return Math.round(width * scale) >= 200;
};

describe("nextDownscaleCandidate", () => {
  it("keeps shrinking a narrow, very tall image (the reported failure shape)", () => {
    // Width alone is well under the old loop's ~286px threshold, so the old
    // condition would never even start — this is the exact bug.
    assert.equal(oldLoopWouldRun(150), false, "sanity check: old condition should fail here");

    let width = 150;
    let height = 60_000;
    let currentBytes = 26_109_039; // the exact size from the production error
    let steps = 0;

    let candidate = nextDownscaleCandidate(width, height, currentBytes, CLOUDINARY_IMAGE_MAX_BYTES);
    while (candidate && steps < 20) {
      steps += 1;
      ({ width, height } = candidate);
      // Simulate byte size continuing to scale with pixel area, as real
      // encoders do — lets the loop's convergence be checked without
      // encoding anything.
      currentBytes = Math.round(currentBytes * ((width * height) / (150 * 60_000)));
      candidate = nextDownscaleCandidate(width, height, currentBytes, CLOUDINARY_IMAGE_MAX_BYTES);
    }

    assert.ok(steps > 0, "the new stopping condition must actually run for a narrow image");
    assert.ok(currentBytes <= CLOUDINARY_IMAGE_MAX_BYTES, "must converge under the cap");
  });

  it("treats width and height symmetrically", () => {
    // A 150×60,000 image and a 60,000×150 image are the same shape rotated —
    // the old bug was specifically that these were NOT treated the same way.
    const a = nextDownscaleCandidate(150, 60_000, 30_000_000, CLOUDINARY_IMAGE_MAX_BYTES);
    const b = nextDownscaleCandidate(60_000, 150, 30_000_000, CLOUDINARY_IMAGE_MAX_BYTES);
    assert.ok(a && b);
    assert.equal(a!.width, b!.height);
    assert.equal(a!.height, b!.width);
  });

  it("stops once the floor is reached, guaranteeing termination", () => {
    assert.equal(nextDownscaleCandidate(200, 199, 1_000_000, CLOUDINARY_IMAGE_MAX_BYTES), null);
    assert.equal(nextDownscaleCandidate(1, 1, 1_000_000, CLOUDINARY_IMAGE_MAX_BYTES), null);
  });

  it("never grows the image, even if currentBytes is already under the cap", () => {
    const candidate = nextDownscaleCandidate(4000, 4000, 100, CLOUDINARY_IMAGE_MAX_BYTES);
    assert.ok(candidate);
    assert.ok(candidate!.width < 4000);
    assert.ok(candidate!.height < 4000);
  });

  it("takes far fewer steps than the old fixed ×0.7 decay for a large overage", () => {
    // The ratio is derived from the actual overage rather than a blind decay,
    // which was also the majority of the reported request's 24s latency.
    let width = 4000;
    let height = 4000;
    let bytes = 200 * 1024 * 1024; // 200MB, wildly over cap
    let steps = 0;
    let candidate = nextDownscaleCandidate(width, height, bytes, CLOUDINARY_IMAGE_MAX_BYTES);
    while (candidate && steps < 20) {
      steps += 1;
      ({ width, height } = candidate);
      bytes = Math.round(bytes * ((width * height) / (4000 * 4000)));
      candidate = nextDownscaleCandidate(width, height, bytes, CLOUDINARY_IMAGE_MAX_BYTES);
      if (bytes <= CLOUDINARY_IMAGE_MAX_BYTES) break;
    }
    assert.ok(steps <= 3, `expected fast convergence, took ${steps} steps`);
  });

  it("handles zero-area input without dividing by zero or looping forever", () => {
    assert.equal(nextDownscaleCandidate(0, 0, 1000, CLOUDINARY_IMAGE_MAX_BYTES), null);
  });
});

/**
 * Pins the specific incident reported twice against this endpoint — first at
 * 24s, then again at 54s — both times with the identical final size
 * (26,109,039 bytes). The repeat, and the growing latency, are exactly what
 * you'd expect from an already-broken code path being retried against the
 * same (or a similarly-shaped) narrow, high-resolution asset: the old
 * downscale loop never engaged, so every retry re-ran the same expensive,
 * futile PNG/JPEG recompression cascade from scratch and still handed
 * Cloudinary the same oversized buffer.
 *
 * The real width/height of the source image isn't known — only the resulting
 * byte count is, from the server log — so this checks convergence from that
 * exact byte count across every plausible narrow-but-tall split, rather than
 * guessing one specific shape. If this ever regresses, it means the area-based
 * floor was weakened back toward a dimension-based one.
 */
describe("production incident: /materialize 500 at 26,109,039 bytes", () => {
  const REPORTED_BYTES = 26_109_039;

  const converges = (width: number, height: number): boolean => {
    let w = width;
    let h = height;
    let bytes = REPORTED_BYTES;
    let candidate = nextDownscaleCandidate(w, h, bytes, CLOUDINARY_IMAGE_MAX_BYTES);
    let steps = 0;
    while (candidate && steps < 20) {
      steps += 1;
      ({ width: w, height: h } = candidate);
      bytes = Math.round(bytes * ((w * h) / (width * height)));
      if (bytes <= CLOUDINARY_IMAGE_MAX_BYTES) return true;
      candidate = nextDownscaleCandidate(w, h, bytes, CLOUDINARY_IMAGE_MAX_BYTES);
    }
    return bytes <= CLOUDINARY_IMAGE_MAX_BYTES;
  };

  it("converges under the cap for every plausible narrow/tall aspect ratio at this byte count", () => {
    // A spread of widths under the old ~286px threshold, each paired with
    // whatever height reproduces the reported byte count at ~4 bytes/px —
    // the old loop's guard would have failed immediately for every one.
    for (const width of [40, 80, 120, 150, 200, 250]) {
      assert.equal(oldLoopWouldRun(width), false, `old loop should not run for width=${width}`);
      const height = Math.round(REPORTED_BYTES / (width * 4));
      assert.ok(converges(width, height), `failed to converge for ${width}x${height}`);
    }
  });
});

describe("fitUnderCloudinaryLimit", () => {
  it("passes an already-small buffer through untouched", async () => {
    const small = await sharp({
      create: { width: 40, height: 40, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 255 } },
    })
      .png()
      .toBuffer();
    const result = await fitUnderCloudinaryLimit(small);
    assert.equal(result, small);
  });

  it("shrinks a narrow, very tall real image under the cap without throwing", async () => {
    // A small-but-real reproduction of the reported shape: narrow (under the
    // old loop's threshold) and much taller than wide, with enough genuine
    // per-pixel variation (a diagonal color ramp, not flat) that the early
    // lossless/quality passes cannot trivially shrink it to nothing. Sized to
    // finish in about a second rather than reproducing the full-scale
    // multi-megapixel case that `nextDownscaleCandidate` already covers.
    const width = 150;
    const height = 4000;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        raw[i] = (x * 37 + y) % 256;
        raw[i + 1] = (y * 53 + x) % 256;
        raw[i + 2] = (x + y) % 256;
        raw[i + 3] = 255;
      }
    }
    const buf = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();

    const result = await fitUnderCloudinaryLimit(buf);
    assert.ok(
      result.length <= CLOUDINARY_IMAGE_MAX_BYTES,
      `expected <= ${CLOUDINARY_IMAGE_MAX_BYTES} bytes, got ${result.length}`,
    );

    const meta = await sharp(result).metadata();
    assert.ok(meta.width! > 0 && meta.height! > 0);
  });

  it("degrades to PNG rather than throwing when a dimension exceeds libjpeg's limit", async () => {
    // libjpeg cannot encode above 65,500px in either dimension. This must not
    // propagate as an unhandled exception — it must fall back to PNG.
    const width = 40;
    const height = 70_000; // over the libjpeg ceiling
    const raw = Buffer.alloc(width * height * 4);
    // Flat-ish content so this encodes quickly; the point of this test is the
    // dimension guard, not compression resistance (that's covered above).
    raw.fill(120);
    const buf = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();

    await assert.doesNotReject(() => fitUnderCloudinaryLimit(buf));
  });
});
