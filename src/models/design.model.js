import mongoose from "mongoose";

const designItemSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true
  },
  assetId: {
    type: String,
    required: true
  },
  widthIn: {
    type: Number,
    required: true
  },
  heightIn: {
    type: Number,
    required: true
  },
  posX: {
    type: Number,
    required: true
  },
  posY: {
    type: Number,
    required: true
  },
  rotation: {
    type: Number,
    default: 0
  },
  copies: {
    type: Number,
    default: 1
  },
  linked: {
    type: Boolean,
    default: false
  }
});

const designSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    thumbnail: {
      type: String, // Base64 string or URL
      required: true
    },
    size: {
      widthIn: {
        type: Number,
        required: true
      },
      heightIn: {
        type: Number,
        required: true
      }
    },
    pricing: {
      areaSqFt: {
        type: Number,
        required: true
      },
      price: {
        type: Number,
        required: true
      }
    },
    artboardData: {
      items: [designItemSchema]
    }
  },
  {
    timestamps: true
  }
);

designSchema.index({ user: 1, updatedAt: -1 });

export const Design = mongoose.model("Design", designSchema);
