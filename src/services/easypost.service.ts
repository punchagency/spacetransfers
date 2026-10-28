import crypto from "node:crypto";
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js";
import { env } from "../config/env.js";
import { withRetry } from "../utils/retry.js";
import { normaliseCountry } from "../utils/country.js";

/**
 * EasyPost: shipping rates, labels, label refunds and tracking.
 *
 * Plain HTTPS against the v2 API, authenticated with the API key as the Basic
 * username. Everything that answers a question (rates, a shipment, a tracker)
 * may be retried; buying a label never is, because a timeout can hide a
 * purchase that went through. The label workflow keeps the shipment id before
 * buying, so a second attempt finds the first label instead of buying another.
 */

const EP_BASE = "https://api.easypost.com/v2";

export const isEasyPostConfigured = (): boolean => Boolean(env.easyPostApiKey);

/** Whether this environment may buy postage; see `EASYPOST_LABELS_ENABLED`. */
export const areLabelPurchasesEnabled = (): boolean => env.easyPostLabelsEnabled;

/** EasyPost's error body as one sentence: its message, then each field's complaint. */
export const describeEasyPostError = (status: number, body: any): string => {
  const error = body?.error;
  const message = String(error?.message || `HTTP ${status}`);
  const details = (Array.isArray(error?.errors) ? error.errors : [])
    .map((e: any) => (typeof e === "string" ? e : [e?.field, e?.message].filter(Boolean).join(": ")))
    .filter(Boolean);
  return details.length ? `${message} (${details.join("; ")})` : message;
};

const request = async <T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 30_000): Promise<T> => {
  if (!isEasyPostConfigured()) {
    throw Object.assign(new Error("Shipping isn't set up: EASYPOST_API_KEY is missing."), { status: 503 });
  }
  const auth = Buffer.from(`${env.easyPostApiKey}:`).toString("base64");
  const res = await fetchWithTimeout(
    `${EP_BASE}${path}`,
    {
      method,
      redirect: "error",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    timeoutMs,
    "EasyPost",
  );
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = new Error(`EasyPost ${method} ${path.split("?")[0]} → HTTP ${res.status}: ${describeEasyPostError(res.status, json)}`);
    throw Object.assign(err, { status: res.status, code: json?.error?.code ?? null });
  }
  return json as T;
};

// ── Shapes ────────────────────────────────────────────────────────────────────

export interface ShipAddress {
  name?: string;
  company?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip: string;
  country?: string;
  phone?: string;
  email?: string;
  residential?: boolean;
}

