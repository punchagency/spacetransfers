import crypto from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";
import mongoose from "mongoose";
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

/**
 * Nightly copies of the database, and putting one back.
 *
 * Each collection is written as one JSON document per line (MongoDB's
 * Extended JSON, so ids and dates survive), compressed, then encrypted with
 * BACKUP_ENCRYPTION_KEY before it leaves the server. The storage bucket also
 * serves artwork publicly, so a backup is only ever stored encrypted: a copy
 * of the database holds every customer's details and password hash.
 *
 * Without the key a backup cannot be read, so the key must be kept somewhere
 * other than this server as well.
 */

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const { EJSON } = mongoose.mongo.BSON;

const PREFIX = "backups";
const KEEP_DAYS = 30;

const httpError = (message: string) => Object.assign(new Error(message), { statusCode: 500 });

/** The 32-byte key from BACKUP_ENCRYPTION_KEY (64 hex characters or base64), or null when unset. */
export const backupKey = (raw = process.env.BACKUP_ENCRYPTION_KEY): Buffer | null => {
  const value = String(raw || "").trim();
  if (!value) return null;
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw httpError("BACKUP_ENCRYPTION_KEY must be 32 bytes: 64 hex characters, or base64.");
  return key;
};

/** AES-256-GCM: a 12-byte nonce, the 16-byte tag, then the ciphertext. */
export const encryptBackup = (plain: Buffer, key: Buffer): Buffer => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
};

export const decryptBackup = (sealed: Buffer, key: Buffer): Buffer => {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
};

/** A collection's documents as the stored file, and back. */
export const packCollection = async (docs: unknown[], key: Buffer) =>
  encryptBackup(await gzip(Buffer.from(docs.map((d) => EJSON.stringify(d, { relaxed: false })).join("\n"))), key);

export const unpackCollection = async (sealed: Buffer, key: Buffer): Promise<any[]> => {
  const text = (await gunzip(decryptBackup(sealed, key))).toString("utf8");
  return text ? text.split("\n").map((line) => EJSON.parse(line, { relaxed: false })) : [];
};

/** Which backups to remove: anything older than the newest `keep` days. */
export const backupsToPrune = (dates: string[], keep = KEEP_DAYS): string[] =>
  [...dates].sort().reverse().slice(keep);

const bucket = () => process.env.BACKUP_R2_BUCKET || env.r2Bucket;
let client: S3Client | null = null;
const r2 = () =>
  (client ??= new S3Client({
    region: "auto",
    endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.r2AccessKeyId!, secretAccessKey: env.r2SecretAccessKey! },
  }));

export const backupsConfigured = (): boolean =>
  Boolean(backupKey() && env.r2AccountId && env.r2AccessKeyId && env.r2SecretAccessKey && bucket());

const readObject = async (key: string): Promise<Buffer> => {
  const res = await r2().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return Buffer.from(await (res.Body as any).transformToByteArray());
};

/** Writes today's backup and removes those past the retention window. */
export const runBackup = async (now = new Date()) => {
  const key = backupKey();
  if (!key || !backupsConfigured()) throw httpError("Backups are not configured: set BACKUP_ENCRYPTION_KEY and the R2 settings.");
  const db = mongoose.connection.db!;
  const date = now.toISOString().slice(0, 10);
  const counts: Record<string, number> = {};
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith("system.")) continue;
    const docs = await db.collection(name).find({}).toArray();
    counts[name] = docs.length;
    await r2().send(new PutObjectCommand({ Bucket: bucket(), Key: `${PREFIX}/${date}/${name}.jsonl.gz.enc`, Body: await packCollection(docs, key), ContentType: "application/octet-stream" }));
  }
  const manifest = { date, database: db.databaseName, finishedAt: new Date().toISOString(), collections: counts };
  await r2().send(new PutObjectCommand({ Bucket: bucket(), Key: `${PREFIX}/${date}/manifest.json.enc`, Body: encryptBackup(Buffer.from(JSON.stringify(manifest)), key), ContentType: "application/octet-stream" }));

  const pruned = await pruneBackups();
  return { ...manifest, pruned };
};

/** The dates a backup exists for, oldest first. */
export const listBackups = async (): Promise<string[]> => {
  const dates = new Set<string>();
  let token: string | undefined;
  do {
    const page = await r2().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: `${PREFIX}/`, Delimiter: "/", ContinuationToken: token }));
    for (const p of page.CommonPrefixes || []) {
      const m = /^backups\/(\d{4}-\d{2}-\d{2})\/$/.exec(p.Prefix || "");
      if (m) dates.add(m[1]);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return [...dates].sort();
};

const pruneBackups = async (): Promise<string[]> => {
  const old = backupsToPrune(await listBackups());
  for (const date of old) {
    const page = await r2().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: `${PREFIX}/${date}/` }));
    const keys = (page.Contents || []).map((o) => ({ Key: o.Key! }));
    if (keys.length) await r2().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: keys, Quiet: true } }));
  }
  return old;
};

/**
 * Puts a backup into a database. It refuses the live database unless told
 * otherwise in so many words, and refuses a target that already has data.
 */
export const restoreBackup = async (date: string, targetDb: string, opts: { overwriteLive?: boolean } = {}) => {
  const key = backupKey();
  if (!key || !backupsConfigured()) throw httpError("Backups are not configured.");
  const live = mongoose.connection.db!.databaseName;
  if (targetDb === live && !opts.overwriteLive) throw httpError(`Refusing to restore over the live database "${live}". Restore into another name first.`);
  const target = mongoose.connection.useDb(targetDb, { useCache: false }).db!;
  if ((await target.listCollections().toArray()).some((c) => !c.name.startsWith("system.")) && !opts.overwriteLive) {
    throw httpError(`The database "${targetDb}" is not empty.`);
  }
  const manifest = JSON.parse(decryptBackup(await readObject(`${PREFIX}/${date}/manifest.json.enc`), key).toString("utf8"));
  const restored: Record<string, number> = {};
  for (const name of Object.keys(manifest.collections)) {
    const docs = await unpackCollection(await readObject(`${PREFIX}/${date}/${name}.jsonl.gz.enc`), key);
    if (docs.length) await target.collection(name).insertMany(docs, { ordered: false });
    restored[name] = docs.length;
  }
  return { date, from: manifest.database, into: targetDb, expected: manifest.collections, restored };
};

/** Runs a backup every night at 03:00 UTC, when BACKUP_ENABLED=true. */
export const startBackupSchedule = () => {
  if (String(process.env.BACKUP_ENABLED || "").toLowerCase() !== "true") return;
  if (!backupsConfigured()) {
    console.error("[BACKUP] BACKUP_ENABLED is set but backups are not configured: set BACKUP_ENCRYPTION_KEY and the R2 settings.");
    return;
  }
  const run = () =>
    runBackup()
      .then((r) => console.log(`[BACKUP] ${r.date}: ${Object.values(r.collections).reduce((a, b) => a + b, 0)} documents in ${Object.keys(r.collections).length} collections`))
      .catch((err) => console.error(`[BACKUP] failed: ${err?.message}`));
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (now.getUTCHours() >= 3 ? 1 : 0), 3));
  setTimeout(() => {
    void run();
    setInterval(() => void run(), 24 * 60 * 60 * 1000);
  }, next.getTime() - now.getTime());
};
