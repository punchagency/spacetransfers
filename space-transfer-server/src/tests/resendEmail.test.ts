import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendViaResend } from "../services/email.service.js";

/**
 * Email goes through Resend now. These pin what we send and, as much, what a
 * failure looks like: an email that can't be sent must never take the request
 * that triggered it down with it, and must say why.
 */
const message = { to: "customer@example.com", subject: "Your order", html: "<p>Thanks</p>" };
const config = { apiKey: "re_test_123", from: "Space Transfers <support@spacetransfers.com>" };

const fakeFetch = (status: number, body: unknown, capture?: (url: string, init: RequestInit) => void) =>
  (async (url: any, init: any) => {
    capture?.(String(url), init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

describe("sendViaResend", () => {
  it("posts the message to Resend with the key, and reports the message id", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const result = await sendViaResend(message, config, fakeFetch(200, { id: "msg_1" }, (url, init) => (seen = { url, init })));
    assert.deepEqual(result, { sent: true, messageId: "msg_1", error: null });
    assert.equal(seen!.url, "https://api.resend.com/emails");
    assert.equal(seen!.init.method, "POST");
    assert.equal((seen!.init.headers as Record<string, string>).Authorization, "Bearer re_test_123");
    assert.deepEqual(JSON.parse(String(seen!.init.body)), { from: config.from, ...message });
  });

  it("reports Resend's own reason when it refuses the message", async () => {
    const result = await sendViaResend(message, config, fakeFetch(422, { name: "validation_error", message: "The from address is not verified" }));
    assert.equal(result.sent, false);
    assert.equal(result.error, "Resend 422: The from address is not verified");
  });

  it("does not throw when the network fails — it says so instead", async () => {
    const failing = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const result = await sendViaResend(message, config, failing);
    assert.equal(result.sent, false);
    assert.match(result.error!, /Resend request failed: fetch failed/);
  });

  it("names a timeout as a timeout", async () => {
    const timingOut = (async () => { throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); }) as unknown as typeof fetch;
    const result = await sendViaResend(message, config, timingOut);
    assert.match(result.error!, /did not respond within 15s/);
  });

  it("copes with an error response that is not JSON", async () => {
    const html = (async () => new Response("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" })) as unknown as typeof fetch;
    const result = await sendViaResend(message, config, html);
    assert.equal(result.sent, false);
    assert.equal(result.error, "Resend 502: Bad Gateway");
  });
});
