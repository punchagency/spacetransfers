/**
 * EasyPost: rates, labels, refunds and tracking.
 * Run with: npm test — no network: `fetch` is replaced where a call is made.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { env } from "../config/env.js";
import {
  buyShipment,
  clearRateCache,
  describeEasyPostError,
  getRates,
  labelCostOf,
  labelOf,
  mapRates,
  refundShipment,
  selectService,
  serviceDisplayName,
  carrierDisplayName,
  toEasyPostAddress,
  toEasyPostParcel,
  trackerOutcome,
} from "../services/easypost.service.js";
import { shipFromFor, trackerRecency } from "../services/shippingLabel.service.js";
import { shouldPollOrder } from "../services/trackingPoller.service.js";
import { isRetryable } from "../utils/retry.js";

const realFetch = globalThis.fetch;
const saved = { key: env.easyPostApiKey, labels: env.easyPostLabelsEnabled, carriers: env.easyPostCarriers, accounts: env.easyPostCarrierAccounts };
afterEach(() => {
  globalThis.fetch = realFetch;
  env.easyPostApiKey = saved.key;
  env.easyPostLabelsEnabled = saved.labels;
  env.easyPostCarriers = saved.carriers;
  env.easyPostCarrierAccounts = saved.accounts;
  clearRateCache();
});

describe("rate cache", () => {
  const ask = { from: { zip: "78701", country: "US" }, to: { zip: "10166", country: "US" }, parcel: { weightLb: 1, lengthIn: 10, widthIn: 4, heightIn: 4 } };
  const answering = (bodies: unknown[]) => {
    let calls = 0;
    globalThis.fetch = (async () => {
      const body = bodies[Math.min(calls, bodies.length - 1)];
      calls += 1;
      return body instanceof Error ? Promise.reject(body) : new Response(JSON.stringify(body), { status: 200 });
    }) as any;
    return () => calls;
  };
  const oneRate = { rates: [{ id: "rate_1", carrier: "USPS", service: "GroundAdvantage", rate: "5.00", delivery_days: 3 }] };

  it("asks EasyPost once for the same quote, including two asked at the same moment", async () => {
    env.easyPostApiKey = "EZTKtest123";
    env.easyPostCarriers = [];
    const calls = answering([oneRate]);
    const [a, b] = await Promise.all([getRates(ask), getRates(ask)]);
    const c = await getRates(ask);
    assert.equal(calls(), 1);
    assert.deepEqual(a, b);
    assert.deepEqual(a, c);
    await getRates({ ...ask, parcel: { ...ask.parcel, weightLb: 2 } });
    assert.equal(calls(), 2, "a different parcel is a different quote");
  });

  it("doesn't keep a failed request", async () => {
    env.easyPostApiKey = "EZTKtest123";
    env.easyPostCarriers = [];
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify({ error: { message: "Invalid address" } }), { status: 422 })
        : new Response(JSON.stringify(oneRate), { status: 200 });
    }) as any;
    await assert.rejects(getRates(ask));
    await new Promise((r) => setImmediate(r));
    assert.equal((await getRates(ask)).length, 1);
    assert.equal(calls, 2);
  });

  it("doesn't keep an empty answer", async () => {
    env.easyPostApiKey = "EZTKtest123";
    env.easyPostCarriers = [];
    const calls = answering([{ rates: [] }, oneRate]);
    assert.equal((await getRates(ask)).length, 0);
    await new Promise((r) => setImmediate(r));
    assert.equal((await getRates(ask)).length, 1);
    assert.equal(calls(), 2);
  });
});

/** Replaces fetch with one answer, keeping what was asked. */
const stubFetch = (status: number, body: unknown) => {
  const calls: { url: string; init: any }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as any;
  return calls;
};

const rate = (carrier: string, service: string, price: string, days: number | null = null) => ({ id: `rate_${carrier}_${service}`, carrier, service, rate: price, delivery_days: days });

