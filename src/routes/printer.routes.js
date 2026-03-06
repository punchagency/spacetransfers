import express from "express";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { UserRoles } from "../models/user.model.js";
import { listPrintQueue, updateJobStatus, listPrinterOrders, getPrinterEarnings, getDashboardStats, updateJobPriority, getJobDetails, getJobCustomerInfo, updateJobNotes, updateJobSpecs, executeJobAction, getJobAssets, createJobAssetBundle, exportJobGangsheet, getJobGangsheetPreview, createJobShippingLabel, updateJobTracking, getOrderSummary, getEarningsSummary, listEarningsJobs } from "../controllers/printer.controller.js";

const router = express.Router();

router.use(authenticate, requireRoles(UserRoles.PRINTER));

router.get("/dashboard/stats", getDashboardStats);
router.get("/print-queue", listPrintQueue);
router.get("/jobs/:jobId", getJobDetails);
router.get("/jobs/:jobId/customer", getJobCustomerInfo);
router.get("/jobs/:jobId/assets", getJobAssets);
router.get("/jobs/:jobId/gangsheet/preview", getJobGangsheetPreview);
router.post("/jobs/:jobId/assets/bundle", createJobAssetBundle);
router.post("/jobs/:jobId/gangsheet/export", exportJobGangsheet);
router.post("/jobs/:jobId/label", createJobShippingLabel);
router.patch("/jobs/:jobId/notes", updateJobNotes);
router.patch("/jobs/:jobId/specs", updateJobSpecs);
router.patch("/jobs/:jobId/tracking", updateJobTracking);
router.post("/jobs/:jobId/actions", executeJobAction);
router.patch("/print-queue/:jobId/status", updateJobStatus);
router.patch("/print-queue/:jobId/priority", updateJobPriority);
router.get("/orders", listPrinterOrders);
router.get("/orders/:orderId", getOrderSummary);
router.get("/earnings/jobs", listEarningsJobs);
router.get("/earnings/summary", getEarningsSummary);
router.get("/earnings", getPrinterEarnings);

export default router;

