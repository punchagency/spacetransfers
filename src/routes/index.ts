import express from "express";
import authRoutes from "./auth.routes.js";
import customerRoutes from "./customer.routes.js";
import printerRoutes from "./printer.routes.js";
import adminRoutes from "./admin.routes.js";
import orderRoutes from "./order.routes.js";
import healthRoutes from "./health.routes.js";
import publicRoutes from "./public.routes.js";
import payoutRoutes from "./payout.routes.js";
import geocodingRoutes from "./geocoding.routes.js";
import webhookRoutes from "./webhook.routes.js";

const router = express.Router();

router.use("/health", healthRoutes);
router.use("/public", publicRoutes);
router.use("/auth", authRoutes);
router.use("/geocode", geocodingRoutes);
router.use("/customer", customerRoutes);
router.use("/printer", printerRoutes);
router.use("/admin", adminRoutes);
router.use("/orders", orderRoutes);
router.use("/payouts", payoutRoutes);
router.use("/webhooks", webhookRoutes);

export default router;
