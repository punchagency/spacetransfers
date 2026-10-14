import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { User } from "../models/user.model.js";
import { signSessionToken } from "../utils/jwt.js";
import { verifyPassword } from "../utils/passwords.js";
import {
  clearPasskeys,
  consumeRecoveryCode,
  finishPasskeySetup,
  finishSecondStep,
  generateRecoveryCodes,
  hasPasskey,
  mustEnrollPasskey,
  passkeySummary,
  readStep,
  startPasskeySetup,
} from "../services/passkey.service.js";
import { recordLoginActivity } from "../services/loginActivity.service.js";
import { createAdminNotification, notifyAllAdmins } from "../services/adminNotifications.service.js";

const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

/** What a completed sign-in returns, the same shape whichever way it was reached. */
export const signedInResponse = (user: any) => ({
  user: {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    companyName: user.companyName,
    phone: user.phone,
    website: user.website,
    avatarUrl: user.avatarUrl || null,
    status: user.status,
    region: user.regions?.[0],
    regions: user.regions,
    isGoogleAccount: !!user.googleId,
    hasPasskey: hasPasskey(user),
    mustEnrollPasskey: mustEnrollPasskey(user),
  },
  token: signSessionToken(user),
});

const accountForStep = async (stepToken: unknown) => {
  const step = readStep(stepToken, "2fa");
  const user = await User.findById(step.userId);
  if (!user || ["Suspended", "Rejected"].includes(String(user.status))) throw fail("This sign-in step has expired. Please start again.", 401);
  return { user, challenge: step.challenge };
};

/** Second step, by passkey. */
export const completeSignInWithPasskey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user, challenge } = await accountForStep(req.body?.stepToken);
    try {
      await finishSecondStep(user, challenge, req.body?.response);
    } catch (err) {
      recordLoginActivity({ req, userId: String(user._id), status: "failed" }).catch(() => {});
      throw err;
    }
    recordLoginActivity({ req, userId: String(user._id), status: "success" }).catch(() => {});
    res.json(signedInResponse(user));
  } catch (error) {
    next(error);
  }
};

/** Second step, by a one-time recovery code, for when no passkey is to hand. */
export const completeSignInWithRecoveryCode = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user } = await accountForStep(req.body?.stepToken);
    if (!consumeRecoveryCode(user, req.body?.code)) {
      recordLoginActivity({ req, userId: String(user._id), status: "failed" }).catch(() => {});
      throw fail("That recovery code isn't valid, or has already been used.", 401);
    }
    user.markModified("recoveryCodes");
    await user.save();
    recordLoginActivity({ req, userId: String(user._id), status: "success" }).catch(() => {});

    const left = passkeySummary(user).recoveryCodesLeft;
    if (user.role === "ADMIN") {
      createAdminNotification({
        adminId: String(user._id),
        category: "system",
        priority: "high",
        title: "Recovery code used to sign in",
        message: `A recovery code was used to sign in to your admin account. ${left} left. If this was not you, change your password and reset your passkeys.`,
        meta: { userId: String(user._id), type: "recovery_code_used" },
      }).catch(() => {});
    }
    res.json({ ...signedInResponse(user), recoveryCodesLeft: left });
  } catch (error) {
    next(error);
  }
};

const currentAccount = async (req: Request) => {
  const user = await User.findById(req.user?.id);
  if (!user) throw fail("User not found", 404);
  return user;
};

export const listPasskeys = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(passkeySummary(await currentAccount(req)));
  } catch (error) {
    next(error);
  }
};

export const beginPasskeySetup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await startPasskeySetup(await currentAccount(req)));
  } catch (error) {
    next(error);
  }
};

export const completePasskeySetup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await currentAccount(req);
    res.status(201).json(await finishPasskeySetup(user, req.body?.stepToken, req.body?.response, req.body?.name));
  } catch (error) {
    next(error);
  }
};

/**
 * Removing a passkey weakens the account, so a session alone is not enough:
 * the password is asked for again. An account that signs in with Google has
 * none to ask for.
 */
const confirmPassword = async (user: any, password: unknown) => {
  if (!user.passwordHash) return;
  if (typeof password !== "string" || !(await verifyPassword(password, user.passwordHash))) {
    throw fail("Enter your current password to confirm.", 403);
  }
};

export const removePasskey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await currentAccount(req);
    const id = String(req.params.passkeyId || "");
    const remaining = ((user.passkeys || []) as any[]).filter((p) => p.id !== id);
    if (remaining.length === (user.passkeys || []).length) throw fail("Passkey not found", 404);
    if (remaining.length === 0 && passkeySummary(user).required) {
      throw fail("An admin account must keep at least one passkey. Add another before removing this one.", 409);
    }
    await confirmPassword(user, req.body?.password);
    user.passkeys = remaining.length ? (remaining as any) : undefined;
    // With no passkey left there is no second step, so the codes for it go too.
    if (remaining.length === 0) user.recoveryCodes = undefined;
    await user.save();
    res.json(passkeySummary(user));
  } catch (error) {
    next(error);
  }
};

export const regenerateRecoveryCodes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await currentAccount(req);
    if (!hasPasskey(user)) throw fail("Add a passkey first. Recovery codes stand in for one.", 400);
    await confirmPassword(user, req.body?.password);
    const fresh = generateRecoveryCodes();
    user.recoveryCodes = fresh.stored as any;
    await user.save();
    res.json({ ...passkeySummary(user), recoveryCodes: fresh.codes });
  } catch (error) {
    next(error);
  }
};

// ── for admins: who has a passkey, and resetting one that is lost ──

export const listAdminPasskeyStatus = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const admins = await User.find({ role: "ADMIN" }).select("name email status passkeys recoveryCodes").sort({ name: 1 }).lean();
    res.json({
      admins: admins.map((a: any) => ({
        id: String(a._id),
        name: String(a.name || ""),
        email: String(a.email || ""),
        status: String(a.status || ""),
        passkeys: (a.passkeys || []).length,
        recoveryCodesLeft: (a.recoveryCodes || []).filter((c: any) => !c.usedAt).length,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Clears another account's passkeys when its owner has lost both the device
 * and the recovery codes. The account is signed out everywhere; an admin must
 * then set a new passkey up at next sign-in. Not for one's own account, where
 * it would be a way round the second step.
 */
export const resetAccountPasskeys = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.userId || "");
    if (!mongoose.Types.ObjectId.isValid(userId)) throw fail("Account not found", 404);
    if (userId === String(req.user?.id)) throw fail("You can't reset your own passkeys. Use a recovery code, or ask another admin.", 400);
    const target = await User.findById(userId);
    if (!target) throw fail("Account not found", 404);
    if (!hasPasskey(target)) throw fail("This account has no passkeys to reset.", 409);
    const reason = String(req.body?.reason || "").trim();
    if (!reason) throw fail("Say why the passkeys are being reset.", 400);

    await clearPasskeys(target);
    const actor = await User.findById(req.user?.id).select("name email").lean();
    const actorName = String((actor as any)?.name || (actor as any)?.email || "An admin");
    notifyAllAdmins({
      category: "system",
      priority: "high",
      title: "Passkeys reset",
      message: `${actorName} reset the passkeys on ${target.role === "ADMIN" ? "admin" : target.role === "PRINTER" ? "partner" : "customer"} account ${target.email}: ${reason}`,
      meta: { userId: String(target._id), type: "passkeys_reset" },
    }).catch(() => {});
    res.json({ reset: true });
  } catch (error) {
    next(error);
  }
};
