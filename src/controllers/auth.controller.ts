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
import { recordLoginActivity, extractClientIp, resolveGeo } from "../services/loginActivity.service.js";
import { createAdminNotification } from "../services/adminNotifications.service.js";

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
    const { name, email, password, role, companyName, phone, region, website, address, legalAcceptance } = req.body;
    const result = await registerUser({
      name, email, password, role, companyName, phone, region, website, address,
      legalAcceptance,
      // Captured server-side so the audit record reflects the actual request,
      // not a client-supplied claim about it.
      legalContext: { ip: extractClientIp(req), userAgent: req.get("user-agent") || undefined },
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // `role` says which of this address's accounts is meant — one address can
    // now hold one per role, and each app knows its own.
    const { email, password, role } = req.body;
    const result = await loginUser({ email, password, role });
    const userId = String(result.user.id);

    // Log the successful sign-in for the Security → Login Activity view.
    const recorded = await recordLoginActivity({ req, userId, status: "success" }).catch(() => null);

    /**
     * Alert only on a sign-in from a device and place this account has not used
     * before.
     *
     * This fired on *every* login, and went to `notifyAllAdmins` — so one
     * sign-in emailed all six admins a message reading "Your admin account was
     * signed into", which was true for exactly one of them. Between the
     * frequency and the inaccuracy it trained people to ignore the one channel
     * that carries security notices.
     *
     * Now it goes to the admin whose account it actually was, and only when
     * there is something worth looking at.
     */
    try {
      if (result.user.role === "ADMIN" && recorded?.isNewContext) {
        createAdminNotification({
          adminId: userId,
          category: "system",
          priority: "medium",
          title: "Sign-in from a new device",
          message: `Your admin account was signed into from ${recorded.location} on ${recorded.device}. If this was not you, change your password.`,
          meta: {
            userId,
            ip: recorded.ip,
            location: recorded.location,
            device: recorded.device,
            type: "login_success_new_device"
          }
        }).catch(() => {});
      }
    } catch {
      /* notification is best-effort */
    }

    res.json(result);
  } catch (error) {
    // Record a failed attempt too, but only when the email maps to a real user
    // so the entry can be attributed (and we never leak whether an email exists).
    try {
      const email = req.body?.email;
      if (email) {
        /*
         * Scoped to the role that was being signed into, so a failed partner
         * sign-in is recorded against the partner account rather than whichever
         * account on that address happened to be found first — which would also
         * have alerted the wrong admin.
         */
        const attemptedRole = req.body?.role;
        const existing = attemptedRole
          ? await User.findOne({ email: String(email).toLowerCase().trim(), role: attemptedRole }).select("_id role")
          : await User.findOne({ email: String(email).toLowerCase().trim() }).select("_id role");
        if (existing) {
          const userId = String(existing._id);
          recordLoginActivity({ req, userId, status: "failed" }).catch(() => {});

          // Notify admin on failed login attempt.
          if (existing.role === "ADMIN") {
            try {
              const ip = extractClientIp(req);
              const { location } = await resolveGeo(ip);
              // Also was notifyAllAdmins. A failed attempt on one account is
              // that account holder's business, not a broadcast to everyone.
              createAdminNotification({
                adminId: userId,
                category: "system",
                priority: "medium",
                title: "Failed sign-in attempt",
                message: `A failed sign-in attempt was made on your admin account from ${location}`,
                meta: { userId, ip, location, type: "login_failed" }
              }).catch(() => {});
            } catch {
              /* notification is best-effort */
            }
          }
        }
      }
    } catch {
      /* attribution lookup is best-effort */
    }
    next(error);
  }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    const result = await requestPasswordReset(email, req.body?.role);
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
    const { token, newPassword, legalAcceptance } = req.body;
    await resetPassword({
      token,
      newPassword,
      legalAcceptance,
      // Same audit context registration records, so an acceptance captured on
      // an invitation is as evidenced as one captured on the signup form.
      legalContext: {
        ip: req.ip,
        userAgent: req.get("user-agent") || undefined,
      },
    });
    res.json({ message: "Password has been reset successfully." });
  } catch (error) {
    next(error);
  }
};

export const googleAuthController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { credential, legalAcceptance } = req.body;
    if (!credential || typeof credential !== "string") {
      return res.status(400).json({ message: "Google credential is required" });
    }
    const result = await loginWithGoogle(credential, legalAcceptance, {
      ip: extractClientIp(req),
      userAgent: req.get("user-agent") || undefined,
    });
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
