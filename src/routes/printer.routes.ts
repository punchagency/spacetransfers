import express from "express";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { UserRoles } from "../models/user.model.js";
import {
  listPrintQueue,
  listPrinterOrders,
  getDashboardStats,
  getJobDetails,
  getJobCustomerInfo,
  getPrinterJobOverview,
  updateJobNotes,
  updateJobSpecs,
  executeJobAction,
  getJobAssets,
  createJobAssetBundle,
  downloadJobAssetBundle,
  exportJobGangsheet,
  getExportJobStatus,
  getJobGangsheetPreview,
  downloadGangsheetExport,
  exportPngForDownload,
  getPrinterOrdersSummary,
  updatePrinterOrderStatus,
  cancelPrinterOrder,
  createJobShippingLabel,
  reprintShippingLabel,
  updateJobTracking,
  getOrderSummary,
  listEarningsJobs,
  exportEarningsCsv,
  getPrinterProfile,
  updatePrinterProfile,
  getPrinterSettings,
  updatePrinterSettings,
  uploadProfileAsset,
  requestEmailVerification,
  listPrinterNotifications,
  streamPrinterNotifications,
  setPrinterNotificationRead,
  markAllPrinterNotificationsRead,
  getAvailabilityStatus,
  updateAvailabilityStatus,
} from "../controllers/printer.controller.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

router.use(authenticate, requireRoles(UserRoles.PRINTER));

router.get("/dashboard/stats", getDashboardStats);
router.get("/print-queue", listPrintQueue);
router.get("/profile", getPrinterProfile);
router.patch("/profile", updatePrinterProfile);
router.post("/profile/upload", upload.single("file"), uploadProfileAsset);
router.post("/profile/verify-email", requestEmailVerification);
router.get("/settings", getPrinterSettings);
router.patch("/settings", updatePrinterSettings);
router.get("/jobs/:jobId", getJobDetails);
router.get("/jobs/:jobId/overview", getPrinterJobOverview);
router.get("/jobs/:jobId/customer", getJobCustomerInfo);
router.get("/jobs/:jobId/assets", getJobAssets);
router.get("/jobs/:jobId/gangsheet/preview", getJobGangsheetPreview);
router.post("/jobs/:jobId/assets/bundle", createJobAssetBundle);
router.get("/jobs/:jobId/assets/bundle/download", downloadJobAssetBundle);
router.post("/jobs/:jobId/gangsheet/export", exportJobGangsheet);
router.post("/jobs/:jobId/gangsheet/png-export", exportPngForDownload);
router.get("/jobs/export-status/:exportJobId", getExportJobStatus);
router.get("/exports/:exportId/file", downloadGangsheetExport);
router.get("/orders/summary", getPrinterOrdersSummary);
router.patch("/orders/:orderId/status", updatePrinterOrderStatus);
router.post("/orders/:orderId/cancel", cancelPrinterOrder);
router.post("/jobs/:jobId/label", createJobShippingLabel);
router.get("/jobs/:jobId/label", reprintShippingLabel);
router.patch("/jobs/:jobId/notes", updateJobNotes);
router.patch("/jobs/:jobId/specs", updateJobSpecs);
router.patch("/jobs/:jobId/tracking", updateJobTracking);
router.post("/jobs/:jobId/actions", executeJobAction);
router.get("/orders", listPrinterOrders);
router.get("/orders/:orderId", getOrderSummary);
router.get("/earnings/jobs", listEarningsJobs);
router.get("/earnings/export", exportEarningsCsv);

router.get("/availability", getAvailabilityStatus);
router.patch("/availability", updateAvailabilityStatus);

router.get("/notifications", listPrinterNotifications);
router.get("/notifications/stream", streamPrinterNotifications);
router.patch("/notifications/:id/read", setPrinterNotificationRead);
router.post("/notifications/mark-all-read", markAllPrinterNotificationsRead);

export default router;
