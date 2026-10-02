import { Request, Response, NextFunction } from "express";
import { assertOrderRequest, buildOrderItem } from "../../services/orderCreation.service.js";
import { resolveApiFile } from "../../utils/publicApiBase.js";
import { verifyCardPayment } from "../../services/paymentVerification.service.js";
import { User } from "../../models/user.model.js";
import { isValidPhone } from "../../utils/accountFields.js";
import { Order } from "../../models/order.model.js";
import { Settings } from "../../models/settings.model.js";
import { renderInvoicePdf } from "../../services/invoicePdf.service.js";
import { customerOrderStatus, formatSheetSize, orderChargeLines, orderRefundNote } from "../../utils/orderPresentation.js";
import {
  getGlobalPricing,
  computeTotals as computeOrderTotals,
      normalizeShippingMethod,
  priorityForShippingMethod,
  totalBillableSqFt } from "../../services/pricing.service.js";
import { quoteShipping } from "../../services/shipping.service.js";
import { deriveParcel } from "../../services/packaging.service.js";
import { predictShippingOrigin } from "../../services/orderAssignment.service.js";
import { autoAssignOrder } from "../../services/orderAssignment.service.js";
import { renderOrderSheetPreviews } from "../../services/orderPreview.service.js";
import { sendOrderConfirmationEmail } from "../../services/orderEmails.service.js";
import { orderSheetWidthIn } from "../../services/gangsheetExport.service.js";
import { getRegionFromState, getLatLngFromState, getRegionFromCoords, normalizeRegion } from "../../utils/region.js";
import { geocodeAddress } from "../../utils/geocoding.js";
import { assertPersistable } from "../../utils/documentSize.js";
import { notifyAllAdmins } from "../../services/adminNotifications.service.js";
import { CustomError } from "./shared.js";

