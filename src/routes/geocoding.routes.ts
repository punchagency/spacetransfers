import express from "express";
import { validateAddress, cacheStats } from "../controllers/geocoding.controller.js";
import { maybeAuthenticate } from "../middleware/auth.js";

const router = express.Router();

// Address validation is public so the printer signup page (unauthenticated)
// can call it. maybeAuthenticate enriches req.user when a token is present.
router.post("/validate", maybeAuthenticate, validateAddress);
router.get("/cache-stats", cacheStats);

export default router;
