import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { reportJobError } from "./monitoring.service.js";

/**
 * Print exports and previews are written to the server's disk and were never
 * removed. One long sheet's export is about a gigabyte, so the disk would fill
 * within weeks and every export after that would fail. Both are made again on
 * request, so files past `EXPORT_RETENTION_DAYS` are removed; downloading one
 * after that says the file is gone, and exporting again makes a new one.
 */

export const EXPORTS_DIR = path.join(process.cwd(), "uploads", "exports");

// An export makes its folder before it renders, and can render for minutes, so
// an empty folder is only removed once nothing has touched it for this long.
const EMPTY_FOLDER_GRACE_MS = 60 * 60 * 1000;

/** Removes files older than `days` under `root`, then folders left empty. Never `root` itself. */
export const removeOldExports = async (root: string, days: number, now = Date.now()) => {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  let files = 0;
  let bytes = 0;
  const sweep = async (dir: string): Promise<boolean> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    let left = 0;
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const empty = await sweep(full);
        const stat = empty ? await fs.stat(full).catch(() => null) : null;
        if (stat && stat.mtimeMs < now - EMPTY_FOLDER_GRACE_MS) {
          await fs.rmdir(full).catch(() => (left += 1));
        } else left += 1;
        continue;
      }
      const stat = entry.isFile() ? await fs.stat(full).catch(() => null) : null;
      if (stat && stat.mtimeMs < cutoff) {
        await fs.rm(full, { force: true });
        files += 1;
        bytes += stat.size;
      } else left += 1;
    }
    return left === 0;
  };
  await sweep(root);
  return { files, bytes };
};

let timer: ReturnType<typeof setInterval> | null = null;

export const startExportCleanup = (intervalMs = 6 * 60 * 60 * 1000): void => {
  if (timer) return;
  const run = () =>
    removeOldExports(EXPORTS_DIR, env.exportRetentionDays)
      .then(({ files, bytes }) => {
        if (files > 0) console.log(`[EXPORTS] removed ${files} file(s) older than ${env.exportRetentionDays} days (${(bytes / 1048576).toFixed(0)} MB)`);
      })
      .catch((err) => reportJobError("EXPORTS", err));
  setTimeout(run, 5 * 60 * 1000).unref();
  timer = setInterval(run, intervalMs);
  timer.unref();
};
