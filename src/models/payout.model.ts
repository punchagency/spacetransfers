import mongoose, { Document, Schema } from "mongoose";

export type PayoutStatus = "pending" | "processing" | "paid" | "failed" | "cancelled";

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
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const payoutSchema = new Schema<IPayout>(
  {
    printerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    stripeTransferId: { type: String, default: null },
    stripePayoutId: { type: String, default: null },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "usd" },
    status: {
      type: String,
      enum: ["pending", "processing", "paid", "failed", "cancelled"],
      default: "pending",
      index: true,
    },
    scheduledDate: { type: Date, required: true },
    processedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    retryCount: { type: Number, default: 0 },
    orderIds: [{ type: Schema.Types.ObjectId, ref: "Order" }],
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

payoutSchema.index({ printerId: 1, status: 1 });
payoutSchema.index({ scheduledDate: 1, status: 1 });

export const Payout = mongoose.model<IPayout>("Payout", payoutSchema);
