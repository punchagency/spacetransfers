#!/usr/bin/env node
/**
 * ShipStation integration test script.
 *
 * Tests three layers in order:
 *   1. ShipStation API credentials — can we reach ShipStation?
 *   2. Webhook endpoint — does our server accept and process webhook payloads?
 *   3. Full workflow — create SS order → label → simulate webhook delivery
 *
 * Usage (server must be running on port 4000):
 *   node scripts/test-shipstation-integration.mjs [--server http://localhost:4000]
 *
 * Options:
 *   --server  Base URL of the running server (default: http://localhost:4000)
 *   --token   JWT token for a printer account (if omitted, webhook tests run unauthenticated)
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "../.env");
const envLines = readFileSync(envPath, "utf-8").split("\n");
const env = {};
for (const line of envLines) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const SS_KEY    = env.SHIPSTATION_API_KEY;
const SS_SECRET = env.SHIPSTATION_API_SECRET;
const WH_TOKEN  = env.SHIPSTATION_WEBHOOK_SECRET;

const args = process.argv.slice(2);
const serverArg = args.indexOf("--server");
const SERVER = serverArg >= 0 ? args[serverArg + 1] : "http://localhost:4000";
const tokenArg = args.indexOf("--token");
const JWT = tokenArg >= 0 ? args[tokenArg + 1] : null;

const SS_BASE = "https://ssapi.shipstation.com";
const SS_AUTH = "Basic " + Buffer.from(`${SS_KEY}:${SS_SECRET}`).toString("base64");

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✅  ${label}`);
  passed++;
}
function fail(label, detail = "") {
  console.log(`  ❌  ${label}${detail ? `\n      → ${detail}` : ""}`);
  failed++;
}
function section(title) {
  console.log(`\n${"─".repeat(60)}\n${title}\n${"─".repeat(60)}`);
}

async function ssGet(path) {
  const r = await fetch(`${SS_BASE}${path}`, {
    headers: { Authorization: SS_AUTH, "Content-Type": "application/json" },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function ssPost(path, body) {
  const r = await fetch(`${SS_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: SS_AUTH, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function localPost(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(`${SERVER}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text, ok: r.ok };
}

async function localGet(path, token) {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(`${SERVER}${path}`, { headers });
  const text = await r.text();
  return { status: r.status, body: text, ok: r.ok };
}

(async () => {
  console.log("\n🚀  ShipStation Integration Test Suite");
  console.log(`    Server : ${SERVER}`);
  console.log(`    SS Key : ${SS_KEY ? SS_KEY.slice(0, 8) + "…" : "NOT SET"}`);

  // ────────────────────────────────────────────────────────────
  // LAYER 1 — ShipStation API credentials
  // ────────────────────────────────────────────────────────────
  section("LAYER 1 · ShipStation API credentials");

  let carriers = [];
  try {
    const data = await ssGet("/carriers");
    carriers = Array.isArray(data) ? data : [];
    ok(`API reachable — ${carriers.length} carrier(s) found`);
    for (const c of carriers) {
      console.log(`       • ${c.code} (${c.name})`);
    }
  } catch (e) {
    fail("API unreachable", e.message);
  }

  let webhooks = [];
  try {
    const data = await ssGet("/webhooks");
    webhooks = data.webhooks ?? [];
    const ours = webhooks.filter((w) => w.Url?.includes("space-transfers"));
    ok(`Webhooks registered — ${ours.length} pointing to our server`);
    for (const w of ours) {
      console.log(`       • [${w.WebHookID}] ${w.HookType}`);
    }
    if (ours.length === 0) {
      fail("No webhooks pointing to our server — run setup-shipstation-webhooks.mjs first");
    }
  } catch (e) {
    fail("Could not list webhooks", e.message);
  }

  // ────────────────────────────────────────────────────────────
  // LAYER 2 — Webhook endpoint (local server)
  // ────────────────────────────────────────────────────────────
  section("LAYER 2 · Webhook endpoint (local server)");

  // 2a. Health check
  try {
    const r = await localGet("/health");
    if (r.ok) ok("Server health check passed");
    else fail("Server not responding", `HTTP ${r.status}`);
  } catch (e) {
    fail("Server unreachable", `Is it running at ${SERVER}? (${e.message})`);
    console.log("\n⚠️   Start the server first:  npm run dev\n");
    console.log(`Results so far — passed: ${passed}  failed: ${failed}`);
    process.exit(1);
  }

  // 2b. Reject missing token
  try {
    const r = await localPost("/api/webhooks/shipstation?token=WRONG_TOKEN", {
      resource_url: "https://ssapi.shipstation.com/shipments?shipmentId=1",
      resource_type: "SHIP_NOTIFY",
    });
    if (r.status === 401) ok("Rejects bad token → 401");
    else fail(`Expected 401 for bad token, got ${r.status}`);
  } catch (e) {
    fail("Webhook token rejection test errored", e.message);
  }

  // 2c. Accept correct token — server responds 200 immediately
  try {
    const r = await localPost(
      `/api/webhooks/shipstation?token=${WH_TOKEN}`,
      {
        resource_url: `${SS_BASE}/shipments?shipmentId=0`,
        resource_type: "SHIP_NOTIFY",
      }
    );
    if (r.status === 200) ok("Accepts correct token → 200 (background processing)");
    else fail(`Expected 200 for valid token, got ${r.status}: ${r.body.slice(0, 200)}`);
  } catch (e) {
    fail("Webhook acceptance test errored", e.message);
  }

  // 2d. Malformed payload — should still 200 (ShipStation must not get errors)
  try {
    const r = await localPost(`/api/webhooks/shipstation?token=${WH_TOKEN}`, {});
    if (r.status === 200) ok("Malformed payload → 200 (graceful, ShipStation won't retry)");
    else fail(`Expected 200 for malformed payload, got ${r.status}`);
  } catch (e) {
    fail("Malformed payload test errored", e.message);
  }

  // 2e. ORDER_NOTIFY event type accepted
  try {
    const r = await localPost(
      `/api/webhooks/shipstation?token=${WH_TOKEN}`,
      {
        resource_url: `${SS_BASE}/orders?orderNumber=TEST-0000`,
        resource_type: "ORDER_NOTIFY",
      }
    );
    if (r.status === 200) ok("ORDER_NOTIFY event accepted → 200");
    else fail(`Expected 200 for ORDER_NOTIFY, got ${r.status}`);
  } catch (e) {
    fail("ORDER_NOTIFY test errored", e.message);
  }

  // ────────────────────────────────────────────────────────────
  // LAYER 3 — Full ShipStation workflow (creates real test objects)
  // ────────────────────────────────────────────────────────────
  section("LAYER 3 · Full ShipStation workflow (test label — no real postage)");

  const testOrderNumber = `TEST-${Date.now().toString().slice(-6)}`;
  let ssOrderId = null;
  let ssShipmentId = null;
  let testTrackingNumber = null;

  // 3a. Resolve warehouse ID (required for label generation).
  //     ShipStation doesn't expose a warehouse-create API, so the user must
  //     create one in the UI: ShipStation → Settings → Warehouses → Add Warehouse.
  //     Then set SHIPSTATION_WAREHOUSE_ID in .env to that warehouse's numeric ID.
  let warehouseId = env.SHIPSTATION_WAREHOUSE_ID ? Number(env.SHIPSTATION_WAREHOUSE_ID) : null;
  if (!warehouseId) {
    try {
      const warehouses = await ssGet("/warehouses");
      const list = Array.isArray(warehouses) ? warehouses : [];
      const def = list.find((w) => w.isDefault) ?? list[0];
      if (def) {
        warehouseId = def.warehouseId;
        console.log(`  ℹ️   Using warehouse: ${def.warehouseName ?? def.warehouseId} (ID ${warehouseId})`);
      }
    } catch (e) {
      console.log(`  ⚠️   Could not fetch warehouses: ${e.message}`);
    }
  } else {
    console.log(`  ℹ️   Using SHIPSTATION_WAREHOUSE_ID=${warehouseId} from env`);
  }

  if (!warehouseId) {
    fail(
      "No warehouse configured — Layer 3 skipped",
      "Go to ShipStation → Settings → Warehouses → Add Warehouse, then set SHIPSTATION_WAREHOUSE_ID in .env"
    );
    section("Results");
    console.log(`  Passed : ${passed}`);
    console.log(`  Failed : ${failed}`);
    process.exit(1);
  }

  try {
    const result = await ssPost("/orders/createorder", {
      orderNumber: testOrderNumber,
      orderDate: new Date().toISOString(),
      orderStatus: "awaiting_shipment",
      customerUsername: "test@spacetransfers.com",
      customerEmail: "test@spacetransfers.com",
      billTo: {
        name: "Test Customer",
        street1: "123 Test St",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        country: "US",
      },
      shipTo: {
        name: "Test Customer",
        street1: "123 Test St",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        country: "US",
      },
      items: [{ lineItemKey: "0", name: "DTF Print", quantity: 1, unitPrice: 25 }],
      amountPaid: 25,
      weight: { value: 1, units: "pounds" },
      dimensions: { units: "inches", length: 12, width: 10, height: 2 },
      ...(warehouseId !== null && { advancedOptions: { warehouseId } }),
    });
    ssOrderId = String(result.orderId);
    ok(`Created SS test order — ID: ${ssOrderId}, orderNumber: ${testOrderNumber}`);
  } catch (e) {
    fail("Failed to create test order in ShipStation", e.message);
  }

  // 3b. Generate test label
  if (ssOrderId) {
    try {
      const carrierCode = env.SHIPSTATION_CARRIER_ID || "stamps_com";
      const serviceCode = env.SHIPSTATION_SERVICE_CODE || "usps_priority_mail";

      // Build ship-from: use env vars if set, otherwise fall back to a generic test address.
      const shipFrom = {
        name: env.SHIPSTATION_FROM_NAME || "Space Transfers",
        street1: env.SHIPSTATION_FROM_STREET1 || "123 Print Shop Rd",
        city: env.SHIPSTATION_FROM_CITY || "Austin",
        state: env.SHIPSTATION_FROM_STATE || "TX",
        postalCode: env.SHIPSTATION_FROM_POSTAL_CODE || "78701",
        country: env.SHIPSTATION_FROM_COUNTRY || "US",
      };

      const result = await ssPost("/orders/createlabelfororder", {
        orderId: Number(ssOrderId),
        carrierCode,
        serviceCode,
        packageCode: "package",
        confirmation: "delivery",
        shipDate: new Date().toISOString().slice(0, 10),
        weight: { value: 1, units: "pounds" },
        dimensions: { units: "inches", length: 12, width: 10, height: 2 },
        shipFrom,
        testLabel: true, // always test — no real postage consumed
      });
      ssShipmentId = String(result.shipmentId);
      testTrackingNumber = String(result.trackingNumber ?? "");
      const labelUrl = result.labelDownload?.pdf ?? result.labelDownload?.png ?? "(none)";
      ok(`Generated TEST label — shipmentId: ${ssShipmentId}, tracking: ${testTrackingNumber}`);
      console.log(`       • Label URL: ${labelUrl.slice(0, 80)}`);
    } catch (e) {
      fail("Failed to generate test label", e.message);
    }
  } else {
    console.log("  ⏭   Skipping label generation (no SS order ID)");
  }

  // 3c. Simulate the SHIP_NOTIFY webhook that ShipStation would send
  if (ssShipmentId) {
    const resourceUrl = `${SS_BASE}/shipments?shipmentId=${ssShipmentId}`;
    try {
      // First, verify we can fetch the resource URL ourselves
      const shipmentData = await ssGet(`/shipments?shipmentId=${ssShipmentId}`);
      const shipment = shipmentData.shipments?.[0];
      if (shipment?.trackingNumber) {
        ok(`Fetched shipment resource — tracking confirmed: ${shipment.trackingNumber}`);
      } else {
        fail("Shipment resource returned no tracking number");
      }
    } catch (e) {
      fail("Could not fetch shipment resource URL", e.message);
    }

    // Now simulate ShipStation POSTing the webhook to our server
    console.log(`\n  📡  Simulating SHIP_NOTIFY webhook → server will fetch:\n      ${resourceUrl}`);
    try {
      const r = await localPost(
        `/api/webhooks/shipstation?token=${WH_TOKEN}`,
        { resource_url: resourceUrl, resource_type: "SHIP_NOTIFY" }
      );
      if (r.status === 200) {
        ok("Server accepted SHIP_NOTIFY with real SS shipment resource");
        console.log("       (server will look up our order by orderNumber in the background)");
        console.log(`       Since orderNumber '${testOrderNumber}' doesn't exist in our DB,`);
        console.log("       the webhook handler will log 'no matching order' — that's expected.");
      } else {
        fail(`Server returned ${r.status}`, r.body.slice(0, 200));
      }
    } catch (e) {
      fail("SHIP_NOTIFY simulation errored", e.message);
    }
  }

  // ────────────────────────────────────────────────────────────
  // RESULTS
  // ────────────────────────────────────────────────────────────
  section("Results");
  console.log(`  Passed : ${passed}`);
  console.log(`  Failed : ${failed}`);
  console.log();

  if (failed === 0) {
    console.log("✅  All tests passed.\n");
    console.log("Next step — test the full UI flow:");
    console.log("  1. Open the printer app and find an order in 'Pending Review'");
    console.log("  2. Click 'Accept & Start' → status becomes 'In Progress'");
    console.log("  3. Click 'Mark as Ready' → status becomes 'Ready for Packaging'");
    console.log("     ShipStation will automatically create an order + label in the background.");
    console.log("  4. The status card in OrderDetails will show 'Preparing shipment…'");
    console.log("     then switch to the tracking number once the label is generated.");
    console.log("  5. The tracking poller will check delivery every 30 min.");
  } else {
    console.log("❌  Some tests failed — see above for details.\n");
    process.exit(1);
  }
})();