describe("talking to EasyPost", () => {
  it("authenticates with the key as the Basic username and sends the shipment wrapped", async () => {
    env.easyPostApiKey = "EZTKtest123";
    env.easyPostCarrierAccounts = [];
    const calls = stubFetch(201, { id: "shp_1", rates: [rate("USPS", "GroundAdvantage", "6.10", 4)] });
    const rates = await getRates({
      from: { zip: "78701", street1: "1 Main", city: "Austin", state: "TX" },
      to: { zip: "10001", country: "United States", residential: true },
      parcel: { weightLb: 1.5, lengthIn: 26, widthIn: 6, heightIn: 6 },
    });
    assert.equal(calls[0].url, "https://api.easypost.com/v2/shipments");
    assert.equal(calls[0].init.headers.Authorization, "Basic " + Buffer.from("EZTKtest123:").toString("base64"));
    const sent = JSON.parse(calls[0].init.body).shipment;
    assert.deepEqual(sent.parcel, { length: 26, width: 6, height: 6, weight: 24 });
    assert.equal(sent.to_address.country, "US");
    assert.equal(sent.to_address.residential, true);
    assert.deepEqual(sent.options, { label_format: "PDF", label_size: "4x6" });
    assert.equal(rates[0].serviceName, "USPS Ground Advantage");
  });

  it("explains a refusal in EasyPost's own words, field by field, and doesn't retry it", async () => {
    env.easyPostApiKey = "k";
    stubFetch(422, { error: { code: "ADDRESS.VERIFY.FAILURE", message: "Address not found", errors: [{ field: "street1", message: "House number is missing" }] } });
    await assert.rejects(refundShipment("shp_1"), (e: any) => e.status === 422 && /Address not found \(street1: House number is missing\)/.test(e.message));
    assert.equal(describeEasyPostError(400, { error: { message: "Bad", errors: ["one", "two"] } }), "Bad (one; two)");
    assert.equal(describeEasyPostError(500, null), "HTTP 500");
    assert.equal(isRetryable({ status: 422 }), false);
    assert.equal(isRetryable({ status: 503 }), true);
    assert.equal(isRetryable(new Error("EasyPost GET /x → HTTP 402: no funds")), false);
  });

  it("refuses to work without a key, and never buys while purchases are off", async () => {
    env.easyPostApiKey = undefined;
    await assert.rejects(refundShipment("shp_1"), (e: any) => e.status === 503);
    env.easyPostApiKey = "k";
    env.easyPostLabelsEnabled = false;
    const calls = stubFetch(200, {});
    await assert.rejects(buyShipment("shp_1", "rate_1"), (e: any) => e.status === 503 && /switched off/.test(e.message));
    assert.equal(calls.length, 0, "no request goes out");
  });

  it("buys the chosen rate on the shipment", async () => {
    env.easyPostApiKey = "k";
    env.easyPostLabelsEnabled = true;
    const calls = stubFetch(200, { id: "shp_1" });
    await buyShipment("shp_1", "rate_9");
    assert.equal(calls[0].url, "https://api.easypost.com/v2/shipments/shp_1/buy");
    assert.deepEqual(JSON.parse(calls[0].init.body), { rate: { id: "rate_9" } });
  });
});

describe("parcels and addresses", () => {
  it("converts pounds to ounces, never below an ounce, to one decimal", () => {
    assert.equal(toEasyPostParcel({ weightLb: 0.01, lengthIn: 26, widthIn: 4, heightIn: 4 }).weight, 1);
    assert.equal(toEasyPostParcel({ weightLb: 0.4321, lengthIn: 26.04, widthIn: 4, heightIn: 4 }).weight, 6.9);
    assert.equal(toEasyPostParcel({ weightLb: 1, lengthIn: 26.04, widthIn: 4, heightIn: 4 }).length, 26);
  });

  it("drops empty fields and writes the country as a code", () => {
    assert.deepEqual(toEasyPostAddress({ zip: " 78701 ", street1: "  ", city: "Austin", country: "usa" }), { zip: "78701", country: "US", city: "Austin" });
  });
});

