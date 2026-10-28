/**
 * Checkout's carrier check of the shipping address.
 * Run with: npm test — no network: `fetch` is replaced where a call is made.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { env } from "../config/env.js";
import { checkAddress, clearAddressChecks, orderAddressCheck, toAddressCheck } from "../services/addressCheck.service.js";
import type { DeliveryVerification } from "../services/easypost.service.js";

const realFetch = globalThis.fetch;
const savedKey = env.easyPostApiKey;
afterEach(() => {
  globalThis.fetch = realFetch;
  env.easyPostApiKey = savedKey;
  clearAddressChecks();
});

const entered = { street: "200 Park Avenue", city: "New York", state: "NY", postalCode: "10166" };
const found = (address: Partial<DeliveryVerification["address"]>): DeliveryVerification => ({
  deliverable: true,
  address: { street1: "200 PARK AVE", street2: "", city: "NEW YORK", state: "NY", zip: "10166-0005", ...address },
  errorCodes: [],
});

describe("toAddressCheck", () => {
  it("accepts the carrier's spelling of the same address without asking", () => {
    assert.deepEqual(toAddressCheck(entered, found({})), { status: "verified" });
    assert.deepEqual(toAddressCheck({ ...entered, street: "200 park ave." }, found({})), { status: "verified" });
  });

  it("treats Apt, Unit, Suite and # as the same door", () => {
    const v = found({ street1: "12 MAIN ST", street2: "APT 4", city: "AUSTIN", state: "TX", zip: "78701" });
    const typed = { street: "12 Main Street #4", city: "Austin", state: "TX", postalCode: "78701" };
    assert.deepEqual(toAddressCheck(typed, v), { status: "verified" });
  });

  it("doesn't ask about a city USPS also accepts for the ZIP code", () => {
    assert.deepEqual(toAddressCheck({ ...entered, city: "Manhattan" }, found({})), { status: "verified" });
  });

  it("suggests the carrier's version when the ZIP code is wrong, written for people", () => {
    const check = toAddressCheck({ ...entered, postalCode: "90210" }, found({}));
    assert.deepEqual(check, {
      status: "suggested",
      suggestion: { street: "200 Park Ave", city: "New York", state: "NY", postalCode: "10166" },
      // "Avenue" to "Ave" is spelling, not a change.
      changed: ["postalCode"],
    });
  });

  it("keeps ordinals, directions and unit letters readable", () => {
    const v = found({ street1: "350 5TH AVE NW", street2: "STE 12B", city: "SAINT PAUL", state: "MN", zip: "55101" });
    const check = toAddressCheck({ street: "350 Fifth Ave", city: "St Paul", state: "MN", postalCode: "55101" }, v);
    assert.equal(check.status, "suggested");
    assert.equal(check.status === "suggested" && check.suggestion.street, "350 5th Ave NW Ste 12B");
    assert.equal(check.status === "suggested" && check.suggestion.city, "Saint Paul");
    assert.deepEqual(check.status === "suggested" && check.changed, ["street", "city"]);
  });

  it("names why an address can't be found", () => {
    const missing = (codes: string[]): DeliveryVerification => ({ ...found({}), deliverable: false, errorCodes: codes });
    assert.deepEqual(toAddressCheck(entered, missing(["E.SECONDARY_INFORMATION.MISSING"])), { status: "not_found", reason: "missing_unit" });
    assert.deepEqual(toAddressCheck(entered, missing(["E.SECONDARY_INFORMATION.INVALID"])), { status: "not_found", reason: "invalid_unit" });
    assert.deepEqual(toAddressCheck(entered, missing(["E.HOUSE_NUMBER.INVALID"])), { status: "not_found", reason: "house_number" });
    assert.deepEqual(toAddressCheck(entered, missing(["E.ADDRESS.NOT_FOUND"])), { status: "not_found", reason: "not_found" });
  });

  it("has no verdict when the carrier gave none", () => {
    assert.deepEqual(toAddressCheck(entered, null), { status: "unavailable" });
  });
});

describe("checkAddress", () => {
  let calls: any[] = [];
  beforeEach(() => {
    calls = [];
    env.easyPostApiKey = "EZTKtest123";
  });

  const carrierAnswers = (body: unknown, status = 200) => {
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify(body), { status });
    }) as any;
  };

  it("asks for a delivery check beside the address, and asks only once", async () => {
    carrierAnswers({ street1: "200 PARK AVE", city: "NEW YORK", state: "NY", zip: "10166-0005", verifications: { delivery: { success: true, errors: [] } } });
    assert.deepEqual(await checkAddress(entered), { status: "verified" });
    assert.deepEqual(await checkAddress(entered), { status: "verified" });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/v2\/addresses$/);
    assert.deepEqual(calls[0].body.verify, ["delivery"]);
    assert.equal(calls[0].body.address.verify, undefined);
    assert.equal(calls[0].body.address.zip, "10166");
  });

  it("knows the carrier's own version is deliverable without another call", async () => {
    carrierAnswers({ street1: "200 PARK AVE", city: "NEW YORK", state: "NY", zip: "10166-0005", verifications: { delivery: { success: true, errors: [] } } });
    const check = await checkAddress({ ...entered, postalCode: "90210" });
    assert.equal(check.status, "suggested");
    if (check.status !== "suggested") return;
    assert.deepEqual(await checkAddress(check.suggestion), { status: "verified" });
    assert.equal(calls.length, 1);
  });

  it("never throws: an outage or a missing key is just no verdict, and isn't remembered", async () => {
    carrierAnswers({ error: { message: "boom" } }, 500);
    assert.deepEqual(await checkAddress(entered), { status: "unavailable" });
    assert.deepEqual(orderAddressCheck(entered), { status: "unchecked" });
    env.easyPostApiKey = undefined;
    assert.deepEqual(await checkAddress(entered), { status: "unavailable" });
  });

  it("gives the order the verdict on the address it was placed with", async () => {
    carrierAnswers({ street1: "9999 NOWHERE BLVD", city: "NEW YORK", state: "NY", zip: "10166", verifications: { delivery: { success: false, errors: [{ code: "E.ADDRESS.NOT_FOUND" }] } } });
    const nowhere = { ...entered, street: "9999 Nowhere Blvd" };
    await checkAddress(nowhere);
    assert.deepEqual(orderAddressCheck(nowhere), { status: "not_found", reason: "not_found" });

    carrierAnswers({ street1: "200 PARK AVE", city: "NEW YORK", state: "NY", zip: "10166-0005", verifications: { delivery: { success: true, errors: [] } } });
    const wrongZip = { ...entered, postalCode: "90210" };
    await checkAddress(wrongZip);
    assert.deepEqual(orderAddressCheck(wrongZip), { status: "differs", suggestion: "200 Park Ave, New York, NY 10166" });
    assert.deepEqual(orderAddressCheck({ street: "200 Park Ave", city: "New York", state: "NY", postalCode: "10166" }), { status: "verified" });
    assert.deepEqual(orderAddressCheck({ ...entered, street: "1 Elsewhere Rd" }), { status: "unchecked" });
  });
});
