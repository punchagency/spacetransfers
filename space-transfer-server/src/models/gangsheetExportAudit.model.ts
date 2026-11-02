import mongoose, { Document, Schema } from "mongoose";

export type GangsheetExportAuditAction = "export_created" | "drive_uploaded" | "drive_failed" | "downloaded";

export interface IGangsheetExportAudit extends Document {
  exportId: mongoose.Types.ObjectId;
  jobId: mongoose.Types.ObjectId;
  printerId: mongoose.Types.ObjectId;
  action: GangsheetExportAuditAction;
  meta?: any;
  createdAt: Date;
  updatedAt: Date;
}

const gangsheetExportAuditSchema = new Schema<IGangsheetExportAudit>(
  {
    exportId: { type: Schema.Types.ObjectId, ref: "GangsheetExport", required: true, index: true },
    jobId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    printerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    action: { type: String, enum: ["export_created", "drive_uploaded", "drive_failed", "downloaded"], required: true, index: true },
    meta: { type: Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

gangsheetExportAuditSchema.index({ printerId: 1, createdAt: -1, _id: -1 });
gangsheetExportAuditSchema.index({ exportId: 1, createdAt: -1, _id: -1 });

export const GangsheetExportAudit = mongoose.model<IGangsheetExportAudit>(
  "GangsheetExportAudit",
  gangsheetExportAuditSchema
);

