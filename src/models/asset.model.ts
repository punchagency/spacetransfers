import mongoose, { Document, Schema } from "mongoose";

export interface IAsset extends Document {
  user: mongoose.Types.ObjectId;
  url: string;
  originalFilename: string;
  mimeType?: string;
  sizeBytes?: number;
  widthPx?: number;
  heightPx?: number;
  dpi?: number;
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
    dpi: {
      type: Number
    }
  },
  {
    timestamps: true
  }
);

// Index for pagination (cursor-based usually on _id or createdAt)
assetSchema.index({ user: 1, _id: -1 });

export const Asset = mongoose.model<IAsset>("Asset", assetSchema);
