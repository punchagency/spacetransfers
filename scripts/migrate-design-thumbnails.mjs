#!/usr/bin/env node
/**
 * Moves design thumbnails out of the database and into artwork storage.
 *
 * Thumbnails used to be written into each design document as a `data:` URL —
 * 20 to 140 KB of base64 apiece. `GET /customer/designs` returns every design
 * with its thumbnail inline, so opening the gang sheet gallery downloaded all
 * of them at once; on a phone that request is the one that times out, and a
 * timeout there looked like an empty account.
 *
 * New saves store the picture as a file (see utils/designThumbnail.ts). This
 * converts the ones already saved.
 *
 * Runs against the BUILT server — it reuses its storage configuration and code:
 *   node scripts/migrate-design-thumbnails.mjs            # report only
 *   node scripts/migrate-design-thumbnails.mjs --apply    # convert them
 *
 * Safe to run twice: a design whose thumbnail is already a URL is skipped.
 */
import mongoose from "mongoose";
import { storeDesignThumbnail } from "../dist/utils/designThumbnail.js";

const apply = process.argv.includes("--apply");
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error("MONGO_URI is not set.");
  process.exit(1);
}

await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
const designs = mongoose.connection.collection("designs");

const inline = await designs.find({ thumbnail: /^data:/ }).project({ thumbnail: 1, title: 1 }).toArray();
const totalKb = Math.round(inline.reduce((sum, d) => sum + d.thumbnail.length, 0) / 1024);
console.log(`${inline.length} design(s) still carry an inline thumbnail — ${totalKb} KB in total.`);

if (!apply) {
  console.log("Report only. Re-run with --apply to convert them.");
} else {
  let moved = 0;
  let savedKb = 0;
  for (const d of inline) {
    const before = d.thumbnail.length;
    const stored = await storeDesignThumbnail(d.thumbnail);
    if (typeof stored !== "string" || stored.startsWith("data:")) {
      console.log(`  ! ${d.title}: could not be stored, left as it was`);
      continue;
    }
    await designs.updateOne({ _id: d._id }, { $set: { thumbnail: stored } });
    moved++;
    savedKb += Math.round((before - stored.length) / 1024);
    console.log(`  ✓ ${d.title}: ${Math.round(before / 1024)} KB → ${stored.split("/").pop()}`);
  }
  console.log(`\nConverted ${moved} of ${inline.length}. About ${savedKb} KB no longer travels with the list.`);
}

await mongoose.disconnect();