export const createOrder = async (req: Request, res: Response, next: NextFunction) => {
  /**
   * Per-stage timing.
   *
   * Placing an order touches validation, several Mongo round trips, a counter
   * increment and a save. A single total tells you nothing about which to look
   * at when it is slow, so each stage is measured and logged on one line keyed
   * by order id. Plain counters rather than a tracing library: one request
   * path, one `Date.now()` per stage, greppable output.
   */
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  let stageMark = startedAt;
  const mark = (stage: string) => {
    const now = Date.now();
    timings[stage] = now - stageMark;
    stageMark = now;
  };

  try {
    const {
      items,
      customer,
      shippingAddress,
      shippingMethod,
      payment,
      pricing
    } = req.body || {};

    assertOrderRequest({ items, customer, shippingAddress, shippingMethod, payment, pricing });

    const roundToTwo = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

    // Read before the items are priced: every line, the shipping and the tax on
    // this order come from one set of rates.
    const globalPricing = await getGlobalPricing();

    const orderItems = (items as any[]).map((item) => buildOrderItem(item, globalPricing));
    const computedSubtotal = orderItems.reduce((sum, it) => sum + it.subtotal, 0);

    const roundedComputedSubtotal = roundToTwo(computedSubtotal);

    if (roundToTwo(pricing.subtotal) !== roundedComputedSubtotal) {
      // Not an error any more: the server priced these lines itself, so a
      // disagreement means the client's figure was stale or wrong, not that the
      // order is invalid. Rejecting here would turn a rate change mid-checkout
      // into a failed order.
      console.warn(
        `[ORDER_PRICING] client sent subtotal ${roundToTwo(pricing.subtotal)} but server priced ` +
          `the items at ${roundedComputedSubtotal} — recording the server figure`,
      );
    }

    const shippingQuote = await quoteShipping({
      totalSqFt: totalBillableSqFt(items, globalPricing),
      method: normalizeShippingMethod(shippingMethod),
      destination: {
        state: String(shippingAddress?.state || ""),
        postalCode: String(shippingAddress?.postalCode || ""),
        country: String(shippingAddress?.country || "US"),
        city: shippingAddress?.city ? String(shippingAddress.city) : undefined,
      },
      packaging: globalPricing.packaging,
      markupPct: globalPricing.shippingMarkupPct,
      fallbackRates: globalPricing.shipping,
      // Quote from the region that will actually fulfil this, not from the
      // fixed warehouse postcode in the environment.
      origin: await predictShippingOrigin(shippingAddress?.state).catch(() => null),
    });

    const orderPriority = priorityForShippingMethod(shippingMethod);

    const authoritativeTotals = computeOrderTotals({
      subtotal: roundedComputedSubtotal,
      shippingMethod,
      pricing: globalPricing,
      shippingCost: shippingQuote.cost,
      priority: orderPriority,
    });

    const recordedPricing = {
      subtotal: authoritativeTotals.subtotal,
      rushSurcharge: authoritativeTotals.rushSurcharge,
      shippingCost: authoritativeTotals.shippingCost,
      tax: authoritativeTotals.tax,
      total: authoritativeTotals.total,
      currency: authoritativeTotals.currency,
    };

    if (roundToTwo(pricing.total) !== authoritativeTotals.total) {
      console.warn(
        `[ORDER_PRICING] client sent total ${roundToTwo(pricing.total)} but server computed ` +
          `${authoritativeTotals.total} (shipping ${authoritativeTotals.shippingCost}, tax ${authoritativeTotals.tax}) — ` +
          `recording the server figure`,
      );
    }

    mark("validate");

    mark("loadUser");

    // Derive region strictly from the shipping address state — same function used during
    // auto-assignment. Returns null for non-US / unknown state codes; never defaults to "West".
    const stateBasedRegion = getRegionFromState(shippingAddress?.state);
    const stateCoord = getLatLngFromState(shippingAddress?.state);

    if (customer?.phone && !isValidPhone(String(customer.phone))) {
      const error = new Error("Enter a valid phone number") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // customer.region field is cosmetic only — do not use it to override the address region.
    const normalizedCustomer = {
      ...customer,
      region: stateBasedRegion || null
    };

    const nextOrderDisplayId = async () => {
      const counter = await Settings.findOneAndUpdate(
        { key: "order_display_counter" },
        { $inc: { "value.next": 1 } },
        { new: true, upsert: true, runValidators: true }
      ).lean();
      const seq = Number((counter as any)?.value?.next || 1) - 1;
      return `DTF-${String(seq).padStart(4, "0")}`;
    };

    const enrichedShippingAddress = {
      ...shippingAddress,
      // Only store detectedRegion when we have a confirmed US state — never store "West" as a
      // default, because the assignment service reads this field and a stale "West" causes
      // false-positive region matches with West-region printers.
      detectedRegion: stateBasedRegion ?? undefined,
      coordinates: stateCoord ? { lat: stateCoord.lat, lng: stateCoord.lon } : undefined,
      geocoded: false
    };

    const verifiedPayment = await verifyCardPayment({
      paymentIntentId: payment.paymentIntentId,
      expectedTotal: recordedPricing.total,
      currency: recordedPricing.currency,
      userId: String(req.user?.id || ""),
    });

    /*
     * Built from what Stripe confirmed, not from what the request sent. The two
     * agree when the caller is honest, and only one of them is evidence.
     */
    const recordedPayment = {
      method: "card" as const,
      paymentIntentId: verifiedPayment.paymentIntentId,
      cardBrand: verifiedPayment.cardBrand ?? undefined,
      cardLast4: verifiedPayment.cardLast4 ?? undefined,
      // Stripe's fee, so profit is counted after it. Filled in later if Stripe
      // hadn't settled the charge yet (see `recordMissingProcessingFee`).
      processingFee: verifiedPayment.processingFee ?? undefined,
    };

    const order = new Order({
      user: req.user?.id,
      displayId: await nextOrderDisplayId(),
      items: orderItems,
      customer: normalizedCustomer,
      shippingAddress: enrichedShippingAddress,
      shippingMethod,
      payment: recordedPayment,
      priority: orderPriority,
      pricing: recordedPricing,
      shippingQuote: {
        carrierCost: shippingQuote.carrierCost ?? undefined,
        chargedCost: shippingQuote.cost,
        serviceName: shippingQuote.serviceName ?? undefined,
        serviceCode: shippingQuote.serviceCode ?? undefined,
        source: shippingQuote.source,
        fallbackReason: shippingQuote.fallbackReason,
        originPostalCode: shippingQuote.originPostalCode ?? undefined,
        originPartnerRegion: shippingQuote.originPartnerRegion ?? undefined,
        parcel: deriveParcel(totalBillableSqFt(items, globalPricing), globalPricing.packaging),
      },
      status: "PENDING"
    });

    mark("buildOrder");

    // Checked before the first save attempt rather than inside the retry loop:
    // an oversized document fails identically on every retry, and the retry
    // exists for duplicate display IDs only.
    assertPersistable(order.toObject(), { label: "order" });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await order.save();
        mark("save");
        break;
      } catch (e: any) {
        const isDup = e?.code === 11000 && (e?.keyPattern?.displayId || e?.keyValue?.displayId);
        if (!isDup || attempt === 2) throw e;
        order.displayId = await nextOrderDisplayId();
      }
    }

    // Fire-and-forget: generate a server-side gangsheet thumbnail from the full-resolution
    // DB assets so the job list shows the same quality as the OrderDetails preview.
    // Runs after save so it never blocks the checkout response.
    const orderId = order.id;
    void renderOrderSheetPreviews(order.id, orderItems);

    // The customer's receipt. Sent in the background: a mail failure must not
    // fail an order that is already paid and saved.
    void sendOrderConfirmationEmail(order.toObject());

    // Fire-and-forget: geocode to verify/correct state code and get precise coordinates.
    // The assignment service uses detectedRegion from the order — this updates it in the background.
    (async () => {
      try {
        const geo = await geocodeAddress({
          street: shippingAddress.street,
          city: shippingAddress.city,
          state: shippingAddress.state,
          zip: shippingAddress.postalCode,
          country: shippingAddress.country
        });
        if (geo) {
          const geoRegion =
            normalizeRegion(getRegionFromState(geo.state)) ??
            getRegionFromCoords(geo.lat, geo.lng);
          await Order.findByIdAndUpdate(orderId, {
            "shippingAddress.detectedRegion": geoRegion,
            "shippingAddress.coordinates": { lat: geo.lat, lng: geo.lng },
            "shippingAddress.geocoded": true,
            "customer.region": geoRegion
          });
          console.log(`[ORDER_GEO] orderId=${orderId} geocodedState=${geo.state} region=${geoRegion} lat=${geo.lat} lng=${geo.lng}`);
        }
      } catch (err: any) {
        console.warn(`[ORDER_GEO] orderId=${orderId} geocoding failed (non-fatal): ${err?.message}`);
      }
    })();

    /*
     * The order is saved and paid, so what was in the cart has been bought.
     * Cleared here, not only by the store after the response: if the customer
     * closes the tab first, the saved cart would otherwise come back on their
     * next sign-in holding sheets they already paid for.
     */
    if (req.user?.id) {
      await User.updateOne({ _id: req.user.id }, { $set: { cart: [] } }).catch((err: any) => {
        console.warn(`[ORDER_CART] orderId=${orderId} could not clear the saved cart (non-fatal): ${err?.message}`);
      });
    }

    notifyAllAdmins({
      category: "orders",
      priority: "medium",
      title: "New order placed",
      message: `${String(customer.firstName)} ${String(customer.lastName)} • $${recordedPricing.total.toFixed(2)}`,
      meta: { orderId: order.id, status: "PENDING" }
    }).catch(() => {});

    /**
     * Auto-assignment runs after the response.
     *
     * It was awaited behind a 1.9s timeout and followed by a second `findById`
     * to read back what it had written — so every customer paid up to ~2
     * seconds of dead time on the one click where responsiveness matters most,
     * and paid it in full whenever no printer matched, since that is the case
     * that runs longest before giving up.
     *
     * Nothing in the response depends on it: the order is saved and paid. Which
     * printer takes the job is decided afterwards and reaches the client
     * through the order status it already polls.
     */
    void autoAssignOrder(order.id)
      .then((result: any) => {
        console.log(
          `[ORDER_ASSIGN] orderId=${orderId} assigned=${result?.assigned} ` +
            `reason=${result?.reason ?? "-"} tookMs=${result?.tookMs ?? "-"}`,
        );
      })
      .catch((err: any) => {
        console.warn(`[ORDER_ASSIGN] orderId=${orderId} failed (non-fatal): ${err?.message}`);
      });

    timings.total = Date.now() - startedAt;
    console.log(
      `[ORDER_TIMING] orderId=${orderId} items=${orderItems.length} ` +
        `placements=${orderItems.reduce((n: number, i: any) => n + (i.artboardItems?.length ?? 0), 0)} ` +
        Object.entries(timings).map(([k, v]) => `${k}=${v}ms`).join(" "),
    );

    res.status(201).json({
      id: order.id,
      displayId: (order as any).displayId || null,
      createdAt: order.createdAt,
      status: order.status,
      pricing: order.pricing,
      // Decided after this response; the client shows PENDING and picks the
      // printer up from the order record.
      assignment: { assigned: false, orderId: order.id, reason: "Assignment in progress", tookMs: 0 },
      assignedPrinter: null
    });
  } catch (error) {
    next(error);
  }
};

