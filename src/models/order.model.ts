import mongoose, { Document, Schema } from "mongoose";
import { publishOrderEvent } from "../services/orderSyncHub.js";

export interface IOrderItem {
  type: string;
  designId?: string;
  name: string;
  widthIn?: number;
  heightIn?: number;
  quantity: number;
  unitPrice: number;
  subtotal?: number;
  sheetWidthIn?: number;
  sheetHeightIn?: number;
  itemSpacingIn?: number;
  sheetMarginIn?: number;
  previewImage?: string;
  artboardItems?: Array<{
    id: number;
    assetId: string;
    croppedUrl?: string;
    autoCrop?: boolean;
    widthIn: number;
    heightIn: number;
    posX: number;
    posY: number;
    rotation: number;
    flipped?: boolean;
    copies: number;
    linked: boolean;
  }>;
}

export interface IOrderAdjustment {
  type: "discount" | "surcharge" | "credit" | "fee";
  amount: number;
  reason: string;
  createdAt: Date;
}

export interface ITrackingEvent {
  time: Date;
  location: string;
  description: string;
}

export interface IStatusTimeline {
  status: string;
  message?: string;
  actorRole?: string;
  actorId?: string;
  actorName?: string | null;
  time: Date;
}

export interface IOrder extends Document {
  user: mongoose.Types.ObjectId;
  displayId?: string;
  items: IOrderItem[];
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    region?: string;
  };
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    detectedRegion?: string;
    coordinates?: { lat: number; lng: number };
    geocoded?: boolean;
  };
  shippingMethod: string;
  payment: {
    method: string;
    cardLast4?: string;
    cardBrand?: string;
    paymentIntentId?: string;
  };
  pricing: {
    subtotal?: number;
    rushSurcharge?: number;
    shippingCost?: number;
    tax?: number;
    total: number;
    currency: string;
    adjustments?: IOrderAdjustment[];
  };
  status: "PENDING" | "PROCESSING" | "PRINTING" | "QUALITY_CHECK" | "SHIPPED" | "COMPLETED" | "CANCELLED";
  rejectionReason?: string;
  trackingNumber?: string;
  shippingQuote?: {
    carrierCost?: number;
    chargedCost?: number;
    serviceName?: string;
    serviceCode?: string;
    source?: "carrier" | "fallback";
    fallbackReason?: string;
    originPostalCode?: string;
    originPartnerRegion?: string;
    parcel?: { weightLb?: number; lengthIn?: number; widthIn?: number; heightIn?: number };
  };
  carrier?: string;
  trackingUrl?: string;
  trackingEvents?: ITrackingEvent[];
  assignedPrinter?: mongoose.Types.ObjectId;
  assignedAt?: Date | null;
  assignmentDeadline?: Date | null;
  returnedAt?: Date;
  cancelledByPrinterId?: mongoose.Types.ObjectId;
  cancelledByPrinterName?: string;
  // ShipStation fulfillment
  shipStationOrderId?: string;
  shipStationShipmentId?: string;
  shipStationLabelUrl?: string;
  shipStationTriggeredAt?: Date | null;
  shipStationError?: string | null;
  priority: "NORMAL" | "URGENT";
  notes?: string;
  specs?: {
    filmType?: "DTF" | "UV" | "Screen" | "Sublimation";
    passes?: number;
    temperatureC?: number;
    pressSeconds?: number;
  };
  statusTimeline?: IStatusTimeline[];
  /**
   * Set when an order was fulfilled outside the customer's own region.
   *
   * Auto-assignment falls back to adjacent regions when nothing in-region is
   * free, which keeps orders moving but means longer, costlier shipping. The
   * fact was previously only recoverable by parsing a timeline message, so it
   * was invisible in the admin UI and impossible to query.
   */
  crossRegionAssignment?: {
    customerRegion: string;
    assignedRegion: string;
    at: Date;
  } | null;
  assignmentHistory?: Array<{
    time: Date;
    mode: "AUTO" | "MANUAL";
    selectedPrinterId?: string | null;
    selectedPrinterName?: string | null;
    customerRegion?: string | null;
    assignedRegion?: string | null;
    isCrossRegion?: boolean;
    customerState?: string | null;
    candidatesConsidered?: number;
    candidatesSameRegion?: number;
    reason?: string;
    tookMs?: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    type: {
      type: String,
      required: true
    },
    designId: {
      type: String
    },
    name: {
      type: String,
      required: true
    },
    widthIn: {
      type: Number
    },
    heightIn: {
      type: Number
    },
    quantity: {
      type: Number,
      required: true
    },
    unitPrice: {
      type: Number,
      required: true
    },
    subtotal: {
      type: Number
    },
    sheetWidthIn: {
      type: Number
    },
    sheetHeightIn: {
      type: Number
    },
    itemSpacingIn: {
      type: Number
    },
    sheetMarginIn: {
      type: Number
    },
    previewImage: {
      type: String
    },
    artboardItems: {
      type: [
        {
          id: { type: Number, required: true },
          assetId: { type: String, required: true },
          croppedUrl: { type: String },
          autoCrop: { type: Boolean, default: true },
          widthIn: { type: Number, required: true },
          heightIn: { type: Number, required: true },
          posX: { type: Number, required: true },
          posY: { type: Number, required: true },
          rotation: { type: Number, default: 0 },
          flipped: { type: Boolean, default: false },
          copies: { type: Number, default: 1 },
          linked: { type: Boolean, default: false }
        }
      ],
      default: undefined
    }
  },
  { _id: false }
);

