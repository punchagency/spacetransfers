import express from "express";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { UserRoles } from "../models/user.model.js";
import { listOrders, getOrderById, listPartners, updatePartner, getEarningsSummary } from "../controllers/admin.controller.js";

const router = express.Router();

router.use(authenticate, requireRoles(UserRoles.ADMIN));

router.get("/orders", listOrders);
router.get("/orders/:orderId", getOrderById);
router.get("/partners", listPartners);
router.patch("/partners/:partnerId", updatePartner);
router.get("/earnings/summary", getEarningsSummary);

export default router;

