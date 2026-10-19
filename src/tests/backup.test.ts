import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { backupKey, backupsToPrune, decryptBackup, encryptBackup, packCollection, unpackCollection } from "../services/backup.service.js";

describe("backups", () => {
  const key = crypto.randomBytes(32);

  it("round-trip a collection with ids and dates intact", async () => {
    const id = new mongoose.Types.ObjectId();
    const docs = [{ _id: id, at: new Date("2026-10-16T03:00:00Z"), n: 1.5, name: "Ada" }, { _id: new mongoose.Types.ObjectId(), nested: { list: [1, 2] } }];
    const back = await unpackCollection(await packCollection(docs, key), key);
    assert.equal(String(back[0]._id), String(id));
    assert.ok(back[0]._id instanceof mongoose.mongo.ObjectId);
    assert.ok(back[0].at instanceof Date);
    // Numbers keep their exact BSON type (32-bit int, double), so they go back in as they came out.
    assert.deepEqual(back[1].nested.list.map(Number), [1, 2]);
    assert.equal(Number(back[0].n), 1.5);
    assert.deepEqual(await unpackCollection(await packCollection([], key), key), []);
  });

  it("can't be read without the key, or once altered", async () => {
    const sealed = await packCollection([{ email: "ada@example.com" }], key);
    assert.equal(sealed.includes(Buffer.from("ada@example.com")), false);
    assert.throws(() => decryptBackup(sealed, crypto.randomBytes(32)));
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 1;
    assert.throws(() => decryptBackup(tampered, key));
    assert.deepEqual(decryptBackup(encryptBackup(Buffer.from("x"), key), key), Buffer.from("x"));
  });

  it("take the key as hex or base64, and refuse one of the wrong size", () => {
    assert.equal(backupKey(key.toString("hex"))!.length, 32);
    assert.equal(backupKey(key.toString("base64"))!.length, 32);
    assert.equal(backupKey(""), null);
    assert.throws(() => backupKey("abcd"));
  });

  it("keep the newest thirty days", () => {
    const dates = Array.from({ length: 33 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));
    assert.deepEqual(backupsToPrune(dates), ["2026-09-03", "2026-09-02", "2026-09-01"]);
    assert.deepEqual(backupsToPrune(dates.slice(0, 5)), []);
  });
});