const orderSchema = new Schema<IOrder>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    displayId: {
      type: String
    },
    items: {
      type: [orderItemSchema],
      required: true
    },
    customer: {
      firstName: { type: String, required: true },
      lastName: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String },
      region: { type: String }
    },
    shippingAddress: {
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      postalCode: { type: String, required: true },
      country: { type: String, required: true },
      detectedRegion: { type: String },
      coordinates: {
        lat: { type: Number },
        lng: { type: Number }
      },
      geocoded: { type: Boolean, default: false }
    },
    shippingMethod: {
      type: String,
      required: true
    },
    payment: {
      // Defence in depth behind the controller's check: the only method the
      // platform takes is a Stripe card, and a free-form string here is what let
      // `method: "bank_transfer"` slip past payment verification entirely.
      method: { type: String, required: true, enum: ["card"] },
      cardLast4: { type: String },
      cardBrand: { type: String },
      paymentIntentId: { type: String }
    },
    pricing: {
      subtotal: { type: Number },
      // What the customer paid for the rush, distinct from the partner's rush
      // surcharge on the cost side.
      rushSurcharge: { type: Number },
      shippingCost: { type: Number },
      tax: { type: Number },
      total: { type: Number, required: true },
      currency: { type: String, required: true },
      adjustments: [
        {
          type: { type: String, enum: ["discount", "surcharge", "credit", "fee"] },
          amount: { type: Number, required: true },
          reason: { type: String, required: true },
          createdAt: { type: Date, default: Date.now }
        }
      ]
    },
    status: {
      type: String,
      /**
       * REJECTED, PAUSED, PAID and "paid" were removed: nothing reachable wrote
       * them. REJECTED and PAUSED were only ever set by `executeJobAction`,
       * which no UI calls; PAID/"paid" were never written at all and the
       * lower-case duplicate would have split any query that did.
       *
       * Declining a job is `cancelPrinterOrder`, which returns the order to
       * PENDING and reassigns it — better than a terminal rejected state, since
       * the order gets re-homed instead of stranded.
       */
      enum: ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK", "SHIPPED", "COMPLETED", "CANCELLED"],
      default: "PENDING"
    },
    rejectionReason: {
      type: String
    },
    /**
     * What the carrier quoted and what we charged, kept apart.
     *
     * Neither was recorded before: shipping was a flat $8.99 and the label's
     * real cost was thrown away, so "are we losing money on shipping?" had no
     * answer in the data. `source` distinguishes a live quote from the flat
     * fallback, so fallbacks can be counted rather than assumed rare.
     */
    shippingQuote: {
      carrierCost: { type: Number },
      chargedCost: { type: Number },
      serviceName: { type: String },
      serviceCode: { type: String },
      source: { type: String, enum: ["carrier", "fallback"] },
      fallbackReason: { type: String },
      originPostalCode: { type: String },
      originPartnerRegion: { type: String },
      parcel: {
        weightLb: { type: Number },
        lengthIn: { type: Number },
        widthIn: { type: Number },
        heightIn: { type: Number }
      }
    },
    trackingNumber: {
      type: String
    },
    carrier: {
      type: String
    },
    trackingUrl: {
      type: String
    },
    trackingEvents: [
      {
        time: { type: Date, required: true },
        location: { type: String, required: true },
        description: { type: String, required: true }
      }
    ],
    assignedPrinter: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },
    // The moment the order was assigned to its current printer, and the resulting
    // fulfilment deadline (assignedAt + 24h). Both are set together at every
    // assignment (auto or manual) so the printer's countdown starts from the exact
    // assignment time rather than the order's creation time.
    assignedAt: { type: Date, default: null },
    assignmentDeadline: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
    cancelledByPrinterId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledByPrinterName: { type: String, default: null },
    shipStationOrderId: { type: String, default: null },
    shipStationShipmentId: { type: String, default: null },
    shipStationLabelUrl: { type: String, default: null },
    shipStationTriggeredAt: { type: Date, default: null },
    shipStationError: { type: String, default: null },
    priority: {
      type: String,
      enum: ["NORMAL", "URGENT"],
      default: "NORMAL"
    },
    notes: {
      type: String,
      default: ""
    },
    specs: {
      filmType: { type: String, enum: ["DTF", "UV", "Screen", "Sublimation"] },
      passes: { type: Number },
      temperatureC: { type: Number },
      pressSeconds: { type: Number }
    },
    statusTimeline: [
      {
        status: { type: String, required: true },
        message: { type: String },
        actorRole: { type: String },
        actorId: { type: String },
        actorName: { type: String },
        time: { type: Date, default: Date.now }
      }
    ],
    crossRegionAssignment: {
      type: new Schema(
        {
          customerRegion: { type: String, required: true },
          assignedRegion: { type: String, required: true },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    assignmentHistory: [
      {
        time: { type: Date, default: Date.now },
        mode: { type: String, enum: ["AUTO", "MANUAL"], required: true },
        selectedPrinterId: { type: String },
        selectedPrinterName: { type: String },
        customerRegion: { type: String },
        assignedRegion: { type: String },
        isCrossRegion: { type: Boolean },
        customerState: { type: String },
        candidatesConsidered: { type: Number },
        candidatesSameRegion: { type: Number },
        reason: { type: String },
        tookMs: { type: Number }
      }
    ]
  },
  {
    timestamps: true
  }
);

orderSchema.pre("save", async function () {
  if (this.isNew) return;
  const isStatusModified = this.isModified("status");
  const isPricingModified = this.isModified("pricing");
  if (!isStatusModified && !isPricingModified) return;

  const prev = await (this.constructor as any)
    .findById(this._id)
    .select("status pricing.total pricing.subtotal pricing.tax pricing.shippingCost pricing.currency")
    .lean();

  (this as any).$locals = (this as any).$locals || {};
  (this as any).$locals.__prevStatus = prev?.status ?? null;
  (this as any).$locals.__prevPricing = prev?.pricing ?? null;
});

orderSchema.post("save", function (doc: any) {
  const orderId = doc?._id ? String(doc._id) : null;
  if (!orderId) return;

  const locals = (doc as any).$locals || {};
  const prevStatus = locals.__prevStatus ?? null;
  const prevPricing = locals.__prevPricing ?? null;

  const payloadBase = {
    orderId,
    status: String(doc.status || ""),
    updatedAt: doc.updatedAt,
    lastTimelineEntry: Array.isArray(doc.statusTimeline) && doc.statusTimeline.length ? doc.statusTimeline[doc.statusTimeline.length - 1] : null
  };

  if (prevStatus && String(prevStatus) !== String(doc.status || "")) {
    publishOrderEvent(orderId, "order.status.changed", {
      ...payloadBase,
      from: String(prevStatus),
      to: String(doc.status || "")
    });
  }

  if (prevPricing && JSON.stringify(prevPricing) !== JSON.stringify(doc.pricing || null)) {
    publishOrderEvent(orderId, "order.financials.changed", {
      ...payloadBase,
      pricing: doc.pricing || null
    });
  }

  publishOrderEvent(orderId, "order.updated", payloadBase);
});

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ displayId: 1 }, { unique: true, sparse: true });
orderSchema.index({ assignedPrinter: 1, createdAt: -1 });
orderSchema.index({ returnedAt: -1, createdAt: -1 });
orderSchema.index({ updatedAt: -1, _id: -1 });
/*
 * Serves the unassigned-first orders list, which pages the unassigned and
 * assigned blocks separately and sorts each by recency.
 *
 * Without it the unassigned block is a blocking in-memory SORT: the planner
 * picks `assignedPrinter_1_createdAt_-1` for the filter, then re-sorts by
 * updatedAt in memory. Fine at three orders, slow at thousands, and a hard
 * failure past MongoDB's 32 MB sort ceiling — the list would simply stop
 * returning, which is the worst way for it to break.
 */
orderSchema.index({ assignedPrinter: 1, updatedAt: -1, _id: -1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

/**
 * One payment cannot buy two orders.
 *
 * `verifyCardPayment` looks for an existing order on the same intent, but two
 * requests arriving together would both find none and both succeed. This is
 * what actually settles it. Partial, so orders with no `paymentIntentId` — cash,
 * and every row predating card payments — do not collide on `null`.
 */
orderSchema.index(
  { "payment.paymentIntentId": 1 },
  {
    unique: true,
    partialFilterExpression: { "payment.paymentIntentId": { $type: "string" } },
    name: "unique_payment_intent",
  },
);

export const Order = mongoose.model<IOrder>("Order", orderSchema);
