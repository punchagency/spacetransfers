import mongoose, { Document, Schema } from "mongoose";

export type AdminNotificationCategory = "orders" | "partners" | "system";
export type AdminNotificationPriority = "high" | "medium" | "low";

export interface IAdminNotification extends Document {
  adminId: mongoose.Types.ObjectId;
  category: AdminNotificationCategory;
  priority: AdminNotificationPriority;
  title: string;
  message: string;
  meta?: any;
  readAt?: Date | null;
  email: {
    status: "queued" | "sent" | "failed" | "skipped";
    batchId?: mongoose.Types.ObjectId | null;
    attemptedAt?: Date | null;
    sentAt?: Date | null;
    error?: string | null;
    messageId?: string | null;
  };
  createdAt: Date;
  updatedAt: Date;
}

const adminNotificationSchema = new Schema<IAdminNotification>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    category: { type: String, enum: ["orders", "partners", "system"], required: true, index: true },
    priority: { type: String, enum: ["high", "medium", "low"], required: true, index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    meta: { type: Schema.Types.Mixed, default: null },
    readAt: { type: Date, default: null, index: true },
    email: {
      status: { type: String, enum: ["queued", "sent", "failed", "skipped"], default: "skipped", index: true },
      batchId: { type: Schema.Types.ObjectId, default: null },
      attemptedAt: { type: Date, default: null },
      sentAt: { type: Date, default: null },
      error: { type: String, default: null },
      messageId: { type: String, default: null }
    }
  },
  { timestamps: true }
);

adminNotificationSchema.index({ adminId: 1, createdAt: -1, _id: -1 });
adminNotificationSchema.index({ adminId: 1, readAt: 1, createdAt: -1, _id: -1 });

export const AdminNotification = mongoose.model<IAdminNotification>(
  "AdminNotification",
  adminNotificationSchema
);

