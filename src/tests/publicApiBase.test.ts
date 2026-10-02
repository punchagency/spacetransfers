import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { apiFileUrl, publicApiBase, resolveApiFile } from "../utils/publicApiBase.js";

/**
 * Links to files the API serves must point at the API, not at APP_URL (the
 * store). They used to take APP_URL, so on any deployment with separate hosts
 * every print-partner preview loaded the store's page and was blocked.
 */
const req = (headers: Record<string, string>, protocol = "http") => ({
  protocol,
  get: (name: string) => headers[name.toLowerCase()],
});

describe("publicApiBase", () => {
  it("uses the public scheme and host the proxy forwarded", () => {
    assert.equal(
      publicApiBase(req({ host: "st-api:4000", "x-forwarded-proto": "https", "x-forwarded-host": "api.spacetransfers.com" })),
      "https://api.spacetransfers.com",
    );
  });

  it("falls back to the Host header and the request's own scheme", () => {
    assert.equal(publicApiBase(req({ host: "localhost:4000" })), "http://localhost:4000");
  });

  it("takes the first value when a header lists several proxies", () => {
    assert.equal(
      publicApiBase(req({ host: "x", "x-forwarded-proto": "https, http", "x-forwarded-host": "api.a.com, b.internal" })),
      "https://api.a.com",
    );
  });

  it("never invents a host", () => {
    assert.equal(publicApiBase(req({})), null);
    assert.equal(apiFileUrl(req({}), "/uploads/x.webp"), "/uploads/x.webp");
  });

  it("builds a file link on the API, not the store", () => {
    const url = apiFileUrl(req({ host: "api.stdemo.example.com", "x-forwarded-proto": "https" }), "/uploads/exports/a.webp");
    assert.equal(url, "https://api.stdemo.example.com/uploads/exports/a.webp");
  });
});

describe("resolveApiFile", () => {
  const api = req({ host: "api.stdemo.example.com", "x-forwarded-proto": "https" });

  it("puts the API's address in front of a stored path", () => {
    assert.equal(resolveApiFile(api, "/uploads/exports/p.webp"), "https://api.stdemo.example.com/uploads/exports/p.webp");
  });

  it("re-bases old absolute links that point at localhost or the store", () => {
    assert.equal(
      resolveApiFile(api, "http://localhost:4000/uploads/exports/p.webp"),
      "https://api.stdemo.example.com/uploads/exports/p.webp",
    );
    assert.equal(
      resolveApiFile(api, "https://store.stdemo.example.com/uploads/exports/p.webp?v=2"),
      "https://api.stdemo.example.com/uploads/exports/p.webp?v=2",
    );
  });

  it("leaves artwork in storage and inline images alone", () => {
    const r2 = "https://pub-abc.r2.dev/space-transfers/assets/x.png";
    assert.equal(resolveApiFile(api, r2), r2);
    assert.equal(resolveApiFile(api, "data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  });

  it("has nothing to say about nothing", () => {
    assert.equal(resolveApiFile(api, null), null);
    assert.equal(resolveApiFile(api, ""), null);
  });
});
