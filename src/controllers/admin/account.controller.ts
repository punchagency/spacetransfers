import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import sharp from "sharp";
import bcrypt from "bcryptjs";
import { User, UserRoles } from "../../models/user.model.js";
import { storeArtwork } from "../../services/storage.service.js";
import { LoginActivity } from "../../models/loginActivity.model.js";
import { createAdminNotification } from "../../services/adminNotifications.service.js";
import { CustomError } from "./shared.js";

export const getAdminSecuritySettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const admin = await User.findById(adminId).select("settings.security updatedAt");

    if (!admin) {
      const error = new Error("Admin not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const security = admin.settings?.security || {};

    res.status(200).json({
       lastPasswordChange: security.lastPasswordChange || admin.updatedAt || new Date()
     });
   } catch (error) {
     next(error);
   }
 };
 
 export const getAdminLoginActivity = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) {
      const error = new Error("Unauthorized") as CustomError;
      error.statusCode = 401;
      throw error;
    }

    // Server-side pagination. pageSize is clamped to [1, 50]; the UI offers
    // 10 / 25 / 50. `limit` is still accepted as an alias for backwards compat.
    const pageSize = Math.max(1, Math.min(50, parseInt(String(req.query.pageSize ?? req.query.limit ?? "10"), 10) || 10));
    const requestedPage = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);

    const filter = { userId: new mongoose.Types.ObjectId(adminId) };
    const total = await LoginActivity.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    // Clamp the page to the valid range so an out-of-bounds request (e.g. after
    // the record count shrinks) still returns the last available page.
    const page = Math.min(requestedPage, totalPages);

    const activity = await LoginActivity.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    res.status(200).json({
      activity: activity.map((a: any) => ({
        id: String(a._id),
        device: a.device || "Unknown device",
        ip: a.ip || "Unknown",
        location: a.location || "Unknown",
        status: a.status === "failed" ? "Failed" : "Success",
        time: a.createdAt
      })),
      total,
      page,
      pageSize,
      totalPages
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const admin = await User.findById(adminId).select("name email phone avatarUrl");

    if (!admin) {
      const error = new Error("Admin not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      name: admin.name,
      email: admin.email,
      phone: admin.phone || null,
      avatarUrl: admin.avatarUrl || null,
    });
  } catch (error) {
    next(error);
  }
};

export const updateAdminProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const { name, email, phone, avatarUrl } = req.body;

    const admin = await User.findOne({ _id: adminId, role: UserRoles.ADMIN });
    if (!admin) {
      const error = new Error("Admin not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    let didUpdate = false;

    if (name !== undefined) {
      admin.name = String(name);
      didUpdate = true;
    }
    if (email !== undefined) {
      const nextEmail = String(email).toLowerCase().trim();
      if (!nextEmail) {
        const error = new Error("email is required") as CustomError;
        error.statusCode = 400;
        throw error;
      }
      const existing = await User.findOne({ email: nextEmail, role: UserRoles.ADMIN, _id: { $ne: admin._id } }).select("_id");
      if (existing) {
        const error = new Error("Email already in use") as CustomError;
        error.statusCode = 409;
        throw error;
      }
      admin.email = nextEmail;
      didUpdate = true;
    }
    if (phone !== undefined) {
      admin.phone = phone === null ? undefined : String(phone);
      didUpdate = true;
    }
    if (avatarUrl !== undefined) {
      // Images are uploaded via POST /admin/profile/upload and stored on
      // storage. Accepting a data: URL here would put the whole image back
      // on the user document, which `authenticate` reads on every request.
      if (typeof avatarUrl === "string" && avatarUrl.startsWith("data:")) {
        const error = new Error("Upload images via /admin/profile/upload — an inline data URL cannot be stored.") as CustomError;
        error.statusCode = 400;
        throw error;
      }
      admin.avatarUrl = avatarUrl === null ? null : String(avatarUrl);
      didUpdate = true;
    }

    if (!didUpdate) {
      const error = new Error("No update data provided") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    await admin.save();

    res.status(200).json({ updated: true });
  } catch (error) {
    next(error);
  }
};

export const uploadAdminAvatar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const file = req.file;

    if (!file) {
      const error = new Error("No file uploaded") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const admin = await User.findOne({ _id: adminId, role: UserRoles.ADMIN });
    if (!admin) {
      const error = new Error("Admin not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const optimized = await sharp(file.buffer)
      .resize(400, 400, { fit: "cover" })
      .webp({ quality: 80 })
      .toBuffer();

    const { url } = await storeArtwork(optimized, "space-transfers/avatars");
    admin.avatarUrl = url;
    await admin.save();

    res.json({ avatarUrl: url });
  } catch (error) {
    next(error);
  }
};

export const updateAdminPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const { currentPassword, newPassword } = req.body;

    if (!adminId) {
      const error = new Error("Unauthorized") as CustomError;
      error.statusCode = 401;
      throw error;
    }

    if (typeof currentPassword !== "string" || !currentPassword.trim()) {
      const error = new Error("currentPassword is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (typeof newPassword !== "string" || newPassword.length < 8) {
      const error = new Error("newPassword must be at least 8 characters") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const admin = await User.findOne({ _id: adminId, role: UserRoles.ADMIN }).select("passwordHash settings updatedAt");
    if (!admin) {
      const error = new Error("Admin not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (!admin.passwordHash) {
      const error = new Error("Admin account has no password set") as CustomError;
      error.statusCode = 400;
      throw error;
    }
    const ok = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!ok) {
      // A wrong *submitted* current password is a credential re-check failure on
      // an already-authenticated request — NOT a bad session token. It must not
      // be 401, or the client treats it as an expired token and logs the user
      // out. 403 keeps the session alive and surfaces a descriptive message.
      const error = new Error("Current password is incorrect") as CustomError;
      error.statusCode = 403;
      throw error;
    }

    // The new password must actually be a change. currentPassword was just
    // verified against the stored hash, so a plain equality check is sufficient
    // to detect reuse.
    if (newPassword === currentPassword) {
      const error = new Error("New password must be different from your current password") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    admin.passwordHash = await bcrypt.hash(newPassword, 10);
    if (!admin.settings) {
      admin.settings = {
        pricing: { baseRatePerSqFt: 2.5, tiered: [], surcharges: { rushPct: 10, specialInkFlat: 5 } },
        security: {}
      };
    }
    if (!admin.settings.security) admin.settings.security = {};
    admin.settings.security.lastPasswordChange = new Date();
    admin.markModified("settings.security");
    await admin.save();

    // Send a notification that the password was changed.
    createAdminNotification({
      adminId: String(adminId),
      category: "system",
      priority: "medium",
      title: "Password changed",
      message: "Your admin password was successfully updated.",
      meta: { type: "password_changed", changedAt: new Date() }
    }).catch(() => {});

    res.status(200).json({ updated: true });
  } catch (error) {
    next(error);
  }
};
