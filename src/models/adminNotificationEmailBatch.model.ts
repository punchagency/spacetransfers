import mongoose, { Document, Schema } from "mongoose";

export interface IAdminNotificationEmailBatch extends Document {
  adminId: mongoose.Types.ObjectId;
  notificationIds: mongoose.Types.ObjectId[];
  dueAt: Date;
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  lastAttemptAt?: Date | null;
  error?: string | null;
  messageId?: string | null;
  sentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const adminNotificationEmailBatchSchema = new Schema<IAdminNotificationEmailBatch>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    notificationIds: [{ type: Schema.Types.ObjectId, ref: "AdminNotification", required: true }],
    dueAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ["pending", "sending", "sent", "failed"], default: "pending", index: true },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    error: { type: String, default: null },
    messageId: { type: String, default: null },
    sentAt: { type: Date, default: null }
  },
  { timestamps: true }
);

adminNotificationEmailBatchSchema.index({ status: 1, dueAt: 1 });

export const AdminNotificationEmailBatch = mongoose.model<IAdminNotificationEmailBatch>(
  "AdminNotificationEmailBatch",
  adminNotificationEmailBatchSchema
);

