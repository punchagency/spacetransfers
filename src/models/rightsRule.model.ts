import mongoose, { Document, Schema } from "mongoose";

/**
 * Admin-kept rules the check applies on top of the automatic ones: an image
 * blocked for everyone (matched by its perceptual hash, so a resized or
 * re-saved copy is caught too), or a name to watch for in an image's text and
 * in what the detectors recognise.
 */
export interface IRightsRule extends Document {
  kind: "image" | "term";
  dhash?: string;
  imageUrl?: string;
  term?: string;
  note: string;
  addedById?: mongoose.Types.ObjectId | null;
  addedByName: string;
  /** The dispute whose rejection added it, when one did. */
  dispute?: mongoose.Types.ObjectId | null;
  createdAt: Date;
}

const rightsRuleSchema = new Schema<IRightsRule>(
  {
    kind: { type: String, enum: ["image", "term"], required: true, index: true },
    dhash: { type: String },
    imageUrl: { type: String },
    term: { type: String },
    note: { type: String, default: "" },
    addedById: { type: Schema.Types.ObjectId, ref: "User", default: null },
    addedByName: { type: String, default: "" },
    dispute: { type: Schema.Types.ObjectId, ref: "RightsDispute", default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const RightsRule = mongoose.model<IRightsRule>("RightsRule", rightsRuleSchema);
