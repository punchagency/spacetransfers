import express from "express";
import { getRecentOrders, getOrderById, streamOrderEvents } from "../controllers/order.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

/**
 * @route GET /api/orders
 * @desc Recent orders, scoped to the caller's role.
 * @access Authenticated
 *
 * This was open to anonymous callers, serving an "activity feed" of real orders:
 * customer first names and last initials, item names, order totals and
 * timestamps. Anonymised, but enough for anyone on the internet to page through
 * the order book and read volume, pricing and timing straight off it.
 *
 * No client ever called it — the store, console and printer app all use their
 * own `/customer`, `/admin` and `/printer` order routes. It was exposure with no
 * consumer, so it now requires a session like everything else.
 */
router.get("/", authenticate, getRecentOrders);

/**
 * @route GET /api/orders/:orderId
 * @desc Retrieve a single order by ID.
 * @access Authenticated
 */
router.get("/:orderId", authenticate, getOrderById);
router.get("/:orderId/stream", authenticate, streamOrderEvents);

export default router;
