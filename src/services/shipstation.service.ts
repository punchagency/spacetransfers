import mongoose from "mongoose";
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js";
import { Order } from "../models/order.model.js";
import { User } from "../models/user.model.js";
import { env } from "../config/env.js";
import { publishOrderEvent } from "./orderSyncHub.js";
import { notifyAllAdmins } from "./adminNotifications.service.js";
import { notifyPrinter } from "./printerNotifications.service.js";

const SS_BASE = "https://ssapi.shipstation.com";

// ── Country helpers ───────────────────────────────────────────────────────────

/** Map common full country names → ISO-3166-1 alpha-2 codes. */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  "united states": "US", "usa": "US", "us": "US",
  "canada": "CA",
  "united kingdom": "GB", "uk": "GB",
  "australia": "AU",
  "germany": "DE",
  "france": "FR",
  "nigeria": "NG",
  "ghana": "GH",
  "kenya": "KE",
  "south africa": "ZA",
  "india": "IN",
  "china": "CN",
  "japan": "JP",
  "brazil": "BR",
  "mexico": "MX",
};

/** Normalise a country value to a 2-char ISO code. Returns the value uppercased if already 2 chars. */
function normaliseCountry(raw: string | undefined | null): string {
  if (!raw) return "US";
  const trimmed = raw.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return COUNTRY_NAME_TO_CODE[trimmed.toLowerCase()] ?? trimmed.toUpperCase().slice(0, 2);
}

// ── Retry utility — exported so tests can exercise it directly ────────────────

/**
 * Whether trying again could help. A 4xx is ShipStation's answer about the
 * request or the account (402 lapsed billing, 401 bad keys, 400 bad address) —
 * it comes back the same every time. Retrying those only delayed the fallback:
 * with the account lapsed, every checkout quote and every charge waited ~11 s
 * of backoff for an answer that was already final. Timeouts, network errors,
 * 5xx, 408 and 429 are still retried.
 */
export const isRetryable = (err: unknown): boolean => {
  const status = Number(/→ HTTP (\d{3})/.exec(String((err as any)?.message ?? ""))?.[1]);
  if (!Number.isFinite(status)) return true;
  return status >= 500 || status === 408 || status === 429;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  initialDelayMs: number,
  label: string
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) break;
      if (attempt < maxAttempts) {
        // Exponential backoff with ±200 ms jitter so concurrent retries don't collide.
        const delay = initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
        console.warn(
          `[SS:${label}] attempt ${attempt}/${maxAttempts} failed — retrying in ` +
          `${Math.round(delay)}ms: ${(err as any)?.message ?? err}`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ── Config guard ──────────────────────────────────────────────────────────────

export const isShipStationConfigured = (): boolean =>
  Boolean(env.shipStationApiKey && env.shipStationApiSecret);

// ── Raw HTTP ──────────────────────────────────────────────────────────────────

async function ssRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!isShipStationConfigured()) {
    throw new Error(
      "ShipStation credentials not configured — set SHIPSTATION_API_KEY and SHIPSTATION_API_SECRET"
    );
  }
  const creds = Buffer.from(
    `${env.shipStationApiKey}:${env.shipStationApiSecret}`
  ).toString("base64");

  const res = await fetchWithTimeout(`${SS_BASE}${path}`, {
    method,
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }, 30_000, "ShipStation");

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `ShipStation ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 400)}`
    );
  }
  return res.json() as Promise<T>;
}

// Fetches a full ShipStation URL (used by webhook handlers to retrieve resource payloads).
export async function ssRequestByUrl<T>(fullUrl: string): Promise<T> {
  if (!isShipStationConfigured()) throw new Error("ShipStation credentials not configured");
  const creds = Buffer.from(`${env.shipStationApiKey}:${env.shipStationApiSecret}`).toString("base64");
  const res = await fetchWithTimeout(fullUrl, {
    method: "GET",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json" },
  }, 30_000, "ShipStation");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ShipStation GET ${fullUrl} → HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json() as Promise<T>;
}

