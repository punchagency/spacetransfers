import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildObjectKey, isR2Configured, publicUrlForKey } from "../services/storage.service.js";
import { env } from "../config/env.js";

/**
 * Artwork storage is the highest-stakes path in the platform: the file that is
 * stored is the file that gets printed. R2 is now the only store — Cloudinary,
 * which capped images at 10MB and downscaled print files on the way in, is
 * gone.
 *
 * These cover what can be proven without credentials: key construction, URL
 * shape, the thumbnail convention, and the refusal to store anything when the
 * bucket is not configured. The R2 round trip itself is unproven until the
 * client provisions station 05.
 */

describe("object keys", () => {
  it("never collide, even for identical uploads in the same folder", () => {
    const keys = new Set(Array.from({ length: 500 }, () => buildObjectKey("art", "image/png")));
    assert.equal(keys.size, 500);
  });

  it("carries no part of the caller's filename", () => {
    // A key that echoes a filename leaks it to anyone who can see the URL.
    const key = buildObjectKey("space-transfers/art", "image/png");
    assert.match(key, /^space-transfers\/art\/\d+-[0-9a-f]{24}\.png$/);
  });

  it("gives each type its real extension so browsers render rather than download", () => {
    for (const [type, ext] of [
      ["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"],
      ["image/tiff", "tif"], ["application/pdf", "pdf"],
    ] as const) {
      assert.ok(buildObjectKey("f", type).endsWith(`.${ext}`), type);
    }
  });

  it("falls back to .bin rather than guessing at an unknown type", () => {
    for (const t of [undefined, "", "application/x-thing"]) {
      assert.ok(buildObjectKey("f", t as any).endsWith(".bin"), String(t));
    }
  });

  it("strips path tricks out of the folder", () => {
    // A folder is a caller-supplied string; it must not be able to escape.
    assert.ok(!buildObjectKey("../../etc", "image/png").includes(".."));
    assert.ok(!buildObjectKey("/leading/", "image/png").startsWith("/"));
    assert.match(buildObjectKey("a b;c", "image/png"), /^a-b-c\//);
  });
});

describe("which backend serves", () => {
  it("requires all four R2 values — a half-configured bucket is the dangerous state", () => {
    // It would take the no-downscale path and then fail to store anything.
    const saved = {
      a: env.r2AccountId, k: env.r2AccessKeyId, s: env.r2SecretAccessKey, b: env.r2Bucket,
    };
    try {
      const set = (a?: string, k?: string, s?: string, b?: string) => {
        (env as any).r2AccountId = a; (env as any).r2AccessKeyId = k;
        (env as any).r2SecretAccessKey = s; (env as any).r2Bucket = b;
      };
      set("acc", "key", "secret", "bucket");
      assert.equal(isR2Configured(), true);
      for (const missing of [0, 1, 2, 3]) {
        const vals: (string | undefined)[] = ["acc", "key", "secret", "bucket"];
        vals[missing] = undefined;
        set(vals[0], vals[1], vals[2], vals[3]);
        assert.equal(isR2Configured(), false, `missing index ${missing}`);
      }
    } finally {
      (env as any).r2AccountId = saved.a; (env as any).r2AccessKeyId = saved.k;
      (env as any).r2SecretAccessKey = saved.s; (env as any).r2Bucket = saved.b;
    }
  });

  it("is off in this environment, so uploads fail loudly rather than storing elsewhere", async () => {
    assert.equal(isR2Configured(), false);
    const { storeArtwork } = await import("../services/storage.service.js");
    await assert.rejects(
      () => storeArtwork(Buffer.from("x"), "art"),
      (e: any) => e?.statusCode === 503,
      "an unconfigured server must refuse, not silently store somewhere unintended",
    );

    /*
     * And the refusal must not read like an operator's checklist.
     *
     * This used to assert the message *contained* `R2_ACCOUNT_ID` — pinning a
     * leak rather than catching one. That sentence went verbatim to a customer
     * whose upload had just failed, naming four of our environment variables.
     * The actionable version belongs in the log.
     */
    await assert.rejects(
      () => storeArtwork(Buffer.from("x"), "art"),
      (e: any) => !/R2_|ACCOUNT_ID|SECRET|BUCKET/.test(String(e?.message)),
      "the customer-facing message must not name our environment variables",
    );
  });
});

describe("public URLs", () => {
  it("prefers a custom domain when one is configured", () => {
    const saved = env.r2PublicBaseUrl;
    try {
      (env as any).r2PublicBaseUrl = "https://cdn.spacetransfers.com/";
      assert.equal(publicUrlForKey("art/x.png"), "https://cdn.spacetransfers.com/art/x.png");
    } finally {
      (env as any).r2PublicBaseUrl = saved;
    }
  });

  it("falls back to the bucket endpoint, which exposes the account id", () => {
    const saved = { base: env.r2PublicBaseUrl, acc: env.r2AccountId, b: env.r2Bucket };
    try {
      (env as any).r2PublicBaseUrl = undefined;
      (env as any).r2AccountId = "acc123";
      (env as any).r2Bucket = "space-transfers";
      // Worth a custom domain before launch: this account id ends up in every
      // artwork URL a customer can see.
      assert.equal(
        publicUrlForKey("art/x.png"),
        "https://acc123.r2.cloudflarestorage.com/space-transfers/art/x.png",
      );
    } finally {
      (env as any).r2PublicBaseUrl = saved.base;
      (env as any).r2AccountId = saved.acc;
      (env as any).r2Bucket = saved.b;
    }
  });
});

describe("thumbnails", () => {
  it("sit beside the original, which is the path computeThumbUrl derives", async () => {
    const { thumbKeyFor } = await import("../services/storage.service.js");
    // computeThumbUrl replaces everything from the last dot with this suffix,
    // so the two must agree exactly or every preview 404s.
    assert.equal(thumbKeyFor("art/123-abc.png"), "art/123-abc-thumb200.webp");
    assert.equal(thumbKeyFor("art/123-abc.pdf"), "art/123-abc-thumb200.webp");
  });

  it("handles a key with no extension rather than truncating the folder", () => {
    // "art/noext" has its last dot before the last slash, if any at all.
    return import("../services/storage.service.js").then(({ thumbKeyFor }) => {
      assert.equal(thumbKeyFor("art/noext"), "art/noext-thumb200.webp");
    });
  });
});

describe("artwork uploaded before the move to R2", () => {
  /*
   * 261 of the 350 assets on record point at Cloudinary. Nothing writes there
   * any more, but rejecting those URLs would break every existing design in the
   * editor — which is exactly what happened before this was added.
   */
  const legacy = "https://res.cloudinary.com/dzgutqnaq/image/upload/v1/space-transfers/assets/x.png";

  it("still accepts a legacy asset URL", async () => {
    const { isStoredArtworkUrl } = await import("../services/storage.service.js");
    assert.equal(isStoredArtworkUrl(legacy), true);
  });

  it("thumbnails legacy assets by transformation, since no thumb object exists for them", async () => {
    const { legacyCloudinaryThumbUrl } = await import("../services/storage.service.js");
    assert.match(legacyCloudinaryThumbUrl(legacy), /\/upload\/c_fill,w_200,h_200,q_auto,f_webp\//);
  });

  it("does not become an open door — the host must match exactly", async () => {
    const { isStoredArtworkUrl, isLegacyCloudinaryUrl } = await import("../services/storage.service.js");
    // This guard is what stops an arbitrary address being handed to the server
    // to fetch, so a prefix match on the wrong side of the dot must fail.
    for (const bad of [
      "https://res.cloudinary.com.evil.com/x.png",
      "https://evil.com/res.cloudinary.com/x.png",
      "http://res.cloudinary.com/x.png",
      "https://res-cloudinary.com/x.png",
      "",
    ]) {
      assert.equal(isLegacyCloudinaryUrl(bad), false, bad);
      assert.equal(isStoredArtworkUrl(bad), false, bad);
    }
  });
});
