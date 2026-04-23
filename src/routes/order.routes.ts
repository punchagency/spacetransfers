import express from "express";
import { getRecentOrders, getOrderById, streamOrderEvents } from "../controllers/order.controller.js";
import { maybeAuthenticate, authenticate } from "../middleware/auth.js";

const router = express.Router();

/**
 * @route GET /api/orders
 * @desc Retrieve recent orders with pagination and role-based visibility.
 * @access Public (with partial data) / Authenticated (with full data)
 */
router.get("/", maybeAuthenticate, getRecentOrders);

/**
 * @route GET /api/orders/:orderId
 * @desc Retrieve a single order by ID.
 * @access Authenticated
 */
router.get("/:orderId", authenticate, getOrderById);
router.get("/:orderId/stream", authenticate, streamOrderEvents);

export default router;
