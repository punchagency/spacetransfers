/**
 * Re-draws order sheet previews at preview size, run inside the API's container:
 *
 *   node dist/tools/previews.js report               (how many, and how big)
 *   node dist/tools/previews.js rerender             (what would change; nothing is written)
 *   node dist/tools/previews.js rerender --apply     (re-draw them and remove the old files)
 *
 * A preview drawn above `PREVIEW_DPI`, or heavier than `PREVIEW_MAX_BYTES`, is re-drawn from the order's own designs.
 * The old file is removed only once no order points at it, because a free
 * reprint of a whole order shares its original's preview.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Order } from "../models/order.model.js";
import { needsRedraw, renderOrderSheetPreviews } from "../services/orderPreview.service.js";

const [command, flag] = process.argv.slice(2);
const LOCAL = /^\/uploads\/exports\//;

const fileOf = (relative: string) => path.join(process.cwd(), relative);
const sizeOf = (relative: string) => {
  try {
    return fs.statSync(fileOf(relative)).size;
  } catch {
    return null;
  }
};
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

const main = async () => {
  await mongoose.connect(env.mongoUri);
  const orders = await Order.find({ "items.previewImage": { $regex: LOCAL } }).select("items").lean();

  if (command === "report") {
    let count = 0;
    let bytes = 0;
    let stale = 0;
    let missing = 0;
    for (const order of orders as any[]) {
      for (const item of order.items || []) {
        if (typeof item.previewImage !== "string" || !LOCAL.test(item.previewImage)) continue;
        const size = sizeOf(item.previewImage);
        count += 1;
        if (size === null) missing += 1;
        else bytes += size;
        if (needsRedraw(item.previewImage, size)) stale += 1;
      }
    }
    console.log(JSON.stringify({ previews: count, total: mb(bytes), average: count ? mb(bytes / Math.max(1, count - missing)) : "0 MB", toRedraw: stale, fileMissing: missing }, null, 2));
  } else if (command === "rerender") {
    const apply = flag === "--apply";
    const todo = (orders as any[]).filter((o) => (o.items || []).some((it: any) => needsRedraw(it.previewImage, sizeOf(String(it.previewImage || "")))));
    console.log(`${todo.length} orders have previews to re-draw.${apply ? "" : " Dry run: add --apply to do it."}`);
    let before = 0;
    let after = 0;
    let removed = 0;
    let failed = 0;
    let unchanged = 0;
    for (const [n, order] of todo.entries()) {
      const old = (order.items || []).map((it: any) => it.previewImage).filter((p: unknown) => needsRedraw(p, sizeOf(String(p || "")))) as string[];
      const oldBytes = old.reduce((s, p) => s + (sizeOf(p) || 0), 0);
      before += oldBytes;
      if (!apply) continue;
      const drawn = await renderOrderSheetPreviews(String(order._id), order.items);
      const fresh: any = await Order.findById(order._id).select("items.previewImage").lean();
      const now = (fresh?.items || []).map((it: any) => it.previewImage).filter((p: unknown) => typeof p === "string" && LOCAL.test(p)) as string[];
      after += now.reduce((s, p) => s + (sizeOf(p) || 0), 0);
      for (const p of old) {
        if (now.includes(p)) {
          // Drawn again to the same file: it was already preview-size, or this sheet failed to draw.
          if (drawn > 0) unchanged += 1;
          else failed += 1;
          continue;
        }
        if (await Order.exists({ "items.previewImage": p })) continue;
        try {
          fs.unlinkSync(fileOf(p));
          removed += 1;
        } catch {
          // Already gone.
        }
      }
      if ((n + 1) % 10 === 0) console.log(`  ${n + 1}/${todo.length}`);
    }
    console.log(
      JSON.stringify(
        apply
          ? { orders: todo.length, before: mb(before), after: mb(after), oldFilesRemoved: removed, alreadyPreviewSize: unchanged, couldNotRedraw: failed }
          : { orders: todo.length, currentSize: mb(before) },
        null,
        2,
      ),
    );
  } else {
    console.log("Usage: report | rerender [--apply]");
    process.exitCode = 1;
  }
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
