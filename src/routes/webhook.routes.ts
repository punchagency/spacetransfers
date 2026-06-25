import express from "express";
import { shipStationWebhook } from "../controllers/webhook.controller.js";

const router = express.Router();

// POST /api/webhooks/shipstation?token=<SHIPSTATION_WEBHOOK_SECRET>
// Register this full URL in ShipStation → Settings → Webhooks
router.post("/shipstation", shipStationWebhook);

export default router;
