import express from "express";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { UserRoles } from "../models/user.model.js";
import { listOrders, assignOrder, updateOrderStatus, setOrderTracking, downloadOrderInvoice, getOrderById, getOrderTimeline, getOrderFinancials, adjustOrderFinancials, listPartners, getPartnerById, getPartnerOrders, getPartnerPricing, updatePartnerPricing, getPartnerSettings, updatePartnerSettings, createPartner, updatePartner, getEarningsSummary, getAdminDashboardStats, getRevenueChart, exportOrders } from "../controllers/admin.controller.js";

const router = express.Router();

router.use(authenticate, requireRoles(UserRoles.ADMIN));

router.get("/dashboard/stats", getAdminDashboardStats);
router.get("/earnings/revenue-chart", getRevenueChart);
router.get("/orders/export", exportOrders);
router.get("/orders", listOrders);
router.get("/orders/:orderId", getOrderById);
router.post("/orders/:orderId/assign", assignOrder);
router.patch("/orders/:orderId/status", updateOrderStatus);
router.patch("/orders/:orderId/tracking", setOrderTracking);
router.get("/orders/:orderId/invoice", downloadOrderInvoice);
router.get("/orders/:orderId/timeline", getOrderTimeline);
router.get("/orders/:orderId/financials", getOrderFinancials);
router.patch("/orders/:orderId/financials", adjustOrderFinancials);
router.get("/partners", listPartners);
router.post("/partners", createPartner);
router.get("/partners/:partnerId", getPartnerById);
router.get("/partners/:partnerId/orders", getPartnerOrders);
router.get("/partners/:partnerId/pricing", getPartnerPricing);
router.patch("/partners/:partnerId/pricing", updatePartnerPricing);
router.get("/partners/:partnerId/settings", getPartnerSettings);
router.patch("/partners/:partnerId/settings", updatePartnerSettings);
router.patch("/partners/:partnerId", updatePartner);
router.get("/earnings/summary", getEarningsSummary);  

export default router;
 