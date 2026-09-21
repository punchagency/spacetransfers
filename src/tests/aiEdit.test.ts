/**
 * AI editing pipeline tests — instruction building and output conformance.
 * Run with: npm test
 * Uses Node.js built-in test runner (node:test), no database and no API keys.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { buildEditRequest } from "../controllers/customer.controller.js";
import { conformToSource, readSourceGeometry } from "../utils/generativeImage.js";
import { PLANNABLE_INTENTS } from "../services/gemini.service.js";

/** Solid-colour test image at an exact size. */
const makeImage = (
  width: number,
  height: number,
  options: { alpha?: boolean } = {},
): Promise<Buffer> => {
  const channels = options.alpha ? 4 : 3;
  const background = options.alpha
    ? { r: 200, g: 40, b: 40, alpha: 0.5 }
    : { r: 200, g: 40, b: 40 };
  const pipeline = sharp({ create: { width, height, channels, background } });
  return (options.alpha ? pipeline.png() : pipeline.jpeg()).toBuffer();
};

describe("buildEditRequest", () => {
  it("leads with the user's own words", () => {
    const built = buildEditRequest("remove-object", "Remove the coffee cup");
    assert.ok(
      built.instruction.startsWith("Remove the coffee cup"),
      `instruction should lead with the prompt, got: ${built.instruction}`,
    );
  });

  it("appends the per-intent guard and negative guidance", () => {
    const built = buildEditRequest("remove-object", "Remove the coffee cup");
    assert.match(built.instruction, /reconstruct what would be behind it/i);
    // flux-kontext exposes no negative_prompt, so the avoid list has to travel
    // inside the instruction text or it is silently lost.
    assert.match(built.instruction, /Avoid all of the following:/);
    assert.match(built.instruction, /ghosting of the removed object/i);
  });

  it("always carries the global text-preservation guard", () => {
    // This is the guard that stops a model re-rendering a word into plausible
    // gibberish, which is the most expensive artefact to find after printing.
    for (const intent of ["remove-color", "outpaint", "custom"]) {
      const built = buildEditRequest(intent, "do the thing");
      assert.match(built.instruction, /Keep any text in the image exactly as written/i);
    }
  });

  it("tunes every intent the planner is allowed to emit", () => {
    // A planner-emitted intent with no tuning would fall through to the bare
    // global guard, quietly losing the constraints that keep an edit from
    // bleeding outside its target.
    const untuned = PLANNABLE_INTENTS.filter((intent) => {
      const built = buildEditRequest(intent, "test prompt");
      return !built.instruction.includes("Avoid all of the following:");
    });
    // Resolution work is served by the dedicated upscale endpoint and its own
    // model chain, never by instruction editing, and `custom` is free-form by
    // definition — so these three legitimately carry no generative tuning.
    // Everything else must, including the intents that normally run locally:
    // the generative tier is the fallback for all of them.
    const expectedUntuned = ["upscale", "enhance", "custom"];
    assert.deepEqual(untuned.slice().sort(), expectedUntuned.slice().sort());
  });

  it("only sends optional inputs the model actually declares", () => {
    // A strict model API rejects the whole request if it receives a field
    // the model doesn't declare, so a seed must not be sent blindly.
    const built = buildEditRequest("remove-object", "Remove the cup", 1234);
    assert.equal(built.extraInput.seed, 1234);
    assert.equal(built.extraInput.negative_prompt, undefined);
  });

  it("truncates a fractional seed rather than passing it through", () => {
    const built = buildEditRequest("remove-object", "Remove the cup", 42.9);
    assert.equal(built.extraInput.seed, 42);
  });

  it("omits the seed entirely when none is given", () => {
    const built = buildEditRequest("remove-object", "Remove the cup");
    assert.equal("seed" in built.extraInput, false);
  });
});

describe("conformToSource", () => {
  it("restores the source's exact pixel dimensions", async () => {
    // The case that matters: a 4000px print file edited by a model that renders
    // at 1024 would otherwise drop from 300 DPI to 77 without anything failing.
    const source = await makeImage(2000, 1000);
    const edited = await makeImage(1024, 512);

    const geometry = await readSourceGeometry(source);
    const conformed = await conformToSource(edited, geometry);

    assert.equal(conformed.widthPx, 2000);
    assert.equal(conformed.heightPx, 1000);
    assert.equal(conformed.upsampled, true);
    assert.equal(conformed.cropped, false);
  });

  it("crops rather than stretches when the model changed the aspect ratio", async () => {
    const source = await makeImage(1600, 800);
    // Square output from a 2:1 source — stretching this would visibly distort
    // the subject inside an unchanged print box.
    const edited = await makeImage(1024, 1024);

    const geometry = await readSourceGeometry(source);
    const conformed = await conformToSource(edited, geometry);

    assert.equal(conformed.cropped, true);
    assert.equal(conformed.widthPx, 1600);
    assert.equal(conformed.heightPx, 800);

    const meta = await sharp(conformed.buffer).metadata();
    assert.equal(meta.width, 1600);
    assert.equal(meta.height, 800);
  });

  it("passes an already-conforming result through untouched", async () => {
    const source = await makeImage(800, 600);
    const edited = await makeImage(800, 600);

    const geometry = await readSourceGeometry(source);
    const conformed = await conformToSource(edited, geometry);

    assert.equal(conformed.upsampled, false);
    assert.equal(conformed.cropped, false);
    // Byte-identical: re-encoding a conforming result would only lose quality.
    assert.equal(conformed.buffer, edited);
  });

  it("preserves the alpha channel when the source had one", async () => {
    // A cutout that comes back opaque is not a cutout — this is the guard
    // against a transparent background being flattened onto white.
    const source = await makeImage(1200, 1200, { alpha: true });
    const edited = await makeImage(512, 512, { alpha: true });

    const geometry = await readSourceGeometry(source);
    assert.equal(geometry.hasAlpha, true);

    const conformed = await conformToSource(edited, geometry);
    const meta = await sharp(conformed.buffer).metadata();
    assert.equal(meta.hasAlpha, true);
    assert.equal(meta.format, "png");
  });

  it("does not force PNG on an opaque source", async () => {
    // A 4000px PNG of a photograph is an order of magnitude larger than the
    // JPEG for no visible gain, and these are uploaded on every edit.
    const source = await makeImage(2400, 1600);
    const edited = await makeImage(1024, 683);

    const geometry = await readSourceGeometry(source);
    const conformed = await conformToSource(edited, geometry);

    const meta = await sharp(conformed.buffer).metadata();
    assert.equal(meta.format, "jpeg");
  });

  it("downscales an oversized result back to the source", async () => {
    const source = await makeImage(1000, 1000);
    const edited = await makeImage(2048, 2048);

    const geometry = await readSourceGeometry(source);
    const conformed = await conformToSource(edited, geometry);

    assert.equal(conformed.widthPx, 1000);
    assert.equal(conformed.heightPx, 1000);
    // Larger than the source is not "upsampled" — nothing was invented.
    assert.equal(conformed.upsampled, false);
  });
});
