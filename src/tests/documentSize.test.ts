/**
 * Document-size and image-bounds guards.
 * Run with: npm test — no network, no API key, no database.
 *
 * These pin the fix for the production error
 *
 *     RangeError: The value of "offset" is out of range.
 *     It must be >= 0 && <= 17825792. Received 17825794
 *
 * which is what MongoDB's BSON serializer throws when a document exceeds the
 * 16 MiB cap (17825792 = 17 MiB, its scratch buffer). The tests below assert
 * that such a document is refused *before* the driver sees it, with an error
 * that names the offending field — the old failure named nothing at all.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BSON } from "mongodb";

import {
  assertPersistable,
  bsonSize,
  largestFields,
  MONGO_DOC_LIMIT_BYTES,
  SAFE_DOC_LIMIT_BYTES,
} from "../utils/documentSize.js";
import {
  assertBufferWithinBounds,
  decodeDataUrl,
  MAX_IMAGE_BYTES,
} from "../utils/imageBounds.js";

/** A data URL of roughly `mb` megabytes, shaped like a real editor output. */
const dataUrlOfMb = (mb: number) =>
  `data:image/png;base64,${"A".repeat(Math.floor(mb * 1024 * 1024))}`;

describe("bsonSize", () => {
  it("measures a small document in bytes", () => {
    const size = bsonSize({ a: "hello" });
    assert.ok(size > 0 && size < 100, `unexpected size ${size}`);
  });

  it("returns Infinity for something unserializable rather than throwing", () => {
    // The guard must never itself become a source of 500s.
    const cyclic: any = {};
    cyclic.self = cyclic;
    assert.equal(bsonSize(cyclic), Infinity);
  });
});

describe("largestFields", () => {
  it("reports leaf paths, not top-level keys", () => {
    const doc = {
      items: [{ artboardItems: [{ croppedUrl: "x".repeat(5000), id: "a" }] }],
      status: "PENDING",
    };

    const [biggest] = largestFields(doc);
    assert.equal(biggest.path, "items[0].artboardItems[0].croppedUrl");
    assert.equal(biggest.bytes, 5000);
  });

  it("flags embedded data URLs, which are the usual cause", () => {
    const doc = { items: [{ url: dataUrlOfMb(1) }] };
    const [biggest] = largestFields(doc);
    assert.equal(biggest.isDataUrl, true);
  });

  it("does not hang on a cyclic document", () => {
    // Mongoose documents can hold parent back-references.
    const doc: any = { name: "x" };
    doc.parent = doc;
    assert.doesNotThrow(() => largestFields(doc));
  });

  it("counts bytes rather than UTF-16 code units", () => {
    // "€" is 1 code unit but 3 UTF-8 bytes; the limit is measured in bytes.
    const [biggest] = largestFields({ s: "€".repeat(100) });
    assert.equal(biggest.bytes, 300);
  });
});

