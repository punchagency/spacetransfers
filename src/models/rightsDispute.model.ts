import mongoose, { Document, Schema } from "mongoose";
import { findingSchema, type RightsFinding } from "./rightsScreen.model.js";

/**
 * A customer saying they have the rights to print an image the check stopped,
 * and the conversation with Space Transfers until an admin decides.
 *
 * An approval names the findings it covers ("logo:nike") and holds only for
 * this customer: their licence for a brand clears that brand in any of their
 * images, never anyone else's. Every decision records who made it, when, why,
 * and the evidence it rested on.
 */
export type DisputeStatus = "open" | "approved" | "rejected" | "withdrawn";

export interface DisputeMessage {
  author: "CUSTOMER" | "ADMIN";
  authorName: string;
  body: string;
  attachments: { url: string; name: string }[];
  at: Date;
}

export interface IRightsDispute extends Document {
  user: mongoose.Types.ObjectId;
  screen: mongoose.Types.ObjectId;
  imageUrl: string;
  imageName?: string;
  /** The findings as they stood when the dispute was opened. */
  findings: RightsFinding[];
  status: DisputeStatus;
  messages: DisputeMessage[];
  /** Set when the customer is waiting on Space Transfers, cleared when an admin replies. */
  awaitingAdmin: boolean;
  decision?: {
    byId: mongoose.Types.ObjectId;
    byName: string;
    at: Date;
    note: string;
    approvedFindings: string[];
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const attachmentSchema = new Schema({ url: { type: String, required: true }, name: { type: String, default: "" } }, { _id: false });

const messageSchema = new Schema<DisputeMessage>(
  {
    author: { type: String, enum: ["CUSTOMER", "ADMIN"], required: true },
    authorName: { type: String, default: "" },
    body: { type: String, required: true },
    attachments: { type: [attachmentSchema], default: [] },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const rightsDisputeSchema = new Schema<IRightsDispute>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    screen: { type: Schema.Types.ObjectId, ref: "RightsScreen", required: true },
    imageUrl: { type: String, required: true },
    imageName: { type: String },
    findings: { type: [findingSchema], default: [] },
    status: { type: String, enum: ["open", "approved", "rejected", "withdrawn"], default: "open", index: true },
    messages: { type: [messageSchema], default: [] },
    awaitingAdmin: { type: Boolean, default: true },
    decision: {
      type: {
        _id: false,
        byId: { type: Schema.Types.ObjectId, ref: "User" },
        byName: String,
        at: Date,
        note: String,
        approvedFindings: [String],
      },
      default: null,
    },
  },
  { timestamps: true },
);

rightsDisputeSchema.index({ user: 1, screen: 1 });
rightsDisputeSchema.index({ status: 1, updatedAt: -1 });

export const RightsDispute = mongoose.model<IRightsDispute>("RightsDispute", rightsDisputeSchema);
