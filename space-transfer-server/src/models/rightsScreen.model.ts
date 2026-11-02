import mongoose, { Document, Schema } from "mongoose";

/**
 * What the rights check found in one image: a property of the bytes, so it is
 * shared by every customer who uploads the same picture and never paid for
 * twice. Whether a finding stops a customer depends on their own approvals
 * (see RightsDispute), never on this record.
 */
export type FindingSeverity = "block" | "review" | "info";
export type FindingKind = "logo" | "character" | "brand" | "team" | "artwork" | "stock" | "text" | "known_image" | "metadata";
export type FindingSource = "vision" | "claude" | "metadata" | "blocklist" | "terms";

export interface RightsFinding {
  /** Stable across images, e.g. "logo:nike": what an approval refers to. */
  id: string;
  kind: FindingKind;
  /** For people, e.g. "Nike logo". */
  label: string;
  severity: FindingSeverity;
  sources: FindingSource[];
  score?: number;
  detail?: string;
}

export interface IRightsScreen extends Document {
  /** sha256 of the stored bytes. */
  key: string;
  /** Every address these bytes were stored at. */
  urls: string[];
  /** Perceptual hash, for matching the same picture re-encoded or resized. */
  dhash?: string;
  findings: RightsFinding[];
  /** Text read from the image and names the detectors recognised, matched against the watch list when judged. */
  observedText: string;
  /** Which checks ran; one that was switched off or failed is missing. */
  checks: string[];
  /** Checks that were configured but failed, so a later pass can try again. */
  failed: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const findingSchema = new Schema<RightsFinding>(
  {
    id: { type: String, required: true },
    kind: { type: String, required: true },
    label: { type: String, required: true },
    severity: { type: String, enum: ["block", "review", "info"], required: true },
    sources: { type: [String], default: [] },
    score: { type: Number },
    detail: { type: String },
  },
  { _id: false },
);

const rightsScreenSchema = new Schema<IRightsScreen>(
  {
    key: { type: String, required: true, unique: true },
    urls: { type: [String], default: [], index: true },
    dhash: { type: String },
    findings: { type: [findingSchema], default: [] },
    observedText: { type: String, default: "" },
    checks: { type: [String], default: [] },
    failed: { type: [String], default: [] },
    version: { type: Number, default: 1 },
  },
  { timestamps: true },
);

export const RightsScreen = mongoose.model<IRightsScreen>("RightsScreen", rightsScreenSchema);
