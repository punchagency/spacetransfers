import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
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
      type: Number,
      required: true
    }
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
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
      subtotal: { type: Number, required: true },
      shippingCost: { type: Number, required: true },
      tax: { type: Number, required: true },
      total: { type: Number, required: true },
      currency: { type: String, required: true }
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK", "SHIPPED", "COMPLETED", "CANCELLED", "REJECTED", "PAUSED"],
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
    trackingEvents: [
      {
        time: { type: Date, required: true },
        location: { type: String, required: true },
        description: { type: String, required: true }
      }
    ],
    assignedPrinter: {
      type: mongoose.Schema.Types.ObjectId,
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
        time: { type: Date, default: Date.now }
      }
    ]
  },
  {
    timestamps: true
  }
);

orderSchema.index({ user: 1, createdAt: -1 });

export const Order = mongoose.model("Order", orderSchema);

