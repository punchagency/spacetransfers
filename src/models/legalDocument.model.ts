import mongoose, { Document, Schema } from "mongoose";

/**
 * One version of a legal document, or the draft an admin is working on.
 *
 * Published versions are never changed or removed: an acceptance record names
 * a version, and that version's text must still exist when someone asks what
 * was agreed to. Each document has at most one draft.
 */
export interface ILegalDocument extends Document {
  docId: "terms" | "privacy" | "content-policy";
  status: "published" | "draft";
  title: string;
  /** Set on published versions: the date it took effect, "2026-10-16" (".2" for a second that day). */
  version?: string;
  /** The wording is still a draft for counsel, and the page says so. */
  isDraft: boolean;
  body: string;
  /** What changed, for the history. */
  note?: string;
  byId?: string;
  byName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const legalDocumentSchema = new Schema<ILegalDocument>(
  {
    docId: { type: String, enum: ["terms", "privacy", "content-policy"], required: true },
    status: { type: String, enum: ["published", "draft"], required: true },
    title: { type: String, required: true },
    version: { type: String },
    isDraft: { type: Boolean, default: false },
    body: { type: String, required: true },
    note: { type: String, default: "" },
    byId: { type: String },
    byName: { type: String },
  },
  { timestamps: true },
);

legalDocumentSchema.index(
  { docId: 1, version: 1 },
  { unique: true, partialFilterExpression: { status: "published" }, name: "unique_published_version" },
);
legalDocumentSchema.index(
  { docId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "draft" }, name: "one_draft_per_document" },
);

export const LegalDocumentModel = mongoose.model<ILegalDocument>("LegalDocument", legalDocumentSchema);
