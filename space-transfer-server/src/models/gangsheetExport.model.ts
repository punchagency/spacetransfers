import mongoose, { Document, Schema } from "mongoose";

export type GangsheetExportFormat = "png" | "zip";

export interface IGangsheetExport extends Document {
  jobId: mongoose.Types.ObjectId;
  printerId: mongoose.Types.ObjectId;
  format: GangsheetExportFormat;
  dpi: number;
  sheet: { widthIn: number; heightIn: number };
  fileName: string;
  filePath: string;
  byteSize: number;
  validation: {
    ok: boolean;
    errors: string[];
    meta?: any;
  };
  drive?: {
    status: "skipped" | "uploaded" | "failed";
    fileId?: string | null;
    webViewLink?: string | null;
    error?: string | null;
    uploadedAt?: Date | null;
  };
  createdAt: Date;
  updatedAt: Date;
}

const gangsheetExportSchema = new Schema<IGangsheetExport>(
  {
    jobId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    printerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    format: { type: String, enum: ["png", "zip"], required: true },
    dpi: { type: Number, required: true },
    sheet: {
      widthIn: { type: Number, required: true },
      heightIn: { type: Number, required: true }
    },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    byteSize: { type: Number, required: true },
    validation: {
      ok: { type: Boolean, required: true, index: true },
      errors: [{ type: String, required: true }],
      meta: { type: Schema.Types.Mixed, default: null }
    },
    drive: {
      status: { type: String, enum: ["skipped", "uploaded", "failed"], default: "skipped" },
      fileId: { type: String, default: null },
      webViewLink: { type: String, default: null },
      error: { type: String, default: null },
      uploadedAt: { type: Date, default: null }
    }
  },
  { timestamps: true }
);

gangsheetExportSchema.index({ printerId: 1, createdAt: -1, _id: -1 });
gangsheetExportSchema.index({ jobId: 1, printerId: 1, createdAt: -1, _id: -1 });

export const GangsheetExport = mongoose.model<IGangsheetExport>(
  "GangsheetExport",
  gangsheetExportSchema
);