export const listOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, limit, cursor } = req.query || {};

    const query: any = {
      user: req.user?.id
    };

    if (status) {
      const normalized = status.toString().trim().toLowerCase();
      const statusMap: { [key: string]: string[] } = {
        pending: ["PENDING"],
        processing: ["PROCESSING", "PRINTING", "QUALITY_CHECK"],
        shipped: ["SHIPPED"],
        completed: ["COMPLETED"],
        cancelled: ["CANCELLED"]
      };

      const mappedStatuses = statusMap[normalized];
      if (!mappedStatuses) {
        const error = new Error("Invalid status filter") as CustomError;
        error.statusCode = 400;
        throw error;
      }

      if (mappedStatuses.length === 1) {
        query.status = mappedStatuses[0];
      } else {
        query.status = { $in: mappedStatuses };
      }
    }

    if (cursor) {
      query._id = { $lt: cursor };
    }

    let parsedLimit = 20;
    if (limit !== undefined) {
      const n = parseInt(limit as string, 10);
      if (!Number.isNaN(n) && n > 0) {
        parsedLimit = Math.min(n, 100);
      }
    }

    const results = await Order.find(query)
      .sort({ _id: -1 })
      .limit(parsedLimit + 1);

    const hasMore = results.length > parsedLimit;
    const orders = hasMore ? results.slice(0, parsedLimit) : results;

    // Only the first sheet was described, so a three-sheet order read as one.
    const describeSheets = (order: any) => {
      const items = Array.isArray(order.items) ? order.items : [];
      if (items.length === 0) return null;
      if (items.length > 1) return `${items.length} sheets`;
      const it = items[0];
      return formatSheetSize(it.sheetWidthIn ?? it.widthIn, it.sheetHeightIn ?? it.heightIn);
    };

    const responseOrders = orders.map((order) => ({
      orderId: order.id,
      // Same order number the customer sees on their invoice and in emails.
      displayId: (order as any).displayId || null,
      status: customerOrderStatus(order.status),
      date: order.createdAt,
      total: order.pricing?.total ?? null,
      sheetSize: describeSheets(order),
      trackingNumber: order.trackingNumber || null
    }));

    const nextCursor = hasMore ? orders[orders.length - 1].id : null;

    res.json({
      orders: responseOrders,
      nextCursor
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ _id: orderId, user: req.user?.id });

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const formattedItems = (order.items || []).map((item) => {
      const description =
        formatSheetSize((item as any).sheetWidthIn ?? item.widthIn, (item as any).sheetHeightIn ?? item.heightIn) || "";

      return {
        name: item.name || "Unknown Item",
        description: description,
        quantity: item.quantity || 0,
        unitPrice: item.unitPrice || 0,
        subtotal: item.subtotal || 0,
        type: item.type || "gangsheet",
        widthIn: item.widthIn ?? null,
        heightIn: item.heightIn ?? null,
        sheetWidthIn: (item as any).sheetWidthIn ?? item.widthIn ?? null,
        sheetHeightIn: (item as any).sheetHeightIn ?? item.heightIn ?? null,
        // So the reordered line can point at the same artwork.
        designId: (item as any).designId ?? null,
        previewImage: resolveApiFile(req, (item as any).previewImage),
        /*
         * What reorder needs to rebuild the same sheet: where every graphic sat,
         * and the roll and spacing it was laid out with. Without the placements a
         * reordered sheet reached checkout with no artwork and became an order
         * the printer had nothing to print from.
         */
        artboardItems: Array.isArray((item as any).artboardItems) ? (item as any).artboardItems : undefined,
        // The roll it printed on, by the same rule the printer export uses —
        // orders placed before the roll was recorded printed at the legacy width.
        rollWidthIn: (item.type || "gangsheet") === "gangsheet" ? orderSheetWidthIn(item as any) : null,
        itemSpacingIn: (item as any).itemSpacingIn ?? null,
        sheetMarginIn: (item as any).sheetMarginIn ?? null,
      };
    });

    const pricing = order.pricing || {};

    res.json({
      orderId: order.id,
      displayId: (order as any).displayId || null,
      status: customerOrderStatus(order.status),
      // Missing, so the details view fell back to today's date for every order.
      date: order.createdAt,
      shippingMethod: (order as any).shippingMethod === "express" ? "express" : "standard",
      trackingNumber: order.trackingNumber || null,
      carrier: (order as any).carrier || null,
      refundNote: orderRefundNote(order),
      items: formattedItems,
      shippingAddress: {
        name: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim() || "Valued Customer",
        street: order.shippingAddress?.street || "N/A",
        city: order.shippingAddress?.city || "N/A",
        state: order.shippingAddress?.state || "N/A",
        postalCode: order.shippingAddress?.postalCode || "N/A",
        country: order.shippingAddress?.country || "N/A"
      },
      payment: {
        method: order.payment?.method || "N/A",
        cardBrand: order.payment?.cardBrand || null,
        cardLast4: order.payment?.cardLast4 || null
      },
      pricing: {
        lineItems: orderChargeLines(order),
        total: pricing.total || 0,
        currency: pricing.currency || "USD"
      }
    });
  } catch (error) {
    next(error);
  }
};

