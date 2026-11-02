import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import Stripe from "stripe";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import app from "../app.js";

/**
 * Stripe signs the exact bytes it sends, so the webhook must see the raw body.
 * The app's global JSON parser used to run first and hand the handler a parsed
 * object — every genuine event then failed signature verification with a 400,
 * so payout and Connect-account updates never landed.
 */
describe("Stripe webhook", () => {
  let server: Server;
  let base = "";
  const saved = env.stripeWebhookSecret;
  before(async () => {
    (env as any).stripeWebhookSecret = "whsec_test_secret";
    // Past the app's "database unavailable" guard; the event used here is one
    // the handler ignores, so nothing touches the database.
    Object.defineProperty(mongoose.connection, "readyState", { configurable: true, get: () => 1 });
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => {
    delete (mongoose.connection as any).readyState;
    (env as any).stripeWebhookSecret = saved;
    server.close();
  });

  it("verifies a correctly signed event", async () => {
    const payload = JSON.stringify({ id: "evt_test", object: "event", type: "test.unhandled", data: { object: {} } });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" });
    const res = await fetch(`${base}/api/payouts/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Stripe-Signature": header },
      body: payload,
    });
    const text = await res.text();
    assert.equal(res.status, 200, `signature check failed: ${text}`);
  });
});
