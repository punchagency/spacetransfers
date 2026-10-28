#!/usr/bin/env node
/**
 * Registers this API's webhook with EasyPost, so tracking updates arrive by
 * themselves instead of waiting for the poller.
 *
 * Usage:
 *   node scripts/setup-easypost-webhook.mjs https://api.yourdomain.com
 *
 * Uses EASYPOST_API_KEY and EASYPOST_WEBHOOK_SECRET from .env. Webhooks belong
 * to the key's mode: run it once with the test key and once with the
 * production key if both are in use. Running it again updates the secret on the
 * existing webhook rather than adding a second one.
 */
import "dotenv/config";

const key = (process.env.EASYPOST_API_KEY || "").trim();
const secret = (process.env.EASYPOST_WEBHOOK_SECRET || "").trim();
const base = (process.argv[2] || "").trim().replace(/\/+$/, "");

if (!key || !secret || !/^https:\/\//.test(base)) {
  console.error("Usage: node scripts/setup-easypost-webhook.mjs https://api.yourdomain.com");
  console.error("Needs EASYPOST_API_KEY and EASYPOST_WEBHOOK_SECRET in .env; EasyPost only calls https addresses.");
  process.exit(1);
}

const url = `${base}/api/webhooks/easypost`;
const auth = "Basic " + Buffer.from(`${key}:`).toString("base64");
const call = async (method, path, body) => {
  const res = await fetch(`https://api.easypost.com/v2${path}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${json?.error?.message || "no detail"}`);
  return json;
};

const { webhooks = [] } = await call("GET", "/webhooks");
const existing = webhooks.find((w) => w.url === url);
if (existing) {
  await call("PATCH", `/webhooks/${existing.id}`, { webhook: { webhook_secret: secret } });
  console.log(`Updated the existing webhook ${existing.id} (${existing.mode}) → ${url}`);
} else {
  const created = await call("POST", "/webhooks", { webhook: { url, webhook_secret: secret } });
  console.log(`Registered webhook ${created.id} (${created.mode}) → ${url}`);
}
