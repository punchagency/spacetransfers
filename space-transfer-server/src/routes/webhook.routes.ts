import express from "express";
import { easyPostWebhook } from "../controllers/webhook.controller.js";

const router = express.Router();

// POST /api/webhooks/easypost — register it with scripts/setup-easypost-webhook.mjs.
// The body arrives unparsed (see app.ts) so its signature can be checked.
router.post("/easypost", easyPostWebhook);

export default router;