export interface ParcelIn {
  weightLb: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

export interface CarrierRate {
  /** EasyPost's rate id; needed to buy it. */
  id: string;
  carrier: string;
  service: string;
  /** "USPS Priority", for people. */
  serviceName: string;
  /** The service on its own, as stored with the order's quote. */
  serviceCode: string;
  costUsd: number;
  deliveryDays: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** EasyPost takes ounces and inches; the parcel is worked out in pounds. */
export const toEasyPostParcel = (p: ParcelIn) => ({
  length: round1(Math.max(0.1, p.lengthIn)),
  width: round1(Math.max(0.1, p.widthIn)),
  height: round1(Math.max(0.1, p.heightIn)),
  weight: round1(Math.max(1, p.weightLb * 16)),
});

export const toEasyPostAddress = (a: ShipAddress) => {
  const out: Record<string, unknown> = { zip: String(a.zip || "").trim(), country: normaliseCountry(a.country) };
  for (const key of ["name", "company", "street1", "street2", "city", "state", "phone", "email"] as const) {
    const v = typeof a[key] === "string" ? a[key]!.trim() : "";
    if (v) out[key] = v;
  }
  if (typeof a.residential === "boolean") out.residential = a.residential;
  return out;
};

const CARRIER_NAMES: Record<string, string> = {
  fedexdefault: "FedEx",
  fedexsmartpost: "FedEx",
  upsdap: "UPS",
  upssurepost: "UPS",
  upsmailinnovations: "UPS",
  dhlexpress: "DHL Express",
  dhlecommerce: "DHL eCommerce",
  dhlecs: "DHL eCommerce",
  amazonshipping: "Amazon Shipping",
  canadapost: "Canada Post",
  uspsreturns: "USPS",
};

/**
 * A carrier as people know it. EasyPost names its own accounts ("FedExDefault",
 * "UPSDAP"); the raw name is kept for matching rates, this one for showing.
 */
export const carrierDisplayName = (carrier: string): string => {
  const raw = String(carrier || "").trim();
  return CARRIER_NAMES[raw.toLowerCase()] ?? raw.replace(/(Default|DAP)$/, "");
};

/**
 * A carrier's service code as people read it: "GroundAdvantage" → "Ground
 * Advantage", "2ndDayAir" → "2nd Day Air", "FEDEX_2_DAY" → "2 Day" (the carrier
 * is shown beside it).
 */
export const serviceDisplayName = (service: string, carrier = ""): string => {
  const code = String(service || "");
  const shouted = /[A-Z]{2}/.test(code) && code === code.toUpperCase();
  const words = code
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([0-9])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (shouted ? w[0] + w.slice(1).toLowerCase() : w));
  if (words.length > 1 && carrier && words[0].toLowerCase() === carrier.toLowerCase()) words.shift();
  return words.join(" ");
};

/** The carriers and accounts this business ships with, cheapest first. */
export const mapRates = (rates: unknown, carriers: string[] = env.easyPostCarriers): CarrierRate[] => {
  const allowed = new Set(carriers.map((c) => c.toLowerCase()));
  return (Array.isArray(rates) ? rates : [])
    .map((r: any) => {
      const carrier = String(r?.carrier ?? "");
      const service = String(r?.service ?? "");
      const days = Number(r?.delivery_days ?? r?.est_delivery_days);
      return {
        id: String(r?.id ?? ""),
        carrier,
        service,
        serviceName: `${carrierDisplayName(carrier)} ${serviceDisplayName(service, carrierDisplayName(carrier))}`.trim(),
        serviceCode: service,
        costUsd: Number(r?.rate),
        deliveryDays: Number.isFinite(days) && days > 0 ? days : null,
      };
    })
    .filter((r) => r.service && r.carrier && Number.isFinite(r.costUsd) && r.costUsd > 0)
    .filter((r) => allowed.size === 0 || allowed.has(r.carrier.toLowerCase()))
    .sort((a, b) => a.costUsd - b.costUsd);
};

const EXPEDITED = /express|priority|overnight|next.?day|2.?day|2nd.?day|second.?day|air/i;

/**
 * The service for a shipping method. "standard" is the cheapest; "express" the
 * cheapest that is faster than standard, judged by delivery days where the
 * carrier gives them and by the service's name where it doesn't. A label goes
 * out on the service the customer was quoted and paid for, when it's offered.
 */
export const selectService = (
  rates: CarrierRate[],
  method: "standard" | "express",
  preferred?: { carrier?: string | null; service?: string | null } | null,
): CarrierRate | null => {
  if (rates.length === 0) return null;
  if (preferred?.service) {
    const match = rates.find(
      (r) => r.service === preferred.service && (!preferred.carrier || r.carrier.toLowerCase() === String(preferred.carrier).toLowerCase()),
    );
    if (match) return match;
  }
  const cheapest = rates[0];
  if (method === "standard") return cheapest;
  const faster = rates.filter((r) => r !== cheapest && r.deliveryDays !== null && cheapest.deliveryDays !== null && r.deliveryDays < cheapest.deliveryDays);
  if (faster.length) return faster[0];
  const named = rates.filter((r) => r !== cheapest && EXPEDITED.test(r.service));
  return named[0] ?? rates[rates.length - 1];
};

// ── Address verification ──────────────────────────────────────────────────────

export interface DeliveryVerification {
  deliverable: boolean;
  /** The carrier's form of the address, upper case as USPS writes it. */
  address: { street1: string; street2: string; city: string; state: string; zip: string };
  /** EasyPost's reason codes when the address isn't deliverable, e.g. E.ADDRESS.NOT_FOUND. */
  errorCodes: string[];
}

/**
 * Asks the carrier whether it can deliver to an address. `verify` goes beside
 * the address, not inside it: inside, EasyPost stores the address unchecked.
 * Null when EasyPost answered without a verdict. Answers quickly or not at all,
 * because a customer is waiting at checkout.
 */
export const verifyAddress = async (a: ShipAddress): Promise<DeliveryVerification | null> => {
  const res = await request<any>("POST", "/addresses", { address: toEasyPostAddress(a), verify: ["delivery"] }, 8_000);
  const delivery = res?.verifications?.delivery;
  if (!delivery || typeof delivery.success !== "boolean") return null;
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    deliverable: delivery.success,
    address: { street1: text(res.street1), street2: text(res.street2), city: text(res.city), state: text(res.state), zip: text(res.zip) },
    errorCodes: (Array.isArray(delivery.errors) ? delivery.errors : []).map((e: any) => String(e?.code || "")).filter(Boolean),
  };
};

