import express from "express";
import { authenticate, requireAdminPasskey, requireRoles } from "../middleware/auth.js";
import { UserRoles } from "../models/user.model.js";
import {
  createStripeConnectAccount,
  getStripeConnectStatus,
  getPrinterPayoutSummary,
  getPrinterPayoutHistory,
  exportPrinterPayouts,
  adminListPayouts,
  adminGetPayoutStats,
  adminRetryPayout,
  adminTogglePrinterPayouts,
  adminListPrinterPayoutStatus,
  adminExportPayouts,
  adminGetPrinterEligibleJobs,
  adminCreatePayout,
  adminGetPayoutJobs,
  adminApprovePayout,
  adminRejectPayout,
  adminProcessPayout,
  handleStripeWebhook,
} from "../controllers/payout.controller.js";

const router = express.Router();

// Stripe webhook — raw body required, no auth
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

// ── Printer routes ──
router.post(
  "/printer/connect",
  authenticate,
  requireRoles(UserRoles.PRINTER),
  createStripeConnectAccount
);
router.get(
  "/printer/connect/status",
  authenticate,
  requireRoles(UserRoles.PRINTER),
  getStripeConnectStatus
);
router.get(
  "/printer/summary",
  authenticate,
  requireRoles(UserRoles.PRINTER),
  getPrinterPayoutSummary
);
router.get(
  "/printer/history",
  authenticate,
  requireRoles(UserRoles.PRINTER),
  getPrinterPayoutHistory
);
router.get(
  "/printer/export",
  authenticate,
  requireRoles(UserRoles.PRINTER),
  exportPrinterPayouts
);

// ── Admin routes ──
router.get(
  "/admin/list",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  requireAdminPasskey,
  adminListPayouts
);
router.get(
  "/admin/stats",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  requireAdminPasskey,
  adminGetPayoutStats
);
router.get(
  "/admin/printers",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  requireAdminPasskey,
  adminListPrinterPayoutStatus
);
router.get(
  "/admin/printers/:printerId/eligible",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  requireAdminPasskey,
  adminGetPrinterEligibleJobs
);
router.post(
  "/admin/create",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  requireAdminPasskey,
  adminCreatePayout
);
router.get(
  "/admin/:payoutId/jobs",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  requireAdminPasskey,
  adminGetPayoutJobs
);
router.post(
  "/admin/:payoutId/approve",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  requireAdminPasskey,
  adminApprovePayout
);
router.post(
  "/admin/:payoutId/reject",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  requireAdminPasskey,
  adminRejectPayout
);
router.post(
  "/admin/:payoutId/process",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  requireAdminPasskey,
  adminProcessPayout
);
router.post(
  "/admin/retry/:payoutId",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  requireAdminPasskey,
  adminRetryPayout
);
router.patch(
  "/admin/printers/:printerId/toggle",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  requireAdminPasskey,
  adminTogglePrinterPayouts
);
router.get(
  "/admin/export",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  requireAdminPasskey,
  adminExportPayouts
);

export default router;
