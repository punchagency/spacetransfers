import express from "express";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { UserRoles } from "../models/user.model.js";
import { createOrder, listOrders, getOrderById, uploadAsset, updateAccount, logout, listAssets } from "../controllers/customer.controller.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

router.use(authenticate, requireRoles(UserRoles.CUSTOMER));

router.patch("/account", updateAccount);
router.post("/account/logout", logout);
router.post("/orders", createOrder);
router.get("/orders", listOrders);
router.get("/orders/:orderId", getOrderById);
router.post("/assets", upload.single("file"), uploadAsset);
router.get("/assets", listAssets);

export default router;

