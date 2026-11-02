import { describe, expect, it, vi } from "vitest";

vi.mock("@imgly/background-removal", () => ({ removeBackground: vi.fn() }));

import { detectPlainBackground, removePlainBackground } from "../components/artboard/lib/utils/bgRemover";

type RGB = [number, number, number];

/** A w×h image of one colour, with `paint` drawing the artwork over it. */
const image = (w: number, h: number, bg: RGB | ((x: number, y: number) => RGB), paint: (set: (x: number, y: number, c: RGB) => void) => void) => {
  const data = new Uint8ClampedArray(w * h * 4);
  const set = (x: number, y: number, c: RGB) => data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, typeof bg === "function" ? bg(x, y) : bg);
  paint(set);
  return data;
};
const alpha = (data: Uint8ClampedArray, w: number, x: number, y: number) => data[(y * w + x) * 4 + 3];
const BLACK: RGB = [10, 10, 10];

/** A 12px black ring: background outside it and, cut off from that, inside it. */
const ring = (set: (x: number, y: number, c: RGB) => void) => {
  for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) {
    const inner = x >= 32 && x < 48 && y >= 32 && y < 48;
    if (!inner) set(x, y, BLACK);
  }
};

describe("plain background detection", () => {
  it("recognises pure white, as before", () => {
    const bg = detectPlainBackground(image(80, 80, [255, 255, 255], ring), 80, 80);
    expect(bg?.kind).toBe("white");
  });

  it("recognises an off-white background with a soft gradient", () => {
    // 240 at the top down to 205 at the bottom: too dark for the pure-white rule.
    const data = image(80, 80, (_x, y) => { const v = 240 - Math.round((y / 79) * 35); return [v, v, v]; }, ring);
    const bg = detectPlainBackground(data, 80, 80);
    expect(bg?.kind).toBe("color");
    expect(bg!.tolerance).toBeGreaterThanOrEqual(30);
  });

  it("keeps the strict rule for true black", () => {
    expect(detectPlainBackground(image(80, 80, [0, 0, 0], () => {}), 80, 80)?.kind).toBe("black");
  });

  it("matches a dark backdrop that is not quite black by its own colour", () => {
    // A night sky: dark, with a blue cast the true-black rule refuses.
    const sky: RGB = [12, 16, 21];
    const data = image(80, 80, sky, (set) => {
      for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) {
        const d = (x - 40) ** 2 + (y - 40) ** 2;
        if (d <= 20 ** 2) set(x, y, d <= 8 ** 2 ? [48, 52, 61] : [150, 155, 165]);
      }
    });
    const bg = detectPlainBackground(data, 80, 80)!;
    expect(bg).toMatchObject({ kind: "color", r: 12, g: 16, b: 21 });
    removePlainBackground(data, 80, 80, bg, { clearEnclosed: true });
    expect(alpha(data, 80, 2, 2)).toBe(0);
    // The bright disc and the dark sea inside it both stay.
    expect(alpha(data, 80, 40, 25)).toBe(255);
    expect(alpha(data, 80, 40, 40)).toBe(255);
  });

  it("recognises a flat colour", () => {
    const bg = detectPlainBackground(image(80, 80, [30, 90, 200], ring), 80, 80);
    expect(bg).toMatchObject({ kind: "color", r: 30, g: 90, b: 200 });
  });

  it("recognises a plain background on an image cropped tight to its artwork", () => {
    // A disc touching all four edges, as auto-crop leaves it.
    const data = image(80, 80, [245, 240, 230], (set) => {
      for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if ((x - 39.5) ** 2 + (y - 39.5) ** 2 <= 40 ** 2) set(x, y, BLACK);
    });
    expect(detectPlainBackground(data, 80, 80)?.kind).toBe("color");
  });

  it("does not call scenery plain: sky above, ground below", () => {
    const data = image(80, 80, (_x, y) => (y < 60 ? [120, 170, 230] : [70, 110, 50]), () => {});
    expect(detectPlainBackground(data, 80, 80)).toBeNull();
  });

  it("does not call a busy border plain", () => {
    const data = image(80, 80, (x, y) => [(x * 37) % 256, (y * 53) % 256, ((x + y) * 19) % 256], () => {});
    expect(detectPlainBackground(data, 80, 80)).toBeNull();
  });
});

describe("plain background removal", () => {
  const run = (bgColour: RGB | ((x: number, y: number) => RGB), clearEnclosed: boolean) => {
    const data = image(80, 80, bgColour, ring);
    removePlainBackground(data, 80, 80, detectPlainBackground(data, 80, 80)!, { clearEnclosed });
    return data;
  };

  it("makes the background around the artwork transparent and keeps the artwork", () => {
    const data = run([255, 255, 255], false);
    expect(alpha(data, 80, 2, 2)).toBe(0);
    expect(alpha(data, 80, 25, 25)).toBe(255);
  });

  it("keeps background the artwork encloses when asked to", () => {
    expect(alpha(run([255, 255, 255], false), 80, 40, 40)).toBe(255);
  });

  it("clears background the artwork encloses when asked to", () => {
    const data = run([255, 255, 255], true);
    expect(alpha(data, 80, 40, 40)).toBe(0);
    expect(alpha(data, 80, 25, 25)).toBe(255);
  });

  it("clears a gradient off-white background, inside and out", () => {
    const data = run((_x, y) => { const v = 240 - Math.round((y / 79) * 35); return [v, v, v]; }, true);
    expect(alpha(data, 80, 2, 2)).toBe(0);
    expect(alpha(data, 80, 2, 77)).toBe(0);
    expect(alpha(data, 80, 40, 40)).toBe(0);
    expect(alpha(data, 80, 25, 25)).toBe(255);
  });

  it("clears a flat colour and leaves other colours alone", () => {
    const data = image(80, 80, [30, 90, 200], (set) => {
      ring(set);
      for (let y = 36; y < 44; y++) for (let x = 36; x < 44; x++) set(x, y, [255, 255, 255]);
    });
    removePlainBackground(data, 80, 80, detectPlainBackground(data, 80, 80)!, { clearEnclosed: true });
    expect(alpha(data, 80, 2, 2)).toBe(0);
    expect(alpha(data, 80, 33, 33)).toBe(0);
    expect(alpha(data, 80, 40, 40)).toBe(255);
  });

  it("keeps a speck of background colour inside the artwork", () => {
    const data = image(80, 80, [255, 255, 255], (set) => {
      for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) set(x, y, BLACK);
      set(40, 40, [255, 255, 255]);
    });
    removePlainBackground(data, 80, 80, detectPlainBackground(data, 80, 80)!, { clearEnclosed: true });
    expect(alpha(data, 80, 40, 40)).toBe(255);
  });

  it("never changes the colour of a pixel it keeps away from the cut edge", () => {
    const data = run([255, 255, 255], true);
    const i = (26 * 80 + 26) * 4;
    expect([data[i], data[i + 1], data[i + 2]]).toEqual(BLACK);
  });
});
