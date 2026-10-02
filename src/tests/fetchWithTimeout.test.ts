import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchWithTimeout, UpstreamTimeoutError } from "../utils/fetchWithTimeout.js";

/**
 * Calls out to storage and ShipStation had no time limit, so a stuck service
 * held the request open indefinitely. Past the limit they now fail as a 504
 * with a message fit to show.
 */
describe("fetchWithTimeout", () => {
  it("gives up on a service that never answers, with a 504", async () => {
    const server = http.createServer(() => { /* never responds */ });
    await new Promise<void>((r) => server.listen(0, r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      await assert.rejects(
        () => fetchWithTimeout(url, {}, 150, "Loading the image"),
        (e: any) => e instanceof UpstreamTimeoutError && e.statusCode === 504 && /Loading the image took too long/.test(e.message),
      );
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("returns the response when it arrives in time", async () => {
    const server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((r) => server.listen(0, r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      const res = await fetchWithTimeout(url, {}, 2_000);
      assert.equal(await res.text(), "ok");
    } finally {
      server.close();
    }
  });
});
