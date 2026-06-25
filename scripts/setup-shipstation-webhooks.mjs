#!/usr/bin/env node
/**
 * One-time script — registers ShipStation webhooks for SHIP_NOTIFY and ORDER_NOTIFY.
 *
 * Usage:
 *   node scripts/setup-shipstation-webhooks.mjs https://your-server.com
 *
 * The public URL you pass must be reachable by ShipStation's servers.
 * For local testing, use an ngrok tunnel: ngrok http 4000
 * then pass the https://xxxx.ngrok.io URL as the argument.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));

// Load .env manually (avoid needing dotenv installed as a script dep).
const envPath = join(__dir, "../.env");
const envLines = readFileSync(envPath, "utf-8").split("\n");
const env = {};
for (const line of envLines) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const KEY    = env.SHIPSTATION_API_KEY;
const SECRET = env.SHIPSTATION_API_SECRET;
const TOKEN  = env.SHIPSTATION_WEBHOOK_SECRET;

if (!KEY || !SECRET) {
  console.error("❌  SHIPSTATION_API_KEY / SHIPSTATION_API_SECRET not set in .env");
  process.exit(1);
}

const publicUrl = process.argv[2];
if (!publicUrl || publicUrl.startsWith("http://localhost")) {
  console.error(
    "❌  Pass your public server URL as the first argument.\n" +
    "    Example: node scripts/setup-shipstation-webhooks.mjs https://your-server.com\n" +
    "    For local dev: start ngrok (ngrok http 4000) and pass the https tunnel URL."
  );
  process.exit(1);
}

const base      = "https://ssapi.shipstation.com";
const authCreds = Buffer.from(`${KEY}:${SECRET}`).toString("base64");
const headers   = { Authorization: `Basic ${authCreds}`, "Content-Type": "application/json" };

async function ssGet(path) {
  const r = await fetch(`${base}${path}`, { headers });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

async function ssPost(path, body) {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

async function ssDelete(path) {
  const r = await fetch(`${base}${path}`, { method: "DELETE", headers });
  if (!r.ok) throw new Error(`DELETE ${path} → ${r.status}: ${await r.text()}`);
  return r.ok;
}

const webhookUrl = `${publicUrl.replace(/\/$/, "")}/api/webhooks/shipstation${TOKEN ? `?token=${TOKEN}` : ""}`;

const EVENTS = ["SHIP_NOTIFY", "ORDER_NOTIFY"];

(async () => {
  console.log("\n🚀  ShipStation Webhook Setup");
  console.log(`   Target URL : ${webhookUrl}`);
  console.log(`   Events     : ${EVENTS.join(", ")}\n`);

  // 1. List existing webhooks.
  const { webhooks: existing = [] } = await ssGet("/webhooks");
  console.log(`Found ${existing.length} existing webhook(s):`);
  for (const wh of existing) {
    console.log(`  • [${wh.WebHookID}] ${wh.Event} → ${wh.Target}`);
  }

  // 2. Remove any existing subscriptions for our events at any URL (clean slate).
  const toDelete = existing.filter((wh) => EVENTS.includes(wh.Event));
  if (toDelete.length > 0) {
    console.log(`\n🗑   Removing ${toDelete.length} existing subscription(s) for our events…`);
    for (const wh of toDelete) {
      await ssDelete(`/webhooks/${wh.WebHookID}`);
      console.log(`  Deleted [${wh.WebHookID}] ${wh.Event}`);
    }
  }

  // 3. Subscribe to each event.
  console.log("\n📡  Subscribing…");
  for (const event of EVENTS) {
    const result = await ssPost("/webhooks/subscribe", {
      target_url: webhookUrl,
      event,
      store_id: null,
      friendly_name: `SpaceTransfers ${event}`,
    });
    console.log(`  ✅  ${event} → ID ${result.Id ?? result.id ?? JSON.stringify(result)}`);
  }

  // 4. Verify — list again.
  const { webhooks: after = [] } = await ssGet("/webhooks");
  console.log(`\n✅  Done. ${after.length} total webhook(s) now registered in ShipStation:`);
  for (const wh of after) {
    console.log(`  • [${wh.WebHookID}] ${wh.Event} → ${wh.Target}`);
  }

  console.log("\n📋  Next step:");
  console.log(`   Make sure your server is running and reachable at:\n   ${webhookUrl}\n`);
})().catch((err) => {
  console.error("\n❌  Error:", err.message);
  process.exit(1);
});
