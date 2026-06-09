import express from "express";
import { login, register, me, getSubAccounts, addSubAccount, removeSubAccount, switchAccount, forgotPassword, resetPasswordController, googleAuthController, confirmEmailVerification } from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPasswordController);
router.post("/google", googleAuthController);
router.get("/verify-email", confirmEmailVerification);
router.get("/me", authenticate, me);
router.get("/sub-accounts", authenticate, getSubAccounts);
router.post("/sub-accounts", authenticate, addSubAccount);
router.delete("/sub-accounts/:id", authenticate, removeSubAccount);
router.post("/switch-account", authenticate, switchAccount);

export default router;