describe("assertPersistable", () => {
  it("accepts a correctly materialized order", () => {
    // A real order references hosted URLs, so it is kilobytes, not megabytes.
    const order = {
      items: Array.from({ length: 500 }, (_, i) => ({
        id: `item-${i}`,
        url: "https://res.cloudinary.com/demo/image/upload/v1/space-transfers/abc123.png",
      })),
    };
    assert.doesNotThrow(() => assertPersistable(order, { label: "order" }));
  });

  it("refuses a document over the limit with a 413, not a RangeError", () => {
    const order = { items: [{ croppedUrl: dataUrlOfMb(20) }] };

    assert.throws(
      () => assertPersistable(order, { label: "order" }),
      (err: any) =>
        err.statusCode === 413 &&
        err.code === "DOCUMENT_TOO_LARGE" &&
        !(err instanceof RangeError),
    );
  });

  it("intercepts the document shape that actually throws the offset RangeError", () => {
    // Reproduces the reported production failure exactly:
    //
    //   RangeError: The value of "offset" is out of range.
    //   It must be >= 0 && <= 17825792. Received 17825794
    //
    // It takes *many* fields to trigger, not one huge one. bson's `serialize`
    // grows its shared buffer only to MAXSIZE (17 MiB), then walks the document
    // writing at an advancing index; the throw comes from `Buffer.write` once
    // that index passes the buffer length. A single oversized string writes at
    // a low offset and is silently truncated instead — which is why the crash
    // only ever appeared with several images on the board.
    const order = {
      items: [
        {
          artboardItems: Array.from({ length: 40 }, (_, i) => ({
            id: `item-${i}`,
            croppedUrl: dataUrlOfMb(0.5),
          })),
        },
      ],
    };

    // Without the guard this is what the driver does.
    assert.throws(
      () => BSON.serialize(order as any),
      (err: any) => err instanceof RangeError && /offset/.test(err.message),
      "expected raw BSON serialization to fail with the offset RangeError",
    );

    // With it, the request is refused first, with something actionable.
    assert.throws(
      () => assertPersistable(order, { label: "order" }),
      (err: any) => err.statusCode === 413 && err.code === "DOCUMENT_TOO_LARGE",
    );
  });

  it("names the offending field and identifies it as embedded artwork", () => {
    const order = { items: [{ artboardItems: [{ croppedUrl: dataUrlOfMb(20) }] }] };

    try {
      assertPersistable(order, { label: "order" });
      assert.fail("expected assertPersistable to throw");
    } catch (err: any) {
      const [worst] = err.details.offenders;
      assert.equal(worst.path, "items[0].artboardItems[0].croppedUrl");
      assert.equal(worst.isDataUrl, true);
      // The customer-facing message must say the artwork is safe, because it is
      // — nothing was saved, and the design is still in the browser.
      assert.match(err.message, /your artwork is safe/i);
    }
  });

  it("distinguishes sheer size from embedded artwork in its message", () => {
    // No data URLs — many hosted references instead. The advice differs: this
    // customer needs to split the sheet, not reload the page.
    const order = {
      items: Array.from({ length: 400_000 }, () => ({
        url: "https://res.cloudinary.com/demo/image/upload/v1/x.png",
      })),
    };

    try {
      assertPersistable(order, { label: "order" });
      assert.fail("expected assertPersistable to throw");
    } catch (err: any) {
      assert.match(err.message, /split it across/i);
    }
  });

  it("leaves headroom below MongoDB's real cap for Mongoose-added fields", () => {
    // _id, __v and timestamps are added after this check runs, so refusing at
    // exactly 16 MiB would still let documents through that the driver rejects.
    assert.ok(SAFE_DOC_LIMIT_BYTES < MONGO_DOC_LIMIT_BYTES);
    assert.ok(MONGO_DOC_LIMIT_BYTES - SAFE_DOC_LIMIT_BYTES >= 1024 * 1024);
  });

  it("honours an explicit limit override", () => {
    assert.throws(
      () => assertPersistable({ s: "x".repeat(2048) }, { label: "t", limitBytes: 1024 }),
      (err: any) => err.code === "DOCUMENT_TOO_LARGE",
    );
  });
});

describe("decodeDataUrl", () => {
  it("decodes a well-formed data URL", () => {
    const png = Buffer.from("hello world");
    const buffer = decodeDataUrl(`data:image/png;base64,${png.toString("base64")}`);
    assert.equal(buffer.toString(), "hello world");
  });

  it("rejects a data URL with no comma", () => {
    assert.throws(
      () => decodeDataUrl("data:image/png;base64"),
      (err: any) => err.code === "MALFORMED_DATA_URL" && err.statusCode === 400,
    );
  });

  it("rejects an empty payload", () => {
    assert.throws(
      () => decodeDataUrl("data:image/png;base64,"),
      (err: any) => err.code === "EMPTY_IMAGE",
    );
  });

  it("rejects non-base64 encodings rather than mis-decoding them", () => {
    assert.throws(
      () => decodeDataUrl("data:image/png,rawbytes"),
      (err: any) => err.code === "UNSUPPORTED_DATA_URL_ENCODING",
    );
  });

  it("refuses an oversized payload before allocating it", () => {
    const oversized = `data:image/png;base64,${"A".repeat(MAX_IMAGE_BYTES * 2)}`;
    assert.throws(
      () => decodeDataUrl(oversized),
      (err: any) => err.code === "IMAGE_TOO_LARGE",
    );
  });
});

describe("assertBufferWithinBounds", () => {
  it("rejects an empty buffer", () => {
    assert.throws(
      () => assertBufferWithinBounds(Buffer.alloc(0)),
      (err: any) => err.code === "EMPTY_IMAGE",
    );
  });

  it("passes a normal buffer through unchanged", () => {
    const buffer = Buffer.from("abc");
    assert.equal(assertBufferWithinBounds(buffer), buffer);
  });
});
