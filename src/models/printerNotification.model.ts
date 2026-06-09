import mongoose, { Document, Schema } from "mongoose";

export type PrinterNotificationCategory = "jobs" | "orders" | "system";
export type PrinterNotificationPriority = "high" | "medium" | "low";

export interface IPrinterNotification extends Document {
  printerId: mongoose.Types.ObjectId;
  category: PrinterNotificationCategory;
  priority: PrinterNotificationPriority;
  title: string;
  message: string;
  meta?: any;
  readAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const printerNotificationSchema = new Schema<IPrinterNotification>(
  {
    printerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    category: { type: String, enum: ["jobs", "orders", "system"], required: true, index: true },
    priority: { type: String, enum: ["high", "medium", "low"], required: true, index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    meta: { type: Schema.Types.Mixed, default: null },
    readAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

printerNotificationSchema.index({ printerId: 1, createdAt: -1, _id: -1 });
printerNotificationSchema.index({ printerId: 1, readAt: 1, createdAt: -1, _id: -1 });

export const PrinterNotification = mongoose.model<IPrinterNotification>(
  "PrinterNotification",
  printerNotificationSchema
);
