import mongoose from "mongoose";

const settingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

export const Settings = mongoose.model("Settings", settingsSchema);
