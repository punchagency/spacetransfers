import mongoose, { Document, Schema } from "mongoose";

/**
 * A problem a customer reported with an order.
 *
 * It belongs to the admin: the customer raises it, the admin talks to the
 * customer and, separately, to the partner who printed the order, then settles
 * it with a refund, a free reprint, or an explanation. The two conversations
 * are kept apart, so a partner never reads what the customer wrote and the
 * customer never reads what the partner wrote.
 */
export const ISSUE_TYPES = ["NOT_RECEIVED", "DAMAGED", "NEEDS_REPRINT", "OTHER"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
export type IssueStatus = "OPEN" | "RESOLVED";
export type IssueOutcome = "REFUND" | "REPRINT" | "NONE";
export type IssueChannel = "CUSTOMER" | "PARTNER";
export type IssueAuthor = "CUSTOMER" | "ADMIN" | "PARTNER";

/** A photo the customer sent to show what went wrong. */
export interface IOrderIssueAttachment {
  url: string;
  name: string;
}

export interface IOrderIssueMessage {
  _id?: mongoose.Types.ObjectId;
  channel: IssueChannel;
  author: IssueAuthor;
  authorName: string;
  body: string;
  attachments?: IOrderIssueAttachment[];
  at: Date;
}

export interface IOrderIssue extends Document {
  order: mongoose.Types.ObjectId;
  displayId: string;
  user: mongoose.Types.ObjectId;
  /** The partner the order was with when the problem was reported. */
  partner?: mongoose.Types.ObjectId | null;
  type: IssueType;
  /** The designs the customer marked as affected, by sheet and place on it. */
  affectedDesigns?: { sheet: number; design: number }[];
  description: string;
  attachments?: IOrderIssueAttachment[];
  status: IssueStatus;
  messages: IOrderIssueMessage[];
  /** The customer or the partner wrote last, so the admin has something to read. */
  needsAdmin: boolean;
  /** The admin wrote to the customer and they have not opened it yet. */
  customerUnread: boolean;
  resolution?: {
    outcome: IssueOutcome;
    note: string;
    refundAmount?: number;
    reprintOrderId?: string;
    reprintDisplayId?: string;
    at: Date;
    byId: string;
    byName: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const attachmentSchema = { _id: false, url: { type: String, required: true }, name: { type: String, default: "" } };

const orderIssueSchema = new Schema<IOrderIssue>(
  {
    order: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    displayId: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    partner: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    type: { type: String, enum: ISSUE_TYPES, required: true },
    description: { type: String, default: "" },
    attachments: { type: [attachmentSchema], default: undefined },
    affectedDesigns: { type: [{ _id: false, sheet: { type: Number, required: true }, design: { type: Number, required: true } }], default: undefined },
    status: { type: String, enum: ["OPEN", "RESOLVED"], default: "OPEN", index: true },
    messages: [
      {
        channel: { type: String, enum: ["CUSTOMER", "PARTNER"], required: true },
        author: { type: String, enum: ["CUSTOMER", "ADMIN", "PARTNER"], required: true },
        authorName: { type: String, default: "" },
        // Empty when the message is only photos.
        body: { type: String, default: "" },
        attachments: { type: [attachmentSchema], default: undefined },
        at: { type: Date, required: true },
      },
    ],
    needsAdmin: { type: Boolean, default: true },
    customerUnread: { type: Boolean, default: false },
    resolution: {
      type: {
        _id: false,
        outcome: { type: String, enum: ["REFUND", "REPRINT", "NONE"] },
        note: String,
        refundAmount: Number,
        reprintOrderId: String,
        reprintDisplayId: String,
        at: Date,
        byId: String,
        byName: String,
      },
      default: undefined,
    },
  },
  { timestamps: true },
);

orderIssueSchema.index({ status: 1, updatedAt: -1 });

export const OrderIssue = mongoose.model<IOrderIssue>("OrderIssue", orderIssueSchema);
