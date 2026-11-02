import mongoose, { Document, Schema } from "mongoose";

export interface IAsset extends Document {
  user: mongoose.Types.ObjectId;
  url: string;
  trimmedUrl?: string;
  originalFilename: string;
  mimeType?: string;
  sizeBytes?: number;
  widthPx?: number;
  heightPx?: number;
  trimmedWidthPx?: number;
  trimmedHeightPx?: number;
  dpi?: number;
  contentHash?: string;
  /**
   * Cached fade verdict.
   *
   * Stored because it is a property of the bytes, not of the upload: assets are
   * de-duplicated by `contentHash`, so the same file uploaded again returns the
   * existing record without re-reading it. Without this the verdict would be
   * lost on every duplicate — and re-deriving it would mean an AI call for a
   * result that cannot have changed.
   */
  fade?: {
    hasFade: boolean;
    confidence: number;
    kind: string;
    reason: string;
    source: string;
    /** Rules version the verdict was reached under; older verdicts are recomputed. */
    version?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const assetSchema = new Schema<IAsset>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    url: {
      type: String,
      required: true
    },
    trimmedUrl: {
      type: String
    },
    originalFilename: {
      type: String,
      required: true
    },
    mimeType: {
      type: String
    },
    sizeBytes: {
      type: Number
    },
    widthPx: {
      type: Number
    },
    heightPx: {
      type: Number
    },
    trimmedWidthPx: {
      type: Number
    },
    trimmedHeightPx: {
      type: Number
    },
    dpi: {
      type: Number
    },
    contentHash: {
      type: String
    },
    // `_id: false` — this is a value object, not a sub-document; without it
    // Mongoose mints an ObjectId for every verdict for no purpose.
    fade: {
      type: new Schema(
        {
          hasFade: { type: Boolean, required: true },
          confidence: { type: Number, required: true },
          kind: { type: String, required: true },
          reason: { type: String },
          source: { type: String },
          version: { type: Number }
        },
        { _id: false }
      ),
      required: false
    }
  },
  {
    timestamps: true
  }
);

assetSchema.index({ user: 1, _id: -1 });
assetSchema.index({ user: 1, contentHash: 1 });

export const Asset = mongoose.model<IAsset>("Asset", assetSchema);
