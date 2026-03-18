import mongoose, { Document, Schema } from "mongoose";

export interface IDesignItem {
  id: number;
  assetId: string;
  widthIn: number;
  heightIn: number;
  posX: number;
  posY: number;
  rotation: number;
  copies: number;
  linked: boolean;
}

export interface IDesign extends Document {
  user: mongoose.Types.ObjectId;
  title: string;
  thumbnail: string;
  size: {
    widthIn: number;
    heightIn: number;
  };
  pricing: {
    areaSqFt: number;
    price: number;
  };
  artboardData: {
    items: IDesignItem[];
  };
  createdAt: Date;
  updatedAt: Date;
}

const designItemSchema = new Schema<IDesignItem>({
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

const designSchema = new Schema<IDesign>(
  {
    user: {
      type: Schema.Types.ObjectId,
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

export const Design = mongoose.model<IDesign>("Design", designSchema);
