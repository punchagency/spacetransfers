import express from "express";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { UserRoles } from "../models/user.model.js";
import { createOrder, listOrders, getOrderById, uploadAsset } from "../controllers/customer.controller.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

router.use(authenticate, requireRoles(UserRoles.CUSTOMER));

router.post("/orders", createOrder);
router.get("/orders", listOrders);
router.get("/orders/:orderId", getOrderById);
router.post("/assets", upload.single("file"), uploadAsset);

export default router;

