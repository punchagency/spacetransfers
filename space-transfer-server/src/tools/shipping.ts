/**
 * Moves orders off the ShipStation fields, run inside the API's container once
 * after deploying the EasyPost change:
 *
 *   node dist/tools/shipping.js migrate            (what would change; nothing is written)
 *   node dist/tools/shipping.js migrate --apply
 *
 * A label ShipStation made keeps its link and cost under the new names, and a
 * label that failed keeps its reason, so the partner can try again. The lock
 * left by an unfinished ShipStation attempt is dropped. Partners' ShipStation
 * warehouse ids are removed: EasyPost has no warehouses.
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";

const [command, flag] = process.argv.slice(2);
const LEGACY = ["shipStationOrderId", "shipStationShipmentId", "shipStationLabelUrl", "shipStationLabelCost", "shipStationTriggeredAt", "shipStationError"];

const main = async () => {
  if (command !== "migrate") {
    console.log("Usage: migrate [--apply]");
    process.exitCode = 1;
    return;
  }
  const apply = flag === "--apply";
  await mongoose.connect(env.mongoUri);
  const db = mongoose.connection.db!;
  const orders = db.collection("orders");
  const legacy = { $or: LEGACY.map((f) => ({ [f]: { $exists: true } })) };
  const found = await orders.find(legacy).project(Object.fromEntries(LEGACY.map((f) => [f, 1]).concat([["labelUrl", 1], ["labelCost", 1], ["labelError", 1], ["status", 1]]))).toArray();

  let labels = 0;
  let errors = 0;
  for (const o of found as any[]) {
    const set: Record<string, unknown> = {};
    if (o.shipStationLabelUrl && !o.labelUrl) {
      set.labelUrl = o.shipStationLabelUrl;
      labels += 1;
    }
    if (typeof o.shipStationLabelCost === "number" && o.labelCost == null) set.labelCost = o.shipStationLabelCost;
    if (o.shipStationError && !o.labelError && !o.shipStationLabelUrl && o.status === "QUALITY_CHECK") {
      set.labelError = "The last label attempt failed. Try again to make it with the new shipping provider.";
      errors += 1;
    }
    if (apply) {
      await orders.updateOne(
        { _id: o._id },
        { ...(Object.keys(set).length ? { $set: set } : {}), $unset: Object.fromEntries(LEGACY.map((f) => [f, ""])) },
      );
    }
  }
  const warehouses = await db.collection("users").countDocuments({ shipStationWarehouseId: { $exists: true } });
  if (apply && warehouses) await db.collection("users").updateMany({ shipStationWarehouseId: { $exists: true } }, { $unset: { shipStationWarehouseId: "" } });

  console.log(
    JSON.stringify(
      { mode: apply ? "applied" : "dry run (add --apply)", ordersWithShipStationFields: found.length, labelsCarriedOver: labels, failedAttemptsToRetry: errors, partnerWarehouseIdsRemoved: warehouses },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
