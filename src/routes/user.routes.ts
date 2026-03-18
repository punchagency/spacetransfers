import express from "express";
import { getCurrentUser } from "../controllers/user.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

router.get("/me", authenticate, getCurrentUser);

export default router;
