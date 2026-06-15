import express from "express";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import customerRoutes from "./customer.routes.js";
import printerRoutes from "./printer.routes.js";
import adminRoutes from "./admin.routes.js";
import orderRoutes from "./order.routes.js";
import healthRoutes from "./health.routes.js";
import payoutRoutes from "./payout.routes.js";
import geocodingRoutes from "./geocoding.routes.js";

const router = express.Router();

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/geocode", geocodingRoutes);
router.use("/customer", customerRoutes);
router.use("/printer", printerRoutes);
router.use("/admin", adminRoutes);
router.use("/orders", orderRoutes);
router.use("/payouts", payoutRoutes);

export default router;
