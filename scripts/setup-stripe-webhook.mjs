#!/usr/bin/env node
/**
 * Registers this API's Stripe webhook, so partners' payout results and Connect
 * onboarding reach the API.
 *
 * Usage:
 *   node scripts/setup-stripe-webhook.mjs https://api.yourdomain.com
 *
 * Uses STRIPE_SECRET_KEY from the environment or .env. The endpoint belongs to
 * the key's mode: run it once with the test key and again with the live key.
 *
 * Partners are paid out on their own connected accounts, so the events the API
 * handles (account.updated, payout.paid, payout.failed) come from connected
 * accounts: this is a Connect endpoint. Stripe shows its signing secret only
 * when it is created; the script prints it once, to put in STRIPE_WEBHOOK_SECRET.
 * Running it again for the same address updates the events and keeps the secret.
 */
import "dotenv/config";
import Stripe from "stripe";

const EVENTS = ["account.updated", "payout.paid", "payout.failed"];

const key = (process.env.STRIPE_SECRET_KEY || "").trim();
const base = (process.argv[2] || "").trim().replace(/\/+$/, "");

if (!key || !/^https:\/\//.test(base)) {
  console.error("Usage: node scripts/setup-stripe-webhook.mjs https://api.yourdomain.com");
  console.error("Needs STRIPE_SECRET_KEY in the environment; Stripe only calls https addresses.");
  process.exit(1);
}

const stripe = new Stripe(key);
const url = `${base}/api/payouts/webhook`;
const mode = key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : "test";

const existing = [];
for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
  if (endpoint.url === url && endpoint.application == null) existing.push(endpoint);
}
// A Connect endpoint is the one whose events come from connected accounts.
const connect = existing.find((e) => e.connect === true) ?? null;

if (connect) {
  await stripe.webhookEndpoints.update(connect.id, { enabled_events: EVENTS, disabled: false });
  console.log(`Updated the existing ${mode} Connect webhook ${connect.id} → ${url}`);
  console.log(`Events: ${EVENTS.join(", ")}`);
  console.log("Its signing secret is unchanged: Stripe Dashboard → Developers → Webhooks → this endpoint → Signing secret.");
} else {
  const created = await stripe.webhookEndpoints.create({
    url,
    connect: true,
    enabled_events: EVENTS,
    description: "Space Transfers API: partner payouts and Connect onboarding",
  });
  console.log(`Registered ${mode} Connect webhook ${created.id} → ${url}`);
  console.log(`Events: ${EVENTS.join(", ")}`);
  console.log("");
  console.log("Set this as STRIPE_WEBHOOK_SECRET on the API, then redeploy. It is shown only now:");
  console.log(created.secret);
}

const platformOnly = existing.filter((e) => e.connect !== true);
if (platformOnly.length) {
  console.log("");
  console.log(`Note: ${platformOnly.length} non-Connect endpoint(s) also point at ${url} (${platformOnly.map((e) => e.id).join(", ")}).`);
  console.log("They receive the platform's own events and sign with a different secret, so their deliveries fail. Delete them in the Dashboard.");
}
