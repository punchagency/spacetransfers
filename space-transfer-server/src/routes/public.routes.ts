import express from "express";
import { getPublicStats } from "../controllers/public.controller.js";
import { getLegalDocument, listLegalDocuments } from "../controllers/legal.controller.js";
import { publicReadLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

/**
 * @route GET /api/public/stats
 * @desc  Network counts for the sign-in screen: active partners, orders fulfilled.
 * @access Public
 *
 * Mounted under an explicitly named `public` prefix so that "no authentication
 * here" is a property of the path rather than something a reader has to infer
 * from a missing middleware argument.
 */
router.get("/stats", publicReadLimiter, getPublicStats);

// The Terms, Privacy Policy and Content Policy, as currently published.
router.get("/legal", publicReadLimiter, listLegalDocuments);
router.get("/legal/:docId", publicReadLimiter, getLegalDocument);

export default router;
