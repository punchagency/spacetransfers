import mongoose, { Document, Schema } from "mongoose";

export interface ISettings extends Document {
  key: string;
  value: any;
  createdAt: Date;
  updatedAt: Date;
}

const settingsSchema = new Schema<ISettings>(
  {
    key: {
      type: String,
      required: true,
      unique: true
    },
    value: {
      type: Schema.Types.Mixed,
      required: true,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

export const Settings = mongoose.model<ISettings>("Settings", settingsSchema);