// ── Shipments and labels ──────────────────────────────────────────────────────

const shipmentBody = (p: { to: ShipAddress; from: ShipAddress; parcel: ParcelIn; reference?: string }) => ({
  shipment: {
    to_address: toEasyPostAddress(p.to),
    from_address: toEasyPostAddress(p.from),
    parcel: toEasyPostParcel(p.parcel),
    ...(p.reference ? { reference: p.reference } : {}),
    // A 4x6 PDF prints on a thermal label printer or a sheet of paper alike.
    options: { label_format: "PDF", label_size: "4x6" },
    ...(env.easyPostCarrierAccounts.length ? { carrier_accounts: env.easyPostCarrierAccounts } : {}),
  },
});

/** Live rates for a parcel. Creates an unbought shipment, which costs nothing. */
/*
 * Rates for quotes are kept briefly. One checkout asks for the same rates
 * several times (both shipping options, then the payment, then the order), and
 * EasyPost bills rate requests beyond a few per label; reusing the answer also
 * means the order is priced from exactly the rates the customer was shown. A
 * label always buys from a fresh shipment, never from these.
 */
const RATE_CACHE_MS = 10 * 60 * 1000;
const RATE_CACHE_MAX = 500;
const rateCache = new Map<string, { at: number; rates: Promise<CarrierRate[]> }>();

/** For tests. */
export const clearRateCache = () => rateCache.clear();

export const getRates = (p: { to: ShipAddress; from: ShipAddress; parcel: ParcelIn }): Promise<CarrierRate[]> => {
  const body = shipmentBody(p);
  const key = JSON.stringify(body);
  const hit = rateCache.get(key);
  if (hit && Date.now() - hit.at < RATE_CACHE_MS) return hit.rates;
  const rates = withRetry(async () => mapRates((await request<any>("POST", "/shipments", body))?.rates), 2, 600, "easypost-rates");
  rateCache.delete(key);
  rateCache.set(key, { at: Date.now(), rates });
  while (rateCache.size > RATE_CACHE_MAX) rateCache.delete(rateCache.keys().next().value as string);
  // A failed request or an empty answer isn't kept: the next one asks again.
  const forget = () => {
    if (rateCache.get(key)?.rates === rates) rateCache.delete(key);
  };
  rates.then((r) => r.length === 0 && forget(), forget);
  return rates;
};

/** A shipment ready to buy, with its rates. */
export const createShipment = (p: { to: ShipAddress; from: ShipAddress; parcel: ParcelIn; reference: string }) =>
  withRetry(() => request<any>("POST", "/shipments", shipmentBody(p)), 2, 600, "easypost-shipment");

export const retrieveShipment = (id: string) =>
  withRetry(() => request<any>("GET", `/shipments/${encodeURIComponent(id)}`), 2, 600, "easypost-shipment");

/** Buys the label. Spends money, so never retried here. */
export const buyShipment = async (shipmentId: string, rateId: string) => {
  if (!areLabelPurchasesEnabled()) {
    throw Object.assign(
      new Error("Buying labels is switched off in this environment (EASYPOST_LABELS_ENABLED isn't true)."),
      { status: 503 },
    );
  }
  return request<any>("POST", `/shipments/${encodeURIComponent(shipmentId)}/buy`, { rate: { id: rateId } });
};

/** What a label cost: its fees when EasyPost lists them, otherwise the rate bought. */
export const labelCostOf = (shipment: any): number | null => {
  const fees = (Array.isArray(shipment?.fees) ? shipment.fees : []).filter((f: any) => !f?.refunded);
  const total = fees.reduce((sum: number, f: any) => sum + (Number(f?.amount) || 0), 0);
  if (total > 0) return Math.round(total * 100) / 100;
  const rate = Number(shipment?.selected_rate?.rate);
  return Number.isFinite(rate) && rate > 0 ? Math.round(rate * 100) / 100 : null;
};

