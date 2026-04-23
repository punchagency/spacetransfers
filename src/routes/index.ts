import express from "express";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import customerRoutes from "./customer.routes.js";
import printerRoutes from "./printer.routes.js";
import adminRoutes from "./admin.routes.js";
import orderRoutes from "./order.routes.js";

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/customer", customerRoutes);
router.use("/printer", printerRoutes);
router.use("/admin", adminRoutes);
router.use("/orders", orderRoutes);

export default router;
