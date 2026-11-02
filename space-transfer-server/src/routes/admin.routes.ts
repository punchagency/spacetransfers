import express from "express";
import { authenticate, requireAdminPasskey, requireRoles } from "../middleware/auth.js";
import { listAdminPasskeyStatus, resetAccountPasskeys } from "../controllers/passkey.controller.js";
import {
  adminDiscardLegalDraft,
  adminGetLegalDocument,
  adminGetLegalVersion,
  adminListLegalDocuments,
  adminPublishLegalDocument,
  adminSaveLegalDraft,
} from "../controllers/legal.controller.js";
import { upload } from "../middleware/upload.js";
import { UserRoles } from "../models/user.model.js";
import * as rights from "../controllers/admin/rights.controller.js";
import { 
  listOrders, 
  assignOrder, 
  downloadOrderInvoice, 
  getOrderById, 
  getOrderGangsheetPreview,
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
  getGlobalPricing, 
  updateGlobalPricing, 
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
  updatePartnerAssignmentSettings,
  getAdminNotificationSettings,
  updateAdminNotificationSettings,
  cancelOrder,
  refundOrder,
  listIssues,
  getIssueCounts,
  listIssuesForOrder,
  postIssueMessage,
  resolveIssue,
  getOrderDesignsForAdmin,
} from "../controllers/admin/index.js";

const router = express.Router();

router.use(authenticate, requireRoles(UserRoles.ADMIN), requireAdminPasskey);

router.get("/security/admins", listAdminPasskeyStatus);
router.get("/rights/summary", rights.rightsSummary);
router.get("/rights/disputes", rights.listDisputes);
router.get("/rights/disputes/:disputeId", rights.getDispute);
router.post("/rights/disputes/:disputeId/messages", rights.replyToDispute);
router.post("/rights/disputes/:disputeId/approve", rights.approveDispute);
router.post("/rights/disputes/:disputeId/reject", rights.rejectDispute);
router.post("/rights/disputes/:disputeId/revoke", rights.revokeApproval);
router.get("/rights/rules", rights.listRules);
router.post("/rights/rules", rights.addTermRule);
router.delete("/rights/rules/:ruleId", rights.deleteRule);
router.get("/rights/concerns", rights.listConcerns);
router.post("/orders/:orderId/rights-concern/resolve", rights.resolveConcern);
router.get("/legal", adminListLegalDocuments);
router.get("/legal/:docId", adminGetLegalDocument);
router.put("/legal/:docId/draft", adminSaveLegalDraft);
router.delete("/legal/:docId/draft", adminDiscardLegalDraft);
router.post("/legal/:docId/publish", adminPublishLegalDocument);
router.get("/legal/:docId/versions/:version", adminGetLegalVersion);
router.post("/users/:userId/reset-passkeys", resetAccountPasskeys);

router.get("/dashboard/stats", getAdminDashboardStats);
router.get("/pricing/global", getGlobalPricing);
router.post("/pricing/global", updateGlobalPricing);
router.patch("/pricing/global", updateGlobalPricing);
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
router.get("/orders", listOrders);
router.get("/orders/:orderId", getOrderById);
router.get("/orders/:orderId/gangsheet/preview", getOrderGangsheetPreview);
router.post("/orders/:orderId/assign", assignOrder);
router.post("/orders/:orderId/cancel", cancelOrder);
router.post("/orders/:orderId/refund", refundOrder);
router.get("/orders/:orderId/issues", listIssuesForOrder);
router.get("/issues", listIssues);
router.get("/issues/counts", getIssueCounts);
router.post("/issues/:issueId/messages", postIssueMessage);
router.post("/issues/:issueId/resolve", resolveIssue);
router.get("/orders/:orderId/designs", getOrderDesignsForAdmin);
router.get("/orders/:orderId/invoice", downloadOrderInvoice);
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