describe("choosing a service", () => {
  const rates = mapRates([rate("UPS", "Ground", "9.40", 3), rate("USPS", "Priority", "8.20", 2), rate("USPS", "GroundAdvantage", "6.10", 4), rate("USPS", "Express", "29.00", 1), { carrier: "USPS", service: "Bad", rate: "n/a" }], []);

  it("keeps real rates only, cheapest first, from the carriers allowed", () => {
    assert.deepEqual(rates.map((r) => r.service), ["GroundAdvantage", "Priority", "Ground", "Express"]);
    assert.deepEqual(mapRates([rate("UPS", "Ground", "9.40"), rate("USPS", "Priority", "8.20")], ["usps"]).map((r) => r.carrier), ["USPS"]);
  });

  it("standard is the cheapest; express the cheapest that is faster", () => {
    assert.equal(selectService(rates, "standard")!.service, "GroundAdvantage");
    assert.equal(selectService(rates, "express")!.service, "Priority");
  });

  it("without delivery days, express goes by the service's name, then the dearest", () => {
    const noDays = mapRates([rate("USPS", "GroundAdvantage", "6.10"), rate("USPS", "Priority", "8.20"), rate("USPS", "MediaMail", "4.00")], []);
    assert.equal(selectService(noDays, "express")!.service, "Priority");
    const plain = mapRates([rate("X", "A", "4"), rate("X", "B", "9")], []);
    assert.equal(selectService(plain, "express")!.service, "B");
  });

  it("a label uses the service the customer was quoted, when it's still offered", () => {
    assert.equal(selectService(rates, "standard", { carrier: "UPS", service: "Ground" })!.service, "Ground");
    assert.equal(selectService(rates, "standard", { carrier: "FedEx", service: "Ground" })!.service, "GroundAdvantage", "not offered: falls back");
    assert.equal(selectService([], "standard"), null);
  });
});

describe("bought labels", () => {
  const bought = {
    id: "shp_1",
    tracking_code: "9400111",
    postage_label: { label_url: "https://x/label.png", label_pdf_url: "https://x/label.pdf" },
    selected_rate: { carrier: "USPS", service: "Priority", rate: "8.20" },
    tracker: { id: "trk_1", public_url: "https://track.easypost.com/x" },
    fees: [
      { type: "PostageFee", amount: "8.20000", refunded: false },
      { type: "LabelFee", amount: "0.01000", refunded: false },
      { type: "InsuranceFee", amount: "1.00000", refunded: true },
    ],
  };

  it("costs what EasyPost charged, refunded fees aside, or the rate when there are no fees", () => {
    assert.equal(labelCostOf(bought), 8.21);
    assert.equal(labelCostOf({ selected_rate: { rate: "7.5" } }), 7.5);
    assert.equal(labelCostOf({}), null);
  });

  it("keeps the PDF, the tracking number and the tracker", () => {
    assert.deepEqual(labelOf(bought), {
      shipmentId: "shp_1",
      trackingCode: "9400111",
      labelUrl: "https://x/label.pdf",
      carrier: "USPS",
      service: "Priority",
      cost: 8.21,
      trackerId: "trk_1",
      trackingUrl: "https://track.easypost.com/x",
    });
    assert.equal(labelOf({ id: "shp_2", rates: [] }), null, "not bought yet");
  });
});

describe("what the carrier's tracking means for the order", () => {
  it("ships an order the carrier has, completes a delivered one, and only moves forwards", () => {
    assert.equal(trackerOutcome("QUALITY_CHECK", "in_transit"), "SHIPPED");
    assert.equal(trackerOutcome("QUALITY_CHECK", "out_for_delivery"), "SHIPPED");
    assert.equal(trackerOutcome("SHIPPED", "in_transit"), null);
    assert.equal(trackerOutcome("SHIPPED", "delivered"), "COMPLETED");
    assert.equal(trackerOutcome("QUALITY_CHECK", "delivered"), "COMPLETED");
    assert.equal(trackerOutcome("COMPLETED", "delivered"), null);
    assert.equal(trackerOutcome("CANCELLED", "delivered"), null);
    assert.equal(trackerOutcome("QUALITY_CHECK", "pre_transit"), null);
  });

  it("raises returns and failures, and nothing for a cancelled label", () => {
    assert.equal(trackerOutcome("SHIPPED", "return_to_sender"), "PROBLEM");
    assert.equal(trackerOutcome("SHIPPED", "failure"), "PROBLEM");
    assert.equal(trackerOutcome("SHIPPED", "cancelled"), null);
  });

  it("keeps checking shipped and ready-to-ship parcels for a while", () => {
    const now = new Date();
    assert.equal(shouldPollOrder({ status: "SHIPPED", trackingNumber: "1", createdAt: now, maxPollingDays: 30 }), true);
    assert.equal(shouldPollOrder({ status: "QUALITY_CHECK", trackingNumber: "1", createdAt: now, maxPollingDays: 30 }), true);
    assert.equal(shouldPollOrder({ status: "COMPLETED", trackingNumber: "1", createdAt: now, maxPollingDays: 30 }), false);
    assert.equal(shouldPollOrder({ status: "SHIPPED", trackingNumber: "", createdAt: now, maxPollingDays: 30 }), false);
    assert.equal(shouldPollOrder({ status: "SHIPPED", trackingNumber: "1", createdAt: new Date(Date.now() - 40 * 864e5), maxPollingDays: 30 }), false);
  });
});

