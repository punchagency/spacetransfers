import mongoose, { Document, Schema } from "mongoose";

export interface IOrderItem {
  type: string;
  designId?: string;
  name: string;
  widthIn?: number;
  heightIn?: number;
  quantity: number;
  unitPrice: number;
  subtotal?: number;
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
  time: Date;
}

export interface IOrder extends Document {
  user: mongoose.Types.ObjectId;
  items: IOrderItem[];
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
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
  priority: "NORMAL" | "URGENT";
  notes?: string;
  specs?: {
    filmType?: "DTF" | "UV" | "Screen" | "Sublimation";
    passes?: number;
    temperatureC?: number;
    pressSeconds?: number;
  };
  statusTimeline?: IStatusTimeline[];
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
    items: {
      type: [orderItemSchema],
      required: true
    },
    customer: {
      firstName: { type: String, required: true },
      lastName: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String }
    },
    shippingAddress: {
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      postalCode: { type: String, required: true },
      country: { type: String, required: true }
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
        time: { type: Date, default: Date.now }
      }
    ]
  },
  {
    timestamps: true
  }
);

orderSchema.index({ user: 1, createdAt: -1 });

export const Order = mongoose.model<IOrder>("Order", orderSchema);
