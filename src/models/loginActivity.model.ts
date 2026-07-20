import mongoose, { Document, Schema } from "mongoose";

export type LoginActivityStatus = "success" | "failed";

export interface ILoginActivity extends Document {
  userId: mongoose.Types.ObjectId;
  device: string;
  ip: string;
  location: string;
  status: LoginActivityStatus;
  userAgent: string;
  createdAt: Date;
  updatedAt: Date;
}

const loginActivitySchema = new Schema<ILoginActivity>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    device: { type: String, default: "Unknown device" },
    ip: { type: String, default: "" },
    location: { type: String, default: "Unknown" },
    status: { type: String, enum: ["success", "failed"], required: true, index: true },
    userAgent: { type: String, default: "" }
  },
  { timestamps: true }
);

// Newest-first lookups scoped to a user.
loginActivitySchema.index({ userId: 1, createdAt: -1, _id: -1 });

export const LoginActivity = mongoose.model<ILoginActivity>(
  "LoginActivity",
  loginActivitySchema
);
