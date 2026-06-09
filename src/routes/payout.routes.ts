import express from "express";
import { authenticate, requireRoles } from "../middleware/auth.js";
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
  adminListPayouts
);
router.get(
  "/admin/stats",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  adminGetPayoutStats
);
router.get(
  "/admin/printers",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  adminListPrinterPayoutStatus
);
router.post(
  "/admin/retry/:payoutId",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  adminRetryPayout
);
router.patch(
  "/admin/printers/:printerId/toggle",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  adminTogglePrinterPayouts
);
router.get(
  "/admin/export",
  authenticate,
  requireRoles(UserRoles.ADMIN),
  adminExportPayouts
);

export default router;
