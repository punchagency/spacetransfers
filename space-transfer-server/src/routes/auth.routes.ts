import express from "express";
import { login, register, me, getSubAccounts, addSubAccount, removeSubAccount, switchAccount, forgotPassword, resetPasswordController, googleAuthController, confirmEmailVerification } from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";
import {
  beginPasskeySetup,
  completePasskeySetup,
  completeSignInWithPasskey,
  completeSignInWithRecoveryCode,
  listPasskeys,
  regenerateRecoveryCodes,
  removePasskey,
} from "../controllers/passkey.controller.js";
import {
  authAttemptLimiter,
  registrationLimiter,
  passwordResetLimiter,
  twoFactorLimiter,
} from "../middleware/rateLimit.js";

const router = express.Router();

router.post("/register", registrationLimiter, register);
router.post("/login", authAttemptLimiter, login);
router.post("/forgot-password", passwordResetLimiter, forgotPassword);
router.post("/reset-password", authAttemptLimiter, resetPasswordController);
router.post("/google", authAttemptLimiter, googleAuthController);
router.get("/verify-email", confirmEmailVerification);
router.get("/me", authenticate, me);
router.get("/sub-accounts", authenticate, getSubAccounts);
router.post("/sub-accounts", authenticate, addSubAccount);
router.delete("/sub-accounts/:id", authenticate, removeSubAccount);
router.post("/switch-account", authenticate, switchAccount);

// The second step of sign-in, for an account with a passkey.
router.post("/2fa/passkey", twoFactorLimiter, completeSignInWithPasskey);
router.post("/2fa/recovery", twoFactorLimiter, completeSignInWithRecoveryCode);

// An account's own passkeys.
router.get("/passkeys", authenticate, listPasskeys);
router.post("/passkeys/options", authenticate, beginPasskeySetup);
router.post("/passkeys", authenticate, completePasskeySetup);
router.post("/passkeys/:passkeyId/remove", authenticate, removePasskey);
router.post("/recovery-codes", authenticate, regenerateRecoveryCodes);

export default router;
