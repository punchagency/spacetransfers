import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDataUrl } from "../utils/designThumbnail.js";

const png = "data:image/png;base64,iVBORw0KGgo=";

test("reads the bytes and type out of a data URL", () => {
  const parsed = parseDataUrl(png);
  assert.ok(parsed);
  assert.equal(parsed!.contentType, "image/png");
  assert.ok(parsed!.buffer.length > 0);
});

test("an already-stored URL is not a data URL, and passes through untouched", () => {
  assert.equal(parseDataUrl("https://cdn.example.com/design-thumbnails/abc.webp"), null);
});

test("ignores anything that is not an image, empty, or not a string", () => {
  // A non-image data URL is not a preview picture — storing it would put
  // arbitrary bytes in the artwork bucket.
  assert.equal(parseDataUrl("data:text/html;base64,PGh0bWw+"), null);
  assert.equal(parseDataUrl("data:image/png;base64,"), null);
  assert.equal(parseDataUrl(""), null);
  assert.equal(parseDataUrl(undefined), null);
  assert.equal(parseDataUrl(null), null);
  assert.equal(parseDataUrl(42), null);
});