/** The parts of a bought shipment the order keeps. Null when it has no label yet. */
export const labelOf = (shipment: any) => {
  const label = shipment?.postage_label;
  const url = label?.label_pdf_url || label?.label_url || null;
  if (!url) return null;
  return {
    shipmentId: String(shipment.id),
    trackingCode: String(shipment.tracking_code || shipment.tracker?.tracking_code || ""),
    labelUrl: String(url),
    carrier: carrierDisplayName(String(shipment.selected_rate?.carrier || "")),
    service: serviceDisplayName(String(shipment.selected_rate?.service || ""), carrierDisplayName(String(shipment.selected_rate?.carrier || ""))),
    cost: labelCostOf(shipment),
    trackerId: shipment.tracker?.id ? String(shipment.tracker.id) : null,
    trackingUrl: shipment.tracker?.public_url ? String(shipment.tracker.public_url) : null,
  };
};

/** Asks for an unused label's money back. Returns EasyPost's refund status. */
export const refundShipment = async (shipmentId: string): Promise<string> => {
  const res = await request<any>("POST", `/shipments/${encodeURIComponent(shipmentId)}/refund`);
  return String(res?.refund_status || "submitted");
};

// ── Tracking ──────────────────────────────────────────────────────────────────

export const retrieveTracker = (id: string) =>
  withRetry(() => request<any>("GET", `/trackers/${encodeURIComponent(id)}`), 2, 1000, "easypost-tracker");

/** Tracks a code bought elsewhere; EasyPost returns the existing tracker for a repeat. */
export const createTracker = (trackingCode: string, carrier?: string | null) =>
  withRetry(
    () => request<any>("POST", "/trackers", { tracker: { tracking_code: trackingCode, ...(carrier ? { carrier } : {}) } }),
    2,
    1000,
    "easypost-tracker",
  );

export type TrackerOutcome = "SHIPPED" | "COMPLETED" | "PROBLEM" | null;

/**
 * What a tracker's status means for the order. Moving only forwards: a parcel
 * the carrier has picked up ships an order still waiting at "ready to ship",
 * and a delivered one completes it. Returns and failures are raised for
 * someone to look at; nothing is moved back.
 */
export const trackerOutcome = (orderStatus: string, trackerStatus: string): TrackerOutcome => {
  const order = String(orderStatus || "").toUpperCase();
  const status = String(trackerStatus || "").toLowerCase();
  if (status === "delivered") return order === "SHIPPED" || order === "QUALITY_CHECK" ? "COMPLETED" : null;
  if (status === "in_transit" || status === "out_for_delivery" || status === "available_for_pickup") {
    return order === "QUALITY_CHECK" ? "SHIPPED" : null;
  }
  if (status === "return_to_sender" || status === "failure" || status === "error") {
    return order === "SHIPPED" || order === "QUALITY_CHECK" ? "PROBLEM" : null;
  }
  return null;
};

/** Plain words for a tracker status, as the customer and the admin see it. */
export const TRACKING_STATUS_LABELS: Record<string, string> = {
  unknown: "Label created",
  pre_transit: "Label created, waiting for the carrier",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  available_for_pickup: "Ready for pickup",
  delivered: "Delivered",
  return_to_sender: "Being returned to sender",
  failure: "Delivery problem",
  cancelled: "Label cancelled",
  error: "Tracking error",
};

// ── Webhooks ──────────────────────────────────────────────────────────────────

/**
 * Whether a webhook really came from EasyPost: `X-Hmac-Signature` must equal
 * "hmac-sha256-hex=" and the hex HMAC-SHA256 of the raw body, keyed with the
 * webhook secret normalised to NFKD. Compared in constant time.
 */
export const verifyWebhookSignature = (rawBody: Buffer | string, header: unknown, secret: string | undefined): boolean => {
  if (!secret || typeof header !== "string" || !header) return false;
  const key = Buffer.from(secret.normalize("NFKD"), "utf8");
  const expected = Buffer.from("hmac-sha256-hex=" + crypto.createHmac("sha256", key).update(rawBody).digest("hex"));
  const given = Buffer.from(header);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};
