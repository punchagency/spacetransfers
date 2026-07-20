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
    shippingCost?: number;
    tax?: number;
    total: number;
    currency: string;
    adjustments?: IOrderAdjustment[];
  };
  status: "PENDING" | "PROCESSING" | "PRINTING" | "QUALITY_CHECK" | "SHIPPED" | "COMPLETED" | "CANCELLED" | "REJECTED" | "PAUSED" | "PAID" | "paid";
  rejectionReason?: string;
  trackingNumber?: string;
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
  assignmentHistory?: Array<{
    time: Date;
    mode: "AUTO" | "MANUAL";
    selectedPrinterId?: string | null;
    selectedPrinterName?: string | null;
    customerRegion?: string | null;
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
      method: { type: String, required: true },
      cardLast4: { type: String },
      cardBrand: { type: String },
      paymentIntentId: { type: String }
    },
    pricing: {
      subtotal: { type: Number },
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
      enum: ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK", "SHIPPED", "COMPLETED", "CANCELLED", "REJECTED", "PAUSED", "PAID", "paid"],
      default: "PENDING"
    },
    rejectionReason: {
      type: String
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
    assignmentHistory: [
      {
        time: { type: Date, default: Date.now },
        mode: { type: String, enum: ["AUTO", "MANUAL"], required: true },
        selectedPrinterId: { type: String },
        selectedPrinterName: { type: String },
        customerRegion: { type: String },
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
orderSchema.index({ createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

export const Order = mongoose.model<IOrder>("Order", orderSchema);
