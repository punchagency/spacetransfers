/**
 * Fade-detection geometry tests.
 * Run with: npm test — no network, no API key, no database.
 *
 * These pin the discrimination the whole feature rests on: telling a genuine
 * fade into transparency from the three printable things that look identical to
 * a naive alpha count. The old rule was `semiTransparent / visible > 0.05`,
 * which flagged every anti-aliased cutout and every drop shadow; each case
 * below is a shape that rule got wrong.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import {
  analyzeAlpha,
  detectFade,
  seeThroughVerdict,
  heuristicVerdict,
  TRANSPARENCY_CHECK_VERSION,
} from "../services/fadeDetection.service.js";

const W = 200;

/** Builds an RGBA PNG from a function returning alpha 0-255 per pixel. */
const buildImage = async (
  alphaAt: (x: number, y: number) => number,
  W = 200,
  H = 200,
): Promise<Buffer> => {
  const raw = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      raw[i] = 200;
      raw[i + 1] = 60;
      raw[i + 2] = 60;
      raw[i + 3] = Math.max(0, Math.min(255, Math.round(alphaAt(x, y))));
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
};

/** A real fade: opaque on the left, ramping smoothly to transparent on the right. */
const fadeImage = () => buildImage((x) => (1 - x / (W - 1)) * 255);

/**
 * A hard-edged cutout with a 1px anti-aliased border — what every exported
 * logo looks like, and the dominant false positive under the old rule.
 */
const antiAliasedImage = () =>
  buildImage((x, y) => {
    const inside = x >= 40 && x < 160 && y >= 40 && y < 160;
    const onBorder =
      (x === 39 || x === 160 || y === 39 || y === 160) &&
      x >= 39 && x <= 160 && y >= 39 && y <= 160;
    if (inside) return 255;
    if (onBorder) return 128;
    return 0;
  });

/** A solid subject plus an offset, uniformly semi-transparent drop shadow. */
const shadowImage = () =>
  buildImage((x, y) => {
    const subject = x >= 30 && x < 120 && y >= 30 && y < 120;
    const shadow = x >= 50 && x < 140 && y >= 50 && y < 140;
    if (subject) return 255;
    if (shadow) return 90;
    return 0;
  });

/** Fully opaque — no transparency anywhere. */
const opaqueImage = () => buildImage(() => 255);

describe("analyzeAlpha", () => {
  it("measures a broad interior partial region for a real fade", async () => {
    const analysis = await analyzeAlpha(await fadeImage());
    // A fade is almost entirely partial alpha, and almost none of it sits on
    // the silhouette boundary.
    assert.ok(
      analysis.interiorSemiRatio > 0.5,
      `expected a large interior partial region, got ${analysis.interiorSemiRatio}`,
    );
    assert.ok(
      analysis.maxRampRatio > 0.08,
      `expected a sustained ramp, got ${analysis.maxRampRatio}`,
    );
  });

  it("measures almost no interior partial alpha for an anti-aliased cutout", async () => {
    const analysis = await analyzeAlpha(await antiAliasedImage());
    // The partial pixels exist, but every one has both a fully opaque and a
    // fully transparent neighbour — that is what makes it an edge, not a fade.
    assert.ok(
      analysis.interiorSemiRatio < 0.01,
      `anti-aliasing should be edge-only, got ${analysis.interiorSemiRatio}`,
    );
  });

  it("finds no sustained ramp in a uniform drop shadow", async () => {
    const analysis = await analyzeAlpha(await shadowImage());
    // A flat-alpha shadow is broad but has no gradient — this is what separates
    // it from a fade, since both have plenty of interior partial pixels.
    assert.ok(
      analysis.maxRampRatio < 0.08,
      `a flat shadow should have no long ramp, got ${analysis.maxRampRatio}`,
    );
  });

  it("reports no partial alpha for a fully opaque image", async () => {
    const analysis = await analyzeAlpha(await opaqueImage());
    assert.ok(analysis.semiRatio < 0.005, `expected no partial alpha, got ${analysis.semiRatio}`);
  });
});

