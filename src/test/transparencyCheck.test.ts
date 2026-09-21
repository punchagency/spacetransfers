import { describe, expect, it } from "vitest";
import {
  checkFade,
  seeThroughShares,
  shouldWarn,
  transparencyMessage,
  verdictFromMeasurements,
} from "../components/artboard/lib/utils/fadeCheck";

const W = 100;
const H = 100;
const alphaOf = (at: (x: number, y: number) => number) => {
  const alpha = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) alpha[y * W + x] = at(x, y);
  return alpha;
};

/** A solid square plus an offset shadow at `shadow` alpha. */
const withShadow = (shadow: number) =>
  alphaOf((x, y) => {
    if (x >= 15 && x < 60 && y >= 15 && y < 60) return 255;
    if (x >= 25 && x < 70 && y >= 25 && y < 70) return shadow;
    return 0;
  });

const none = { semiRatio: 0, interiorSemiRatio: 0, maxRampRatio: 0, faintRatio: 0, translucentRatio: 0 };

describe("seeThroughShares", () => {
  it("measures a shadow more than 50% transparent as faint", () => {
    const { faint, translucent } = seeThroughShares(withShadow(90), W, H);
    expect(faint).toBeGreaterThan(0.2);
    expect(translucent).toBe(0);
  });

  it("measures a shadow less than 50% transparent as translucent", () => {
    const { faint, translucent } = seeThroughShares(withShadow(200), W, H);
    expect(faint).toBe(0);
    expect(translucent).toBeGreaterThan(0.2);
  });

  it("ignores anti-aliased edges", () => {
    const antiAliased = alphaOf((x, y) => {
      const inside = x >= 20 && x < 80 && y >= 20 && y < 80;
      const edge = (x === 19 || x === 80 || y === 19 || y === 80) && x >= 19 && x <= 80 && y >= 19 && y <= 80;
      return inside ? 255 : edge ? 100 : 0;
    });
    expect(seeThroughShares(antiAliased, W, H)).toEqual({ faint: 0, translucent: 0 });
  });

  it("ignores fully opaque artwork", () => {
    expect(seeThroughShares(alphaOf(() => 255), W, H)).toEqual({ faint: 0, translucent: 0 });
  });
});

describe("verdictFromMeasurements", () => {
  it("flags 1% or more of faint artwork, measured and certain", () => {
    const verdict = verdictFromMeasurements({ ...none, semiRatio: 0.3, interiorSemiRatio: 0.3, faintRatio: 0.12 });
    expect(verdict).toMatchObject({ hasFade: true, confidence: 1, kind: "semi-transparent" });
    expect(verdict.reason).toBe("About 12% of the artwork is more than 50% transparent.");
    expect(shouldWarn(verdict)).toBe(true);
  });

  it("flags artwork 20% transparent throughout as partly transparent", () => {
    // The sample that exposed the 50%-only rule: every pixel at alpha 204.
    const alpha = alphaOf(() => 204);
    const { faint, translucent } = seeThroughShares(alpha, W, H);
    const verdict = verdictFromMeasurements({ ...none, semiRatio: 1, interiorSemiRatio: 1, faintRatio: faint, translucentRatio: translucent });
    expect(verdict).toMatchObject({ hasFade: true, kind: "translucent" });
    expect(verdict.reason).toBe("About 100% of the artwork is partly transparent.");
  });

  it("does not flag a few stray see-through pixels", () => {
    const verdict = verdictFromMeasurements({ ...none, semiRatio: 0.004, faintRatio: 0.002, translucentRatio: 0.002 });
    expect(shouldWarn(verdict)).toBe(false);
  });

  it("calls a see-through fade a fade", () => {
    const verdict = verdictFromMeasurements({ semiRatio: 0.9, interiorSemiRatio: 0.9, maxRampRatio: 0.9, faintRatio: 0.45, translucentRatio: 0.4 });
    expect(verdict.kind).toBe("fade");
    expect(shouldWarn(verdict)).toBe(true);
  });
});

describe("transparencyMessage", () => {
  it("tells the customer to update or replace the file", () => {
    const { title, body } = transparencyMessage(
      verdictFromMeasurements({ ...none, semiRatio: 0.3, interiorSemiRatio: 0.3, faintRatio: 0.2 }),
    );
    expect(title).toBe("Too transparent to print");
    expect(body).toContain("Update the file to make those areas solid, or replace it with a different file.");
  });

  it("says partly transparent areas print solid", () => {
    const { title, body } = transparencyMessage(
      verdictFromMeasurements({ ...none, semiRatio: 1, interiorSemiRatio: 1, translucentRatio: 1 }),
    );
    expect(title).toBe("Partly transparent");
    expect(body).toContain("will print solid, stronger than they look on screen");
    expect(body).toContain("or replace it with a different file.");
  });

  it("names a fade", () => {
    const { title, body } = transparencyMessage({ hasFade: true, confidence: 0.8, kind: "fade", reason: "", source: "ai" });
    expect(title).toBe("Fade detected");
    expect(body).toContain("Update the file to remove the fade, or replace it with a different file.");
  });
});

describe("checkFade", () => {
  it("remembers the upload's verdict for that URL", async () => {
    const serverVerdict = { hasFade: true, confidence: 1, kind: "semi-transparent", reason: "r", source: "heuristic" };
    const first = await checkFade("https://cdn.example/a.png", serverVerdict);
    const again = await checkFade("https://cdn.example/a.png");
    expect(again).toBe(first);
  });
});
