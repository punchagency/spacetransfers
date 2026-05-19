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
    }
  },
  {
    timestamps: true
  }
);

assetSchema.index({ user: 1, _id: -1 });
assetSchema.index({ user: 1, contentHash: 1 });

export const Asset = mongoose.model<IAsset>("Asset", assetSchema);
