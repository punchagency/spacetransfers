/**
 * Backups by hand, run inside the API's container:
 *
 *   node dist/tools/backup.js backup
 *   node dist/tools/backup.js list
 *   node dist/tools/backup.js restore 2026-10-16 spacetransfers_restore
 *   node dist/tools/backup.js drill          (back up, restore into a scratch database, compare, drop it)
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { listBackups, restoreBackup, runBackup } from "../services/backup.service.js";

const [command, date, target] = process.argv.slice(2);

const main = async () => {
  await mongoose.connect(env.mongoUri);
  if (command === "backup") console.log(JSON.stringify(await runBackup(), null, 2));
  else if (command === "list") console.log((await listBackups()).join("\n") || "No backups yet.");
  else if (command === "restore") {
    if (!date || !target) throw new Error("Usage: restore <date> <target database>");
    console.log(JSON.stringify(await restoreBackup(date, target), null, 2));
  } else if (command === "drill") {
    const backup = await runBackup();
    const scratch = `${mongoose.connection.db!.databaseName}_restore_drill`;
    await mongoose.connection.useDb(scratch, { useCache: false }).db!.dropDatabase();
    const result = await restoreBackup(backup.date, scratch);
    const mismatched = Object.keys(result.expected).filter((n) => result.expected[n] !== result.restored[n]);
    await mongoose.connection.useDb(scratch, { useCache: false }).db!.dropDatabase();
    console.log(JSON.stringify({ backedUp: backup.date, collections: Object.keys(result.expected).length, documents: Object.values(result.restored).reduce((a, b) => a + b, 0), mismatched, scratchDropped: true }, null, 2));
    if (mismatched.length) process.exitCode = 1;
  } else {
    console.log("Commands: backup | list | restore <date> <target database> | drill");
  }
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(`Failed: ${err?.message || err}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
