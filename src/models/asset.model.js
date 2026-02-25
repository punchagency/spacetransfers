import mongoose from "mongoose";

const assetSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
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

export const Asset = mongoose.model("Asset", assetSchema);
