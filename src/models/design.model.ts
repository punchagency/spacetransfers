import mongoose, { Document, Schema } from "mongoose";

export interface IDesignItem {
  id: number;
  assetId: string;
  /** The image the piece shows and prints, cropped or not. */
  croppedUrl?: string;
  /** The auto-crop switch's source, when an edit has replaced the upload. */
  uncroppedUrl?: string;
  autoCrop?: boolean;
  widthIn: number;
  heightIn: number;
  posX: number;
  posY: number;
  rotation: number;
  copies: number;
  linked: boolean;
  flipped?: boolean;
  /** 90 when auto-nest turned the piece to fit it. */
  nestRotation?: number;
  /** Columns auto-nest wrapped the copies into. */
  flowCols?: number;
  /** Placed by hand — auto-nest leaves it where it is. */
  pinned?: boolean;
  locked?: boolean;
  /** Pieces sharing a group id were bundled in the editor to act as one. */
  groupId?: string;
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
    /**
     * The sheet's own settings, so a reopened design lays out exactly as it was
     * saved. Absent on designs saved before they were recorded.
     */
    itemSpacingIn?: number;
    sheetMarginIn?: number;
    autoNest?: boolean;
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
  croppedUrl: {
    type: String
  },
  uncroppedUrl: {
    type: String
  },
  autoCrop: {
    type: Boolean,
    default: true
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
  },
  flipped: { type: Boolean, default: false },
  nestRotation: { type: Number, enum: [0, 90], default: 0 },
  flowCols: { type: Number, min: 1 },
  pinned: { type: Boolean, default: false },
  locked: { type: Boolean, default: false },
  groupId: { type: String }
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
      items: [designItemSchema],
      itemSpacingIn: { type: Number, min: 0, max: 6 },
      sheetMarginIn: { type: Number, min: 0, max: 2 },
      autoNest: { type: Boolean }
    }
  },
  {
    timestamps: true
  }
);

designSchema.index({ user: 1, updatedAt: -1 });

export const Design = mongoose.model<IDesign>("Design", designSchema);