describe("where a label ships from", () => {
  it("is the partner's business, never the quoting address", () => {
    const partner = { name: "Ana", companyName: "Inkworks", phone: "+15125550100", businessAddress: { street: "9 Elm", city: "Austin", state: "TX", postalCode: "78702", country: "US" } };
    assert.equal(shipFromFor(partner)!.street1, "9 Elm");
    assert.equal(shipFromFor(partner)!.company, "Inkworks");
    const before = env.shipFrom;
    env.shipFrom = { name: "HQ", street: "1 Main", city: "Lebanon", state: "KS", zip: "66952" };
    assert.equal(shipFromFor({ name: "No address" }), null, "a label never prints the quoting address");
    env.shipFrom = before;
  });
});

describe("the label lock", () => {
  it("holds while an attempt is live and lets go of one that was cut off", async () => {
    const { isLabelInProgress, LABEL_LOCK_MS } = await import("../services/shippingLabel.service.js");
    const now = Date.now();
    assert.equal(isLabelInProgress(new Date(now - 10_000), now), true);
    assert.equal(isLabelInProgress(new Date(now - LABEL_LOCK_MS - 1), now), false);
    assert.equal(isLabelInProgress(null, now), false);
  });
});

describe("tracking updates out of order", () => {
  it("one with a time replaces only what's no newer", async () => {
    const r = trackerRecency({ updated_at: "2026-10-21T12:00:00Z" });
    assert.equal(r.updatedAt?.toISOString(), "2026-10-21T12:00:00.000Z");
    assert.deepEqual(r.notOlder, { $or: [{ trackingUpdatedAt: null }, { trackingUpdatedAt: { $lte: r.updatedAt } }] });
  });

  it("one without a time, or with a bad one, only lands where none is recorded", async () => {
    for (const t of [{}, { updated_at: "not a date" }, null]) {
      const r = trackerRecency(t);
      assert.equal(r.updatedAt, null);
      assert.deepEqual(r.notOlder, { trackingUpdatedAt: null });
    }
  });
});

describe("service names people read", () => {
  it("spaces out the carriers' codes", () => {
    assert.equal(serviceDisplayName("GroundAdvantage", "USPS"), "Ground Advantage");
    assert.equal(serviceDisplayName("Priority", "USPS"), "Priority");
    assert.equal(serviceDisplayName("2ndDayAir", "UPS"), "2nd Day Air");
    assert.equal(serviceDisplayName("3DaySelect", "UPS"), "3 Day Select");
    assert.equal(serviceDisplayName("NextDayAirSaver", "UPS"), "Next Day Air Saver");
  });

  it("drops the carrier's own name and its capitals", () => {
    assert.equal(serviceDisplayName("FEDEX_GROUND", "FedEx"), "Ground");
    assert.equal(serviceDisplayName("FEDEX_2_DAY", "FedEx"), "2 Day");
    assert.equal(serviceDisplayName("GROUND_HOME_DELIVERY", "FedEx"), "Ground Home Delivery");
    assert.equal(serviceDisplayName("", "USPS"), "");
  });
});

describe("carrier names people read", () => {
  it("names EasyPost's own accounts after the carrier", () => {
    assert.equal(carrierDisplayName("FedExDefault"), "FedEx");
    assert.equal(carrierDisplayName("UPSDAP"), "UPS");
    assert.equal(carrierDisplayName("DHLExpress"), "DHL Express");
    assert.equal(carrierDisplayName("USPS"), "USPS");
    assert.equal(carrierDisplayName("OnTrac"), "OnTrac");
  });

  it("shows the plain name in a quote but keeps the raw one for matching", () => {
    const [r] = mapRates([rate("FedExDefault", "SMART_POST", "10.76", 5)], []);
    assert.equal(r.carrier, "FedExDefault");
    assert.equal(r.serviceName, "FedEx Smart Post");
  });
});
