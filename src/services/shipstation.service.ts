import mongoose from "mongoose";
import { Order } from "../models/order.model.js";
import { env } from "../config/env.js";
import { publishOrderEvent } from "./orderSyncHub.js";
import { notifyAllAdmins } from "./adminNotifications.service.js";

const SS_BASE = "https://ssapi.shipstation.com";

// ── Retry utility — exported so tests can exercise it directly ────────────────

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

  const res = await fetch(`${SS_BASE}${path}`, {
    method,
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

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
  const res = await fetch(fullUrl, {
    method: "GET",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ShipStation GET ${fullUrl} → HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json() as Promise<T>;
}

// ── ShipStation API wrappers ──────────────────────────────────────────────────

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
        country: params.country || "US",
        phone: params.phone || "",
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
        weight: { value: 1, units: "pounds" },
        dimensions: { units: "inches", length: 12, width: 10, height: 2 },
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
  labelDownload?: { pdf?: string; png?: string };
  carrierCode: string;
}

export const createShipStationLabel = (params: {
  shipStationOrderId: string;
  carrierId?: string;
  serviceCode?: string;
}): Promise<{
  shipStationShipmentId: string;
  trackingNumber: string;
  labelUrl: string;
  carrier: string;
}> =>
  withRetry(
    async () => {
      const result = await ssRequest<SSCreateLabelResponse>(
        "POST",
        "/orders/createlabelfororder",
        {
          orderId: Number(params.shipStationOrderId),
          carrierId: params.carrierId ?? env.shipStationCarrierId ?? "stamps_com",
          serviceCode:
            params.serviceCode ?? env.shipStationServiceCode ?? "usps_priority_mail",
          packageCode: "package",
          confirmation: "delivery",
          shipDate: new Date().toISOString().slice(0, 10),
          weight: { value: 1, units: "pounds" },
          dimensions: { units: "inches", length: 12, width: 10, height: 2 },
          // Use test labels outside production to avoid consuming real postage.
          testLabel: env.nodeEnv !== "production",
        }
      );
      return {
        shipStationShipmentId: String(result.shipmentId),
        trackingNumber: String(result.trackingNumber ?? ""),
        labelUrl: String(result.labelDownload?.pdf ?? result.labelDownload?.png ?? ""),
        carrier: String(result.carrierCode ?? params.carrierId ?? ""),
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
      country: addr.country ?? "US",
      items,
      totalAmount: Number((claimed as any).pricing?.total ?? 0),
    });

    console.log(
      `[SS] Created ShipStation order ${shipStationOrderId} for order ${orderId}`
    );

    // ── Step 2: Generate shipping label ───────────────────────────────────
    const { shipStationShipmentId, trackingNumber, labelUrl, carrier } =
      await createShipStationLabel({ shipStationOrderId });

    console.log(
      `[SS] Label generated — tracking: ${trackingNumber} carrier: ${carrier} for order ${orderId}`
    );

    // ── Step 3: Mark order SHIPPED atomically ─────────────────────────────
    const now = new Date();
    const timelineEntry = {
      status: "SHIPPED",
      time: now,
      message:
        `Auto-shipped via ShipStation. Carrier: ${carrier}, Tracking: ${trackingNumber}`,
      actorRole: "SYSTEM",
      actorId: "SHIPSTATION",
      actorName: "ShipStation",
    };

    await Order.updateOne(
      { _id: new mongoose.Types.ObjectId(orderId) },
      {
        $set: {
          status: "SHIPPED",
          trackingNumber,
          carrier,
          shipStationOrderId,
          shipStationShipmentId,
          shipStationLabelUrl: labelUrl,
          updatedAt: now,
        },
        $push: { statusTimeline: timelineEntry },
      }
    );

    // Customer-facing SSE (bypasses Mongoose save hook since we used updateOne).
    publishOrderEvent(orderId, "order.status.changed", {
      orderId,
      status: "SHIPPED",
      from: "QUALITY_CHECK",
      to: "SHIPPED",
      trackingNumber,
      carrier,
      updatedAt: now,
      lastTimelineEntry: timelineEntry,
    });

    notifyAllAdmins({
      category: "orders",
      priority: "medium",
      title: "Order shipped",
      message:
        `Order #${displayId} shipped via ShipStation. ` +
        `Carrier: ${carrier}, Tracking: ${trackingNumber}.`,
      meta: { orderId, displayId, trackingNumber, carrier, shipStationOrderId },
    }).catch(() => {});

    console.log(
      `[SS] Workflow complete for order ${orderId} → SHIPPED, tracking: ${trackingNumber}`
    );
  } catch (err: any) {
    console.error(`[SS] Workflow FAILED for order ${orderId}: ${err?.message}`);

    // Clear the trigger lock so the printer can re-trigger by re-setting the status.
    await Order.updateOne(
      { _id: new mongoose.Types.ObjectId(orderId) },
      {
        $set: { shipStationTriggeredAt: null },
        $push: {
          statusTimeline: {
            status: "QUALITY_CHECK",
            time: new Date(),
            message: `ShipStation workflow failed: ${String(err?.message ?? "unknown error").slice(0, 300)}`,
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
