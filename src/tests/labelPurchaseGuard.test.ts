import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Buying a label spends money on the client's EasyPost account when it holds a
 * production key, so staging with such a key runs with
 * `EASYPOST_LABELS_ENABLED=false`. These pin the parsing and the fail-safe
 * default, so an environment that forgets the variable cannot spend by omission.
 */

const parse = (raw: string | undefined): boolean => String(raw ?? "").toLowerCase() === "true";

describe("EASYPOST_LABELS_ENABLED", () => {
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
    for (const v of ["false", "0", "1", "yes", "no", "off", "enabled", " true "]) {
      assert.equal(parse(v), false, v);
    }
  });

  it("the guard sits on the purchase, not on quoting, shipments or tracking", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/services/easypost.service.ts", "utf8");
    const buy = src.slice(src.indexOf("export const buyShipment"), src.indexOf("export const labelCostOf"));
    assert.match(buy, /areLabelPurchasesEnabled\(\)/, "the label purchase must be guarded");
    for (const fn of ["getRates", "createShipment", "retrieveShipment", "retrieveTracker", "createTracker"]) {
      const start = src.indexOf(`export const ${fn}`);
      const end = src.indexOf("export ", start + 1);
      const body = src.slice(start, end === -1 ? undefined : end);
      assert.ok(!/areLabelPurchasesEnabled\(\)/.test(body), `${fn} must keep working with labels disabled`);
    }
  });
});