export const downloadInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ _id: orderId, user: req.user?.id });

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const formattedItems = (order.items || []).map((item) => {
      const description =
        formatSheetSize((item as any).sheetWidthIn ?? item.widthIn, (item as any).sheetHeightIn ?? item.heightIn) || "";
      return {
        name: item.name || "Unknown Item",
        description: description,
        quantity: item.quantity || 0,
        unitPrice: (item.unitPrice || 0).toFixed(2),
        subtotal: (item.subtotal || 0).toFixed(2)
      };
    });

    const pricing = order.pricing || {};
    // The same lines as the order details and the admin's copy of this invoice.
    const lineItems = orderChargeLines(order);

    const data = {
      // The invoice is the most customer-visible document there is, so it
      // carries the canonical DTF-#### number rather than the raw ObjectId.
      orderId: (order as any).displayId || order.id,
      date: (order.createdAt || new Date()).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      shippingAddress: {
        name: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim() || "Valued Customer",
        street: order.shippingAddress?.street || "N/A",
        city: order.shippingAddress?.city || "N/A",
        state: order.shippingAddress?.state || "N/A",
        postalCode: order.shippingAddress?.postalCode || "N/A",
        country: order.shippingAddress?.country || "N/A"
      },
      items: formattedItems,
      pricing: {
        lineItems,
        total: (pricing.total || 0).toFixed(2),
        currency: pricing.currency || "USD"
      },
      note: orderRefundNote(order) || undefined,
    };

    const pdfBuffer = await renderInvoicePdf(data);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${data.orderId}.pdf"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.send(pdfBuffer);

  } catch (error) {
    next(error);
  }
};