describe("heuristicVerdict", () => {
  it("flags a genuine fade", async () => {
    const verdict = heuristicVerdict(await analyzeAlpha(await fadeImage()));
    assert.equal(verdict.hasFade, true);
    assert.equal(verdict.kind, "fade");
    assert.ok(verdict.confidence >= 0.6, `expected actionable confidence, got ${verdict.confidence}`);
  });

  it("does not flag an anti-aliased cutout", async () => {
    // The single most important case: this is what an ordinary logo upload
    // looks like, and the old rule called it unprintable.
    const verdict = heuristicVerdict(await analyzeAlpha(await antiAliasedImage()));
    assert.equal(verdict.hasFade, false);
    assert.equal(verdict.kind, "anti-aliasing");
  });

  it("does not flag a drop shadow", async () => {
    const verdict = heuristicVerdict(await analyzeAlpha(await shadowImage()));
    assert.equal(verdict.hasFade, false);
    assert.ok(
      verdict.kind === "shadow" || verdict.kind === "soft-edge",
      `expected a shadow-ish classification, got ${verdict.kind}`,
    );
  });

  it("flags a feathered glow, which is a short fade rather than a shadow", async () => {
    // Deliberate: a feathered edge ramps into transparency over its falloff, so
    // DTF renders it as the same ragged edge a long fade produces. What makes a
    // drop shadow printable is that its alpha is *flat* — not that it is soft.
    // The two are separated by the gradient measure, not by how faint they look.
    const glow = await buildImage((x, y) => {
      const d = Math.hypot(x - 100, y - 100);
      if (d < 60) return 255;
      if (d < 75) return 255 * (1 - (d - 60) / 15);
      return 0;
    });
    const verdict = heuristicVerdict(await analyzeAlpha(glow));
    assert.equal(verdict.hasFade, true);
    assert.equal(verdict.kind, "fade");
  });

  it("does not flag a hard cutout with no anti-aliasing", async () => {
    const hard = await buildImage((x, y) =>
      x >= 50 && x < 150 && y >= 50 && y < 150 ? 255 : 0,
    );
    const verdict = heuristicVerdict(await analyzeAlpha(hard));
    assert.equal(verdict.hasFade, false);
  });

  it("does not flag a fully opaque image", async () => {
    const verdict = heuristicVerdict(await analyzeAlpha(await opaqueImage()));
    assert.equal(verdict.hasFade, false);
    assert.ok(verdict.kind === "opaque" || verdict.kind === "none");
  });

  it("beats the rule it replaced on the cases that rule got wrong", async () => {
    // Demonstrates the regression directly: `semiRatio > 0.05` is the old test.
    const antiAliased = await analyzeAlpha(await antiAliasedImage());
    const shadow = await analyzeAlpha(await shadowImage());

    const oldRuleFlagged = (a: { semiRatio: number }) => a.semiRatio > 0.05;

    // Both of these are printable, and at least one would have been flagged.
    assert.ok(
      oldRuleFlagged(shadow),
      "the drop shadow should be a false positive under the old rule",
    );
    // The new verdicts clear both.
    assert.equal(heuristicVerdict(antiAliased).hasFade, false);
    assert.equal(heuristicVerdict(shadow).hasFade, false);
  });

  it("always returns a confidence inside 0-1", async () => {
    // The client gates its warning on this value, so an out-of-range confidence
    // would silently change the threshold's meaning.
    for (const build of [fadeImage, antiAliasedImage, shadowImage, opaqueImage]) {
      const verdict = heuristicVerdict(await analyzeAlpha(await build()));
      assert.ok(
        verdict.confidence >= 0 && verdict.confidence <= 1,
        `${verdict.kind} produced confidence ${verdict.confidence}`,
      );
    }
  });
});

describe("see-through artwork", () => {
  /** A solid subject plus a shadow at `alpha`, covering about a third of the artwork. */
  const shadowAt = (alpha: number) =>
    buildImage((x, y) => {
      if (x >= 30 && x < 120 && y >= 30 && y < 120) return 255;
      if (x >= 50 && x < 140 && y >= 50 && y < 140) return alpha;
      return 0;
    });

  it("flags a shadow that is more than 50% transparent", async () => {
    const analysis = await analyzeAlpha(await shadowAt(90));
    const verdict = seeThroughVerdict(analysis);
    assert.ok(verdict, `expected a flag, faintRatio ${analysis.faintRatio}`);
    assert.equal(verdict.hasFade, true);
    assert.equal(verdict.kind, "semi-transparent");
    assert.equal(verdict.confidence, 1);
    assert.match(verdict.reason, /more than 50% transparent/);
  });

  it("flags a shadow that is less than 50% transparent as partly transparent", async () => {
    const analysis = await analyzeAlpha(await shadowAt(200));
    const verdict = seeThroughVerdict(analysis);
    assert.ok(verdict, `expected a flag, translucentRatio ${analysis.translucentRatio}`);
    assert.equal(verdict.kind, "translucent");
    assert.match(verdict.reason, /partly transparent/);
  });

  it("flags artwork that is 20% transparent throughout", async () => {
    // The shape of the sample that exposed the 50%-only rule: no fade, no edge,
    // every pixel at alpha 204. It prints fully solid, not as shown.
    const verdict = seeThroughVerdict(await analyzeAlpha(await buildImage(() => 204)));
    assert.ok(verdict);
    assert.equal(verdict.kind, "translucent");
    assert.match(verdict.reason, /About 100% of the artwork is partly transparent/);
  });

  it("does not count anti-aliased edges", async () => {
    const analysis = await analyzeAlpha(await antiAliasedImage());
    assert.equal(analysis.faintRatio, 0);
    assert.equal(analysis.translucentRatio, 0);
    assert.equal(seeThroughVerdict(analysis), null);
  });

  it("does not flag a halftone made of solid dots, even when downscaled", async () => {
    // 3000px of 3px solid dots on a 6px grid: averaging it down would read as an
    // even grey at 25% opacity. Nearest sampling keeps every sample solid or empty.
    const halftone = await buildImage((x, y) => (x % 6 < 3 && y % 6 < 3 ? 255 : 0), 3000, 3000);
    const analysis = await analyzeAlpha(halftone);
    assert.equal(seeThroughVerdict(analysis), null, `halftone read as see-through: ${JSON.stringify(analysis)}`);
  });

  it("names a fade as a fade", async () => {
    const verdict = seeThroughVerdict(await analyzeAlpha(await fadeImage()));
    assert.ok(verdict);
    assert.equal(verdict.kind, "fade");
  });

  it("decides without the AI model and stamps the rules version", async () => {
    const result = await detectFade(await shadowAt(60));
    assert.equal(result.hasFade, true);
    assert.equal(result.source, "heuristic");
    assert.equal(result.version, TRANSPARENCY_CHECK_VERSION);
  });

  it("does not flag an opaque image or a hard cutout", async () => {
    for (const image of [await opaqueImage(), await buildImage((x, y) => (x >= 50 && x < 150 && y >= 50 && y < 150 ? 255 : 0))]) {
      const result = await detectFade(image);
      assert.equal(result.hasFade, false);
      assert.equal(result.version, TRANSPARENCY_CHECK_VERSION);
    }
  });
});
