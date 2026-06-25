import { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import {
  loginUser,
  registerUser,
  getCurrentUser,
  listSubAccounts,
  createSubAccount,
  deleteSubAccount,
  switchSubAccount,
  requestPasswordReset,
  resetPassword,
  loginWithGoogle,
} from "../services/auth.service.js";
import { User } from "../models/user.model.js";
import { notifyPrinter } from "../services/printerNotifications.service.js";

export const me = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getCurrentUser((req as any).user.id);
    res.json(user);
  } catch (error) {
    next(error);
  }
};

export const getSubAccounts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const subAccounts = await listSubAccounts((req as any).user.id);
    res.json(subAccounts);
  } catch (error) {
    next(error);
  }
};

export const addSubAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await createSubAccount((req as any).user.id, req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

export const removeSubAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const subAccountId = String((req as any).params?.id);
    await deleteSubAccount((req as any).user.id, subAccountId);
    res.json({ message: "Sub-account deleted successfully." });
  } catch (error) {
    next(error);
  }
};

export const switchAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { targetUserId } = req.body;
    const result = await switchSubAccount((req as any).user.id, targetUserId);
    res.json({ ...result, message: `Switched to ${result.user.name}'s account` });
  } catch (error) {
    next(error);
  }
};

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password, role, companyName, phone, region, website, address } = req.body;
    const result = await registerUser({ name, email, password, role, companyName, phone, region, website, address });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const result = await loginUser({ email, password });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    const result = await requestPasswordReset(email);
    res.json({
      message: "If an account exists for that email, a reset link has been sent.",
      ...result
    });
  } catch (error) {
    next(error);
  }
};

export const resetPasswordController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = req.body;
    await resetPassword({ token, newPassword });
    res.json({ message: "Password has been reset successfully." });
  } catch (error) {
    next(error);
  }
};

export const googleAuthController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { credential } = req.body;
    if (!credential || typeof credential !== "string") {
      return res.status(400).json({ message: "Google credential is required" });
    }
    const result = await loginWithGoogle(credential);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const confirmEmailVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawToken = String(req.query.token || "").trim();
    if (!rawToken) {
      return res.status(400).json({ message: "Verification token is required" });
    }

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    // Look up by hash only — no expiry filter here so an already-consumed token
    // (expiresAt = null) is still found and can return idempotent success.
    const user = await User.findOne({ emailVerificationTokenHash: tokenHash });

    if (!user) {
      return res.status(400).json({ message: "Invalid verification link. Please request a new one." });
    }

    // Idempotent: if this token was already consumed and the email is verified, succeed.
    if (user.verificationStatus?.email) {
      return res.json({ verified: true, message: "Email verified successfully" });
    }

    // Token exists but the expiry has passed (not yet verified). 
    if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
      return res.status(400).json({ message: "Verification link has expired. Please request a new one." });
    }

    if (!user.verificationStatus) {
      user.verificationStatus = { email: false, phone: false, business: false, document: false };
    }
    user.verificationStatus.email = true;
    // Null out expiry to mark token as consumed, but keep the hash so a second call
    // (React StrictMode / retry) still finds the record and hits the idempotent branch.
    user.emailVerificationExpiresAt = null;
    user.markModified("verificationStatus");
    await user.save();

    // Push real-time SSE so the open dashboard tab auto-refreshes profile.
    notifyPrinter({
      printerId: String(user._id),
      category: "system",
      priority: "medium",
      title: "Email verified",
      message: "Your email address has been successfully verified.",
      meta: { type: "email_verified" },
      settingsKey: "accountUpdates",
    }).catch(() => {});

    return res.json({ verified: true, message: "Email verified successfully" });
  } catch (error) {
    next(error);
  }
};
