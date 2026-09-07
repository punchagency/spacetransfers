import express from "express";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { UserRoles } from "../models/user.model.js";
import { 
  listOrders, 
  assignOrder, 
  updateOrderStatus, 
  setOrderTracking, 
  downloadOrderInvoice, 
  getOrderById, 
  getOrderGangsheetPreview,
  getOrderTimeline, 
  getOrderFinancials, 
  adjustOrderFinancials, 
  listPartners, 
  getPartnerById, 
  getPartnerOrders, 
  getPartnerSettings, 
  updatePartnerSettings, 
  updatePartnerStatus,
  updatePartnerAvailability, 
  createPartner, 
  updatePartner, 
  getEarningsSummary, 
  getAdminDashboardStats, 
  getRevenueChart, 
  exportOrders, 
  getGlobalPricing, 
  updateGlobalPricing, 
  getAdminNotificationSettings, 
  updateAdminNotificationSettings, 
  getAdminSecuritySettings,
  getAdminLoginActivity,
  getAdminProfile,
  updateAdminProfile,
  updateAdminPassword,
  uploadAdminAvatar,
  listAdminNotifications,
  setAdminNotificationRead,
  markAllAdminNotificationsRead,
  streamAdminNotifications,
  listPendingPrinters,
  approvePrinter,
  rejectPrinter,
  getPartnerAssignmentSettings,
  updatePartnerAssignmentSettings
} from "../controllers/admin.controller.js";

const router = express.Router();

router.use(authenticate, requireRoles(UserRoles.ADMIN));

router.get("/dashboard/stats", getAdminDashboardStats);
router.get("/earnings/revenue-chart", getRevenueChart);
router.get("/pricing/global", getGlobalPricing);
router.post("/pricing/global", updateGlobalPricing);
router.patch("/pricing/global", updateGlobalPricing);
router.get("/settings/notifications", getAdminNotificationSettings);
router.patch("/settings/notifications", updateAdminNotificationSettings);
router.get("/settings/security", getAdminSecuritySettings);
router.get("/security/login-activity", getAdminLoginActivity);
router.get("/settings/partner-assignment", getPartnerAssignmentSettings);
router.patch("/settings/partner-assignment", updatePartnerAssignmentSettings);
router.get("/profile", getAdminProfile);
router.patch("/profile", updateAdminProfile);
router.get("/profile/preferences", getAdminNotificationSettings);
router.patch("/profile/preferences", updateAdminNotificationSettings);
router.patch("/profile/password", updateAdminPassword);
router.post("/profile/upload", upload.single("file"), uploadAdminAvatar);
router.get("/notifications", listAdminNotifications);
router.get("/notifications/stream", streamAdminNotifications);
router.patch("/notifications/:id/read", setAdminNotificationRead);
router.post("/notifications/mark-all-read", markAllAdminNotificationsRead);
router.get("/orders/export", exportOrders);
router.get("/orders", listOrders);
router.get("/orders/:orderId", getOrderById);
router.get("/orders/:orderId/gangsheet/preview", getOrderGangsheetPreview);
router.post("/orders/:orderId/assign", assignOrder);
router.patch("/orders/:orderId/status", updateOrderStatus);
router.patch("/orders/:orderId/tracking", setOrderTracking);
router.get("/orders/:orderId/invoice", downloadOrderInvoice);
router.get("/orders/:orderId/timeline", getOrderTimeline);
router.get("/orders/:orderId/financials", getOrderFinancials);
router.patch("/orders/:orderId/financials", adjustOrderFinancials);
router.get("/partners", listPartners);
router.post("/partners", createPartner); 
router.get("/partners/pending", listPendingPrinters);
router.post("/partners/:partnerId/approve", approvePrinter);
router.post("/partners/:partnerId/reject", rejectPrinter);
router.get("/partners/:partnerId", getPartnerById);
router.get("/partners/:partnerId/orders", getPartnerOrders);
router.get("/partners/:partnerId/settings", getPartnerSettings);
router.patch("/partners/:partnerId/settings", updatePartnerSettings);
router.patch("/partners/:partnerId/status", updatePartnerStatus);
router.patch("/partners/:partnerId/availability", updatePartnerAvailability);
router.patch("/partners/:partnerId", updatePartner);
router.get("/earnings/summary", getEarningsSummary);  

export default router;