// ── ShipStation API wrappers ──────────────────────────────────────────────────

// Cached warehouse ID — fetched once per process, avoids repeated lookups.
let _cachedWarehouseId: number | null = null;

async function getDefaultWarehouseId(): Promise<number | null> {
  if (_cachedWarehouseId !== null) return _cachedWarehouseId;
  // Explicit env override takes priority — avoids an extra API call on every order.
  if (env.shipStationWarehouseId) {
    _cachedWarehouseId = env.shipStationWarehouseId;
    return _cachedWarehouseId;
  }
  try {
    const warehouses = await ssRequest<Array<{ warehouseId: number; isDefault?: boolean }>>(
      "GET", "/warehouses"
    );
    if (!Array.isArray(warehouses) || warehouses.length === 0) return null;
    const def = warehouses.find((w) => w.isDefault) ?? warehouses[0];
    _cachedWarehouseId = def.warehouseId;
    return _cachedWarehouseId;
  } catch {
    return null; // non-fatal — will surface as "No warehouse" error from ShipStation
  }
}

interface SSCreateOrderResponse {
  orderId: number;
  orderNumber: string;
  orderStatus: string;
}

export const createShipStationOrder = (params: {
  displayId: string;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  phone?: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
  totalAmount: number;
  /**
   * The real parcel. Optional only so existing callers keep compiling; when it
   * is absent the old fiction is used and a warning is logged, because a
   * mis-declared parcel is billed back by the carrier after the fact.
   */
  parcel?: { weightLb: number; lengthIn: number; widthIn: number; heightIn: number };
  /**
   * The assigned partner's own warehouse. Omitted, the HQ default is used.
   *
   * ShipStation reports by warehouse, so stamping every order with the HQ one
   * filed all partner volume under head office. The label already shipped from
   * the right address — this only fixes what ShipStation's own reports say.
   */
  warehouseId?: number | null;
}): Promise<{ shipStationOrderId: string; orderNumber: string }> =>
  withRetry(
    async () => {
      const recipientName = `${params.customerFirstName} ${params.customerLastName}`.trim();
      const address = {
        name: recipientName,
        street1: params.street,
        city: params.city,
        state: params.state,
        postalCode: params.postalCode,
        country: normaliseCountry(params.country),
        phone: params.phone || "",
      };
      const warehouseId =
        typeof params.warehouseId === "number" && Number.isFinite(params.warehouseId)
          ? params.warehouseId
          : await getDefaultWarehouseId();

      if (!params.parcel) {
        console.warn(
          `[SHIPSTATION] order ${params.displayId} created without a parcel — ` +
            `declaring 1lb 12x10x2in, which the carrier will re-bill if wrong`,
        );
      }
      const parcel = params.parcel ?? {
        weightLb: 1,
        lengthIn: 12,
        widthIn: 10,
        heightIn: 2,
      };

      const result = await ssRequest<SSCreateOrderResponse>("POST", "/orders/createorder", {
        orderNumber: params.displayId,
        orderDate: new Date().toISOString(),
        orderStatus: "awaiting_shipment",
        customerUsername: params.customerEmail,
        customerEmail: params.customerEmail,
        billTo: address,
        shipTo: address,
        items: params.items.map((item, i) => ({
          lineItemKey: String(i),
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
        amountPaid: params.totalAmount,
        weight: { value: parcel.weightLb, units: "pounds" },
        dimensions: {
          units: "inches",
          length: parcel.lengthIn,
          width: parcel.widthIn,
          height: parcel.heightIn,
        },
        ...(warehouseId !== null && { advancedOptions: { warehouseId } }),
      });
      return {
        shipStationOrderId: String(result.orderId),
        orderNumber: String(result.orderNumber),
      };
    },
    3,
    1000,
    "createOrder"
  );

interface SSCreateLabelResponse {
  shipmentId: number;
  trackingNumber: string;
  /** Base64-encoded PDF — present in ShipStation REST v2 (ssapi.shipstation.com) */
  labelData?: string;
  /** URL-based download links — present in ShipStation REST v3 */
  labelDownload?: { pdf?: string; png?: string; href?: string; zpl?: string };
  carrierCode: string;
  /** What the label cost, as charged to the account. */
  shipmentCost?: number;
  insuranceCost?: number;
}

interface SSRate {
  serviceName: string;
  serviceCode: string;
  shipmentCost: number;
  otherCost: number;
}

export interface CarrierRate {
  serviceName: string;
  serviceCode: string;
  carrierCode: string;
  /** Carrier's total for this service, before any markup. */
  costUsd: number;
}

/**
 * Live rates for a parcel to a destination.
 *
 * This did not exist: the service could create orders, buy labels and poll
 * tracking, but never ask what shipping actually costs. Every customer was
 * charged a flat $8.99 regardless of whether the parcel cost $6 or $40.
 *
 * Rates are quoted, not committed — the label is still bought separately, and
 * the price the carrier charges then can differ if the parcel was mis-declared.
 * That is why `deriveParcel` exists.
 */
export const getShipStationRates = (params: {
  toState: string;
  toPostalCode: string;
  toCountry: string;
  toCity?: string;
  parcel: { weightLb: number; lengthIn: number; widthIn: number; heightIn: number };
  carrierCode?: string;
  /** Residential addresses carry a carrier surcharge; assume so unless told otherwise. */
  residential?: boolean;
  /**
   * Where the parcel ships from. Falls back to the configured warehouse only
   * when no serving partner could be identified — quoting from a fixed origin
   * while the label ships from a partner's address is what made rates wrong.
   */
  fromPostalCode?: string;
}): Promise<CarrierRate[]> =>
  withRetry(
    async () => {
      const carrierCode = params.carrierCode ?? env.shipStationCarrierId ?? "stamps_com";

      const rates = await ssRequest<SSRate[]>("POST", "/shipments/getrates", {
        carrierCode,
        fromPostalCode: params.fromPostalCode || env.shipStationFromPostalCode || undefined,
        toState: params.toState,
        toCountry: normaliseCountry(params.toCountry),
        toPostalCode: params.toPostalCode,
        toCity: params.toCity || undefined,
        weight: { value: params.parcel.weightLb, units: "pounds" },
        dimensions: {
          units: "inches",
          length: params.parcel.lengthIn,
          width: params.parcel.widthIn,
          height: params.parcel.heightIn,
        },
        // Understating this is the most common source of a quote that comes in
        // under the eventual label price.
        residential: params.residential !== false,
      });

      return (Array.isArray(rates) ? rates : [])
        .map((r) => ({
          serviceName: String(r?.serviceName ?? ""),
          serviceCode: String(r?.serviceCode ?? ""),
          carrierCode,
          costUsd: Number(r?.shipmentCost ?? 0) + Number(r?.otherCost ?? 0),
        }))
        .filter((r) => r.serviceCode && Number.isFinite(r.costUsd) && r.costUsd > 0)
        .sort((a, b) => a.costUsd - b.costUsd);
    },
    2,
    600,
    "getRates",
  );

/**
 * Buying a label is the one ShipStation call that spends money, so the guard
 * lives here rather than at the two call sites.
 *
 * `SHIPSTATION_LABELS_ENABLED` was declared in the deployment blueprint and
 * read by nothing, which meant staging — pointed at the same live ShipStation
 * account, because there is no sandbox — could buy real postage against the
 * client's card. Rate quoting, order creation and tracking are all unaffected;
 * only the purchase is blocked.
 */
export const areLabelPurchasesEnabled = (): boolean => env.shipStationLabelsEnabled;

export const createShipStationLabel = (params: {
  shipStationOrderId: string;
  carrierCode?: string;
  serviceCode?: string;
  shipFrom?: {
    name: string;
    street1: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phone?: string;
  };
}): Promise<{
  shipStationShipmentId: string;
  trackingNumber: string;
  labelUrl: string;
  carrier: string;
  /** The label's cost (postage + insurance); null if ShipStation didn't say. */
  labelCost: number | null;
}> =>
  withRetry(
    async () => {
      if (!areLabelPurchasesEnabled()) {
        const error = new Error(
          "Label purchasing is disabled in this environment (SHIPSTATION_LABELS_ENABLED is not true). " +
            "ShipStation has no sandbox, so buying a label here would charge the live account.",
        ) as Error & { statusCode?: number };
        error.statusCode = 503;
        throw error;
      }

      // Prefer the caller-supplied shipFrom (printer's business address).
      // Fall back to env-var address if caller didn't provide one.
      const shipFrom = params.shipFrom ?? (env.shipStationFromStreet
        ? {
            name: env.shipStationFromName || "Space Transfers",
            street1: env.shipStationFromStreet,
            city: env.shipStationFromCity || "",
            state: env.shipStationFromState || "",
            postalCode: env.shipStationFromPostalCode || "",
            country: env.shipStationFromCountry || "US",
          }
        : undefined);

      const result = await ssRequest<SSCreateLabelResponse>(
        "POST",
        "/orders/createlabelfororder",
        {
          orderId: Number(params.shipStationOrderId),
          // ShipStation uses "carrierCode" (string like "stamps_com"), not "carrierId"
          carrierCode: params.carrierCode ?? env.shipStationCarrierId ?? "stamps_com",
          serviceCode:
            params.serviceCode ?? env.shipStationServiceCode ?? "usps_priority_mail",
          packageCode: "package",
          confirmation: "delivery",
          shipDate: new Date().toISOString().slice(0, 10),
          weight: { value: 1, units: "pounds" },
          dimensions: { units: "inches", length: 12, width: 10, height: 2 },
          ...(shipFrom && { shipFrom }),
          // Use test labels outside production to avoid consuming real postage.
          testLabel: env.nodeEnv !== "production",
        }
      );
      // ShipStation v2 (ssapi.shipstation.com) returns labelData as a base64-encoded PDF.
      // ShipStation v3 returns labelDownload.{pdf,href,png} as URLs.
      // We normalise both into a single labelUrl for storage.
      const labelUrl =
        result.labelDownload?.pdf ??
        result.labelDownload?.href ??
        result.labelDownload?.png ??
        (result.labelData ? `data:application/pdf;base64,${result.labelData}` : "");

      return {
        shipStationShipmentId: String(result.shipmentId),
        trackingNumber: String(result.trackingNumber ?? ""),
        labelUrl,
        carrier: String(result.carrierCode ?? params.carrierCode ?? ""),
        labelCost: Number.isFinite(Number(result.shipmentCost))
          ? Math.round((Number(result.shipmentCost) + (Number(result.insuranceCost) || 0)) * 100) / 100
          : null,
      };
    },
    3,
    1000,
    "createLabel"
  );

interface SSShipmentsResponse {
  shipments: Array<{
    shipmentId: number;
    trackingNumber: string;
    deliveryDate?: string;
    shipmentStatusCode?: string;
  }>;
}

export const getShipmentTracking = (opts: {
  trackingNumber?: string;
  orderNumber?: string;
}): Promise<{ status: string; deliveredAt?: Date }> =>
  withRetry(
    async () => {
      const qs = new URLSearchParams();
      if (opts.trackingNumber) qs.set("trackingNumber", opts.trackingNumber);
      else if (opts.orderNumber) qs.set("orderNumber", opts.orderNumber);
      else throw new Error("Provide trackingNumber or orderNumber");

      const result = await ssRequest<SSShipmentsResponse>(
        "GET",
        `/shipments?${qs.toString()}`
      );
      const shipments = result.shipments ?? [];
      if (shipments.length === 0) return { status: "unknown" };

      // Use the most recent shipment record.
      const latest = shipments[shipments.length - 1];
      const status = String(latest.shipmentStatusCode ?? "unknown").toLowerCase();
      const deliveredAt = latest.deliveryDate ? new Date(latest.deliveryDate) : undefined;
      return { status, deliveredAt };
    },
    2,
    2000,
    "getTracking"
  );

// ── Pure status classifier — exported for unit testing ────────────────────────

export const isDeliveredStatus = (status: string): boolean =>
  String(status ?? "")
    .toLowerCase()
    .trim() === "delivered";

// ── Full workflow orchestration ───────────────────────────────────────────────
//
// Called fire-and-forget when a printer marks a job "Ready for Packaging"
// (QUALITY_CHECK).  The function:
//   1. Atomically claims the order (idempotency guard via shipStationTriggeredAt)
//   2. Creates a ShipStation order
//   3. Generates a shipping label → gets tracking number
//   4. Atomically updates the DB order to SHIPPED with all tracking fields
//   5. Fires customer SSE + admin notification
//
// On failure: logs the error, pushes a timeline note, clears the trigger lock
// so the printer can retry by re-setting the status to QUALITY_CHECK.

export const triggerShipStationWorkflow = async (orderId: string): Promise<void> => {
  if (!isShipStationConfigured()) {
    console.warn(
      `[SS] Credentials not configured — skipping ShipStation workflow for order ${orderId}`
    );
    return;
  }

  // Atomically claim this order for ShipStation processing.
  // MongoDB's { field: null } matches both explicit null and documents where the
  // field is absent, so this guard works for all existing orders too.
  const claimed = await Order.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(orderId),
      shipStationTriggeredAt: null,
    },
    { $set: { shipStationTriggeredAt: new Date() } },
    { new: false } // return pre-update document so we have all the order data
  );

  if (!claimed) {
    console.log(
      `[SS] Workflow already triggered or order not found for ${orderId} — skipping duplicate`
    );
    return;
  }

  const displayId = String(
    (claimed as any).displayId ?? String(claimed._id).slice(-6).toUpperCase()
  );

  console.log(`[SS] Starting workflow for order ${orderId} (${displayId})`);

  try {
    // ── Validate shipping address ──────────────────────────────────────────
    const addr = claimed.shippingAddress;
    if (!addr?.street || !addr?.city || !addr?.state || !addr?.postalCode) {
      throw new Error(`Incomplete shipping address on order ${orderId}`);
    }

    // USPS/domestic carriers only support US addresses. Catch this early so the
    // printer sees a clear message rather than a raw ShipStation 400 error.
    const countryCode = normaliseCountry((addr as any).country);
    if (countryCode !== "US") {
      throw new Error(
        `Cannot generate a USPS domestic label for a ${(addr as any).country || countryCode} address. ` +
        `This order requires international shipping — please contact support to arrange a shipping method.`
      );
    }

    // ── Step 1: Create ShipStation order ──────────────────────────────────
    const items = (claimed.items ?? []).map((it: any) => ({
      name: String(it.name ?? it.type ?? "Print Item"),
      quantity: Number(it.quantity ?? 1),
      unitPrice: Number(it.unitPrice ?? 0),
    }));

    const { shipStationOrderId } = await createShipStationOrder({
      displayId,
      customerFirstName: claimed.customer.firstName,
      customerLastName: claimed.customer.lastName,
      customerEmail: claimed.customer.email,
      phone: claimed.customer.phone,
      street: addr.street,
      city: addr.city,
      state: addr.state,
      postalCode: addr.postalCode,
      country: countryCode,
      items,
      totalAmount: Number((claimed as any).pricing?.total ?? 0),
    });

    console.log(
      `[SS] Created ShipStation order ${shipStationOrderId} for order ${orderId}`
    );

    // ── Step 2: Resolve printer's business address for ship-from ─────────
    let shipFrom: Parameters<typeof createShipStationLabel>[0]["shipFrom"] | undefined;
    if (claimed.assignedPrinter) {
      const printer = await User.findById(claimed.assignedPrinter)
        .select("name companyName phone businessAddress")
        .lean();
      const bAddr = (printer as any)?.businessAddress;
      if (bAddr?.street) {
        shipFrom = {
          name: String((printer as any).companyName || (printer as any).name || "Print Partner"),
          street1: String(bAddr.street),
          city: String(bAddr.city || ""),
          state: String(bAddr.state || ""),
          postalCode: String(bAddr.postalCode || ""),
          country: String(bAddr.country || "US"),
          phone: String((printer as any).phone || ""),
        };
      }
    }

    // ── Step 3: Generate shipping label ───────────────────────────────────
    const { shipStationShipmentId, trackingNumber, labelUrl, carrier, labelCost } =
      await createShipStationLabel({ shipStationOrderId, shipFrom });

    console.log(
      `[SS] Label generated — tracking: ${trackingNumber} carrier: ${carrier} for order ${orderId}`
    );

    // ── Step 4: Store label fields — keep status QUALITY_CHECK ────────────
    // The printer must review and physically print the label, then click
    // "Confirm Shipment" to advance to SHIPPED. Status is NOT auto-advanced here.
    const now = new Date();
    const timelineEntry = {
      status: "QUALITY_CHECK",
      time: now,
      message: `Shipping label ready. Carrier: ${carrier}, Tracking: ${trackingNumber}. Awaiting printer confirmation.`,
      actorRole: "SYSTEM",
      actorId: "SHIPSTATION",
      actorName: "ShipStation",
    };

    // If ShipStation returned no PDF URL (e.g. test labels), use a sentinel so the
    // printer app knows generation completed and stops polling.
    const finalLabelUrl = labelUrl || "generated";

    await Order.updateOne(
      { _id: new mongoose.Types.ObjectId(orderId) },
      {
        $set: {
          trackingNumber,
          carrier,
          shipStationOrderId,
          shipStationShipmentId,
          shipStationLabelUrl: finalLabelUrl,
          // Shipping's real cost to the business, for the admin's profit figure.
          shipStationLabelCost: labelCost,
          shipStationError: null,
          updatedAt: now,
        },
        $push: { statusTimeline: timelineEntry },
      }
    );

    // Notify the printer so they know the label is ready to print.
    if (claimed.assignedPrinter) {
      notifyPrinter({
        printerId: String(claimed.assignedPrinter),
        category: "jobs",
        priority: "medium",
        title: "Shipping label ready",
        message: `Label for order #${displayId} is ready — open the order to print and confirm shipment.`,
        meta: { orderId, displayId, trackingNumber, carrier },
        settingsKey: "orderUpdates",
      }).catch(() => {});
    }

    console.log(
      `[SS] Label ready for order ${orderId} — tracking: ${trackingNumber}, awaiting printer confirmation`
    );
  } catch (err: any) {
    console.error(`[SS] Workflow FAILED for order ${orderId}: ${err?.message}`);

    const errMsg = String(err?.message ?? "Unknown ShipStation error").slice(0, 500);

    // Clear the trigger lock so the printer can retry, and surface the error message.
    await Order.updateOne(
      { _id: new mongoose.Types.ObjectId(orderId) },
      {
        $set: {
          shipStationTriggeredAt: null,
          shipStationError: errMsg,
        },
        $push: {
          statusTimeline: {
            status: "QUALITY_CHECK",
            time: new Date(),
            message: `ShipStation workflow failed: ${errMsg}`,
            actorRole: "SYSTEM",
            actorId: "SHIPSTATION",
            actorName: "ShipStation",
          },
        },
      }
    ).catch(() => {});

    notifyAllAdmins({
      category: "orders",
      priority: "high",
      title: "ShipStation workflow failed",
      message:
        `Order #${displayId} could not be shipped automatically. ` +
        `Error: ${String(err?.message ?? "unknown").slice(0, 200)}. Manual shipping required.`,
      meta: { orderId, displayId, error: err?.message },
    }).catch(() => {});
  }
};
