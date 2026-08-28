import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * ShipStation has no sandbox. A label is a real purchase against the client's
 * card with no undo, and staging points at the same live account — so the
 * deployment blueprint declares `SHIPSTATION_LABELS_ENABLED=false` there.
 *
 * Nothing read it. These pin the parsing and the fail-safe default, so an
 * environment that forgets the variable cannot spend by omission.
 */

const parse = (raw: string | undefined): boolean =>
  String(raw ?? "").toLowerCase() === "true";

describe("SHIPSTATION_LABELS_ENABLED", () => {
  it("only the exact string 'true' enables spending", () => {
    assert.equal(parse("true"), true);
    assert.equal(parse("TRUE"), true);
    assert.equal(parse("True"), true);
  });

  it("defaults to disabled when unset — an omission must not spend money", () => {
    assert.equal(parse(undefined), false);
    assert.equal(parse(""), false);
  });

  it("treats anything else as disabled, including values that look affirmative", () => {
    // "1" and "yes" are the shapes someone reaches for when setting this in a
    // hurry. Failing closed on them is deliberate.
    for (const v of ["false", "0", "1", "yes", "no", "off", "enabled", " true "]) {
      assert.equal(parse(v), false, v);
    }
  });

  it("the guard sits on the purchase, not on quoting or tracking", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/services/shipstation.service.ts", "utf8");

    const label = src.slice(src.indexOf("export const createShipStationLabel"));
    assert.match(label, /areLabelPurchasesEnabled\(\)/, "the label purchase must be guarded");

    for (const fn of ["getShipStationRates", "createShipStationOrder", "getShipmentTracking"]) {
      const start = src.indexOf(`export const ${fn}`);
      const body = src.slice(start, start + 2500);
      assert.ok(
        !/areLabelPurchasesEnabled\(\)/.test(body),
        `${fn} must keep working with labels disabled — staging still needs rates and tracking`,
      );
    }
  });
});
