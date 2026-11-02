#!/usr/bin/env node
/**
 * Checks the EasyPost key by asking for rates on a sample parcel. Buys nothing.
 *
 * Usage:
 *   node scripts/test-easypost.mjs [from-zip] [to-zip]
 *
 * Prints the carriers and services the account offers between the two
 * postcodes, cheapest first, so EASYPOST_CARRIERS can be set from what's real.
 */
import "dotenv/config";

const key = (process.env.EASYPOST_API_KEY || "").trim();
if (!key) {
  console.error("EASYPOST_API_KEY is not set in .env.");
  process.exit(1);
}
const [fromZip = "78701", toZip = "10001"] = process.argv.slice(2);
const res = await fetch("https://api.easypost.com/v2/shipments", {
  method: "POST",
  headers: { Authorization: "Basic " + Buffer.from(`${key}:`).toString("base64"), "Content-Type": "application/json" },
  body: JSON.stringify({
    shipment: {
      from_address: { zip: fromZip, country: "US" },
      to_address: { zip: toZip, country: "US", residential: true },
      parcel: { length: 26, width: 6, height: 6, weight: 16 },
    },
  }),
});
const json = await res.json().catch(() => null);
if (!res.ok) {
  console.error(`EasyPost refused (HTTP ${res.status}): ${json?.error?.message || "no detail"}`);
  process.exit(1);
}
console.log(`Key works (${json.mode} mode). Rates for a 1lb 26x6x6in tube, ${fromZip} → ${toZip}:`);
for (const r of [...(json.rates || [])].sort((a, b) => Number(a.rate) - Number(b.rate))) {
  console.log(`  ${r.carrier.padEnd(8)} ${r.service.padEnd(24)} $${Number(r.rate).toFixed(2)}${r.delivery_days ? `  ${r.delivery_days} day(s)` : ""}`);
}
for (const m of json.messages || []) console.log(`  note: ${m.carrier || ""} ${m.message}`);
