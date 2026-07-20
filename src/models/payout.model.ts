import mongoose, { Document, Schema } from "mongoose";

/**
 * Payout lifecycle:
 *   pending_review → approved → processing → paid
 *                 ↘ rejected            ↘ failed (retryable)
 *
 * A payout is NEVER paid automatically — it must be explicitly approved by an
 * admin, and payment is only initiated by an explicit admin action after that.
 * The `pending`/`cancelled` values are retained in the enum for legacy records.
 */
export type PayoutStatus =
  | "pending_review"
  | "approved"
  | "processing"
  | "paid"
  | "rejected"
  | "failed"
  | "pending" // legacy
  | "cancelled"; // legacy

export interface IPayoutStatusEvent {
  status: PayoutStatus;
  at: Date;
  changedBy?: mongoose.Types.ObjectId | null;
  changedByName?: string | null;
  note?: string | null;
}

export interface IPayoutLineItem {
  orderId: mongoose.Types.ObjectId;
  displayId?: string | null;
  orderNumber?: string | null;
  customerName?: string | null;
  jobStatus?: string | null;
  completedAt?: Date | null;
  amount: number;
}

export interface IPayout extends Document {
  printerId: mongoose.Types.ObjectId;
  stripeTransferId?: string | null;
  stripePayoutId?: string | null;
  amount: number;
  currency: string;
  status: PayoutStatus;
  scheduledDate: Date;
  processedAt?: Date | null;
  failureReason?: string | null;
  retryCount: number;
  orderIds: mongoose.Types.ObjectId[];
  lineItems: IPayoutLineItem[];
  statusHistory: IPayoutStatusEvent[];
  createdByName?: string | null;
  approvedBy?: mongoose.Types.ObjectId | null;
  approvedByName?: string | null;
  approvedAt?: Date | null;
  rejectedBy?: mongoose.Types.ObjectId | null;
  rejectedByName?: string | null;
  rejectedAt?: Date | null;
  rejectionReason?: string | null;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const statusEventSchema = new Schema<IPayoutStatusEvent>(
  {
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    changedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    changedByName: { type: String, default: null },
    note: { type: String, default: null },
  },
  { _id: false },
);

const lineItemSchema = new Schema<IPayoutLineItem>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    displayId: { type: String, default: null },
    orderNumber: { type: String, default: null },
    customerName: { type: String, default: null },
    jobStatus: { type: String, default: null },
    completedAt: { type: Date, default: null },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const payoutSchema = new Schema<IPayout>(
  {
    printerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    stripeTransferId: { type: String, default: null },
    stripePayoutId: { type: String, default: null },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "usd" },
    status: {
      type: String,
      enum: [
        "pending_review",
        "approved",
        "processing",
        "paid",
        "rejected",
        "failed",
        "pending",
        "cancelled",
      ],
      default: "pending_review",
      index: true,
    },
    scheduledDate: { type: Date, required: true },
    processedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    retryCount: { type: Number, default: 0 },
    orderIds: [{ type: Schema.Types.ObjectId, ref: "Order" }],
    lineItems: { type: [lineItemSchema], default: [] },
    statusHistory: { type: [statusEventSchema], default: [] },
    createdByName: { type: String, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedByName: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    rejectedByName: { type: String, default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

payoutSchema.index({ printerId: 1, status: 1 });
payoutSchema.index({ scheduledDate: 1, status: 1 });

export const Payout = mongoose.model<IPayout>("Payout", payoutSchema);
