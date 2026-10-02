import { Request, Response, NextFunction } from "express";
import { Order } from "../../models/order.model.js";
import { User } from "../../models/user.model.js";
import { broadcastToAllAdmins } from "../../services/adminNotificationsHub.js";
import { changePartnerAvailability } from "../../services/partnerAvailability.service.js";
import { notifyAllAdmins } from "../../services/adminNotifications.service.js";
import { geocodeAddress } from "../../utils/geocoding.js";
import { getRegionFromState, getRegionFromCoords, normalizeRegion } from "../../utils/region.js";
import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { syncPartnerCapacity } from "../../services/partnerCapacity.service.js";
import { storeArtwork } from "../../services/storage.service.js";
import { isValidPhone } from "../../utils/accountFields.js";
import { computePartnerPerformance } from "../../services/partnerPerformance.service.js";
import sharp from "sharp";
import { CustomError } from "./shared.js";

export const uploadProfileAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const file = req.file;
    const { type } = req.body; // 'avatar' or 'certification'

    if (!file) {
      const error = new Error("No file uploaded") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const user = await User.findById(printerId);
    if (!user) {
      const error = new Error("Printer not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (type === "avatar") {
      const optimizedBuffer = await sharp(file.buffer)
        .resize(400, 400, { fit: "cover" })
        .webp({ quality: 80 })
        .toBuffer();
      const { url } = await storeArtwork(optimizedBuffer, "space-transfers/avatars");
      user.avatarUrl = url;
      await user.save();
      return res.json({ message: "Avatar uploaded and optimized", url });
    }

    const { url } = await storeArtwork(file.buffer, "space-transfers/certifications");
    res.json({ message: "Document uploaded successfully", url });
  } catch (error) {
    next(error);
  }
};

export const getPrinterProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const user = await User.findById(printerId);

    if (!user) {
      const error = new Error("Printer not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const totalJobs = await Order.countDocuments({
      assignedPrinter: printerId,
      status: { $nin: ["CANCELLED", "REJECTED"] },
    });

    /*
     * The real figures, from the same service the admin's partner page reads.
     *
     * `user.performance` was returned here before. Nothing in the server ever
     * writes it — it is {0, 0, 0} on every partner — and the Profile page
     * rendered those zeros as "< 2 hours" response time and "Top 10%". A
     * partner was being shown invented statistics about their own business.
     */
    const performance = await computePartnerPerformance(String(printerId));

    // Fallback for address synchronization
    const businessAddress: any = user.businessAddress?.street 
      ? user.businessAddress 
      : (user.defaultShippingAddress || {});

    res.json({
      name: user.name,
      businessName: user.companyName || user.name,
      email: user.email,
      phone: user.phone || "N/A",
      website: user.website || "N/A",
      avatarUrl: user.avatarUrl,
      regions: user.regions || [],
      detectedRegion: (user as any).detectedRegion ?? null,
      status: user.status || "Active",
      availabilityStatus: (user as any).availabilityStatus ?? "open",
      memberSince: user.createdAt,
      totalJobs,
      verificationStatus: user.verificationStatus || {
        email: false,
        phone: false,
        business: false,
        document: false
      },
      businessDetails: user.businessDetails || {},
      businessAddress: {
        street: businessAddress.street || "",
        city: businessAddress.city || "",
        state: businessAddress.state || "",
        postalCode: businessAddress.postalCode || "",
        country: businessAddress.country || "",
        verified: (businessAddress as any).verified || false
      },
      certifications: user.certifications || [],
      // Nulls where there is no sample yet, so the client can say "no completed
      // jobs yet" instead of printing a zero that reads as a bad score.
      performance: {
        averageProductionHours: performance.averageProductionHours,
        onTimeDeliveryRate: performance.onTimeDeliveryRate,
        sampleSize: performance.sampleSize,
        rating: typeof user.rating === "number" ? user.rating : null,
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updatePrinterProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const { 
      name,
      businessName, 
      phone, 
      website, 
      businessDetails, 
      businessAddress,
      certifications 
    } = req.body;

    const user = await User.findById(printerId);

    if (!user) {
      const error = new Error("Printer not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    /*
     * Keyed on `undefined`, not on truthiness.
     *
     * `if (website)` meant an empty string was skipped, so a partner who
     * mistyped their website could never remove it — the field was
     * write-once-then-permanent. Same for name and phone. `undefined` means
     * "not sent"; an empty string is a deliberate clear.
     */
    if (typeof name === "string" && name.trim()) user.name = name.trim();
    if (typeof businessName === "string" && businessName.trim()) user.companyName = businessName.trim();

    if (phone !== undefined) {
      const trimmed = String(phone ?? "").trim();
      /*
       * The same rule signup and the storefront enforce, from the shared
       * validator. This endpoint accepted anything, so a partner could sign up
       * with a valid number and then replace it with "asdf" — and their phone
       * is what goes on the shipping label.
       */
      if (trimmed && !isValidPhone(trimmed)) {
        const error = new Error("Enter a valid phone number") as CustomError;
        error.statusCode = 400;
        throw error;
      }
      user.phone = trimmed;
    }

    if (website !== undefined) user.website = String(website ?? "").trim();
    
    if (businessDetails) {
      user.businessDetails = { ...user.businessDetails, ...businessDetails };
    }
    
    const regionBefore = Array.isArray(user.regions) ? user.regions[0] ?? null : null;

    if (businessAddress) {
      /*
       * Merged field by field, not by spreading the stored subdocument.
       *
       * `{ ...user.businessAddress }` on a Mongoose subdocument copies
       * `coordinates` across as an own key holding `undefined`, and the save
       * then fails casting undefined to an Object:
       *
       *   ValidationError: businessAddress.coordinates: Cast to Object failed
       *   for value "undefined" at path "businessAddress.coordinates"
       *
       * So *every* attempt to change a business address answered 500. Nobody
       * had noticed because no client sends one — but a partner's address sets
       * their region and the shipping origin on their labels, so this is the
       * update that matters most.
       */
      const existing = (user.businessAddress as any) ?? {};
      const pick = (next: unknown, current: unknown) =>
        next === undefined ? current : next === null || next === "" ? "" : String(next).trim();

      const merged: any = {
        street: pick(businessAddress.street, existing.street),
        city: pick(businessAddress.city, existing.city),
        state: pick(businessAddress.state, existing.state),
        postalCode: pick(businessAddress.postalCode, existing.postalCode),
        country: pick(businessAddress.country, existing.country),
        verified: false,
      };
      // Only carried when it actually exists; assigning undefined is the bug above.
      if (existing.coordinates?.lat != null && existing.coordinates?.lng != null) {
        merged.coordinates = { lat: existing.coordinates.lat, lng: existing.coordinates.lng };
      }

      user.businessAddress = merged;

      // Re-geocode and recalculate region whenever the address changes
      try {
        const geocoded = await geocodeAddress({
          street:  merged.street,
          city:    merged.city,
          state:   merged.state,
          zip:     merged.postalCode,
        });

        if (geocoded) {
          user.businessAddress = {
            street:      geocoded.street     || merged.street,
            city:        geocoded.city       || merged.city,
            state:       geocoded.state      || merged.state,
            postalCode:  geocoded.zip        || merged.postalCode,
            country:     merged.country,
            verified:    merged.verified ?? false,
            coordinates: { lat: geocoded.lat, lng: geocoded.lng },
          } as any;

          const newRegion =
            normalizeRegion(getRegionFromState(geocoded.state)) ??
            getRegionFromCoords(geocoded.lat, geocoded.lng);
          user.regions = [newRegion];
          (user as any).detectedRegion = newRegion;

          console.log(
            `[region-assign] role=PRINTER id=${user.id} state=${geocoded.state} ` +
            `region=${newRegion} geocoded=true (profile update)`
          );
        } else {
          // Fallback: derive from state code
          const fallbackRegion = getRegionFromState(merged.state);
          if (fallbackRegion) {
            user.regions = [fallbackRegion];
            (user as any).detectedRegion = fallbackRegion;
          }
          console.log(
            `[region-assign] role=PRINTER id=${user.id} state=${merged.state} ` +
            `region=${fallbackRegion} geocoded=false (profile update fallback)`
          );
        }
      } catch (geoErr) {
        console.error("[geocoding] profile update geocoding error:", geoErr);
        // Keep existing region on error — don't overwrite with a bad value
      }
    }

    if (certifications !== undefined) {
      /*
       * Validated here, not only in the browser.
       *
       * These went straight onto the document, so a bad date reached Mongoose
       * and came back as an unhandled ValidationError — a 500 and a generic
       * "Something went wrong" for what is a form mistake. The console
       * validates the same three fields; this is the half that was missing.
       */
      if (!Array.isArray(certifications)) {
        const error = new Error("Certifications must be a list") as CustomError;
        error.statusCode = 400;
        throw error;
      }

      const cleaned = certifications.map((c: any, i: number) => {
        const name = String(c?.name ?? "").trim();
        const authority = String(c?.authority ?? "").trim();
        if (!name || !authority) {
          const error = new Error(
            `Certification ${i + 1} needs both a name and an issuing authority`,
          ) as CustomError;
          error.statusCode = 400;
          throw error;
        }

        const parseDate = (value: unknown, label: string, required: boolean) => {
          if (value === undefined || value === null || value === "") {
            if (!required) return undefined;
            const error = new Error(`Certification ${i + 1} needs a ${label}`) as CustomError;
            error.statusCode = 400;
            throw error;
          }
          const d = new Date(value as string);
          if (Number.isNaN(d.getTime())) {
            const error = new Error(`Certification ${i + 1} has an invalid ${label}`) as CustomError;
            error.statusCode = 400;
            throw error;
          }
          return d;
        };

        const date = parseDate(c?.date, "issue date", true)!;
        const expiryDate = parseDate(c?.expiryDate, "expiry date", false);
        if (expiryDate && expiryDate < date) {
          const error = new Error(
            `Certification ${i + 1} expires before it was issued`,
          ) as CustomError;
          error.statusCode = 400;
          throw error;
        }

        return {
          name,
          authority,
          date,
          expiryDate,
          verificationCode: c?.verificationCode ? String(c.verificationCode).trim() : undefined,
          documentUrl: c?.documentUrl ? String(c.documentUrl).trim() : undefined,
        };
      });

      user.certifications = cleaned as any;
    }

    await user.save();

    const regionAfter = Array.isArray(user.regions) ? user.regions[0] ?? null : null;

    broadcastToAllAdmins("partner.profile_updated", {
      partnerId: String(user._id),
      name: user.companyName || user.name,
      contactName: user.name,
      phone: user.phone || null,
      website: user.website || null,
      regions: user.regions || [],
      regionChanged: Boolean(businessAddress) && regionAfter !== regionBefore,
    });

    if (businessAddress && regionAfter !== regionBefore) {
      notifyAllAdmins({
        category: "partners",
        priority: "medium",
        title: "Partner changed their service region",
        message:
          `${user.companyName || user.name} updated their business address, moving them from ` +
          `${regionBefore || "no region"} to ${regionAfter || "no region"}. Orders are routed by region, ` +
          `so this changes what they can be assigned.`,
        meta: { partnerId: String(user._id), regionBefore, regionAfter },
      }).catch(() => {});
    }

    res.json({
      message: "Profile updated successfully",
      profile: {
        name: user.name,
        businessName: user.companyName || user.name,
        phone: user.phone || "N/A",
        website: user.website || "N/A",
        businessDetails: user.businessDetails,
        businessAddress: user.businessAddress,
        certifications: user.certifications,
        regions: user.regions || [],
        detectedRegion: (user as any).detectedRegion ?? null,
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getPrinterSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const user = await User.findById(printerId);

    if (!user) {
      const error = new Error("Printer not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const settings = user.settings || {};

    res.json({
      jobCapacity: settings.jobCapacity || { maxConcurrent: 5, dailyMax: 50, autoAccept: true },
      notifications: {
        email: {
          newJobs:        settings.notifications?.email?.newJobs        ?? true,
          orderUpdates:   settings.notifications?.email?.orderUpdates   ?? true,
          payoutAlerts:   settings.notifications?.email?.payoutAlerts   ?? true,
          accountUpdates: settings.notifications?.email?.accountUpdates ?? true,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updatePrinterSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const updateData = req.body;

    const user = await User.findById(printerId);
    if (!user) {
      const error = new Error("Printer not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (!user.settings) user.settings = {} as any;

    const deepMerge = (target: any, source: any) => {
      for (const key in source) {
        if (source[key] instanceof Object && key in target) {
          deepMerge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
    };

    deepMerge(user.settings, updateData);

    user.markModified("settings");
    await user.save();

    const settings = user.settings || {};
    res.json({
      jobCapacity: settings.jobCapacity || { maxConcurrent: 5, dailyMax: 50, autoAccept: true },
      notifications: {
        email: {
          newJobs:        settings.notifications?.email?.newJobs        ?? true,
          orderUpdates:   settings.notifications?.email?.orderUpdates   ?? true,
          payoutAlerts:   settings.notifications?.email?.payoutAlerts   ?? true,
          accountUpdates: settings.notifications?.email?.accountUpdates ?? true,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Email Verification ───────────────────────────────────────────────────────

export const requestEmailVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const user = await User.findById(printerId);
    if (!user) { const e = new Error("Printer not found") as any; e.statusCode = 404; throw e; }

    if (user.verificationStatus?.email) {
      return res.status(400).json({ message: "Email is already verified" });
    }

    // Rate limiting: 60-second cooldown between sends
    const COOLDOWN_MS = 60_000;
    if (user.emailVerificationSentAt) {
      const elapsed = Date.now() - user.emailVerificationSentAt.getTime();
      if (elapsed < COOLDOWN_MS) {
        const retryAfterSecs = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        return res.status(429).json({
          message: `Please wait ${retryAfterSecs}s before requesting another verification email`,
          retryAfterSecs,
        });
      }
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    user.emailVerificationTokenHash = tokenHash;
    user.emailVerificationExpiresAt = expiresAt;
    user.emailVerificationSentAt = new Date();
    await user.save();

    const { sendEmail } = await import("../../services/email.service.js");
    const verifyUrl = `${env.printerAppUrl}/verify-email?token=${rawToken}`;
    const displayName = user.companyName || user.name || "Printer";

    await sendEmail({
      to: user.email,
      subject: "Verify your email address – Space Transfers",
      html: `
        <!DOCTYPE html>
        <html>
        <body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
                <tr><td style="background:linear-gradient(135deg,#2563EB,#1D4ED8);padding:32px 40px;">
                  <p style="margin:0;color:#fff;font-size:22px;font-weight:700;">Space Transfers</p>
                  <p style="margin:6px 0 0;color:#bfdbfe;font-size:13px;">Printer Partner Network</p>
                </td></tr>
                <tr><td style="padding:40px;">
                  <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827;">Verify your email address</p>
                  <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">Hi ${displayName}, click the button below to verify your email address. This link expires in 24 hours.</p>
                  <a href="${verifyUrl}" style="display:inline-block;padding:12px 28px;background:#2563EB;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">Verify Email Address</a>
                  <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">Or copy this link: <a href="${verifyUrl}" style="color:#2563EB;">${verifyUrl}</a></p>
                  <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">If you didn't request this, you can safely ignore this email.</p>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </body>
        </html>
      `,
    });

    return res.json({
      sent: true,
      message: "Verification email sent",
      nextAllowedAt: new Date(user.emailVerificationSentAt.getTime() + COOLDOWN_MS).toISOString(),
    });
  } catch (error) {
    next(error);
  }
};

export const getAvailabilityStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    if (!printerId) { const e = new Error("Unauthorized") as any; e.statusCode = 401; throw e; }

    // Self-heal on read: reconcile the partner's availability with their current
    // load. This guarantees a capacity-paused partner whose active job count has
    // dropped below the limit (or to zero) is auto-reopened when the dashboard
    // loads — even if a status-transition hook was somehow missed. It never
    // reopens a manually-paused/stopped partner.
    const sync = await syncPartnerCapacity(String(printerId));
    if (sync) {
      return res.json({
        availabilityStatus: sync.availabilityStatus,
        capacityLocked: sync.capacityLocked,
        capacityPaused: sync.capacityPaused,
        activeJobs: sync.activeJobs,
        maxJobs: sync.maxJobs,
      });
    }

    // Fallback (e.g. the user isn't a printer): report the raw stored status.
    const user = await User.findById(printerId).select("availabilityStatus").lean();
    if (!user) { const e = new Error("Printer not found") as any; e.statusCode = 404; throw e; }
    res.json({
      availabilityStatus: (user as any).availabilityStatus ?? "open",
      capacityLocked: false,
      capacityPaused: false,
      activeJobs: 0,
      maxJobs: null,
    });
  } catch (error) { next(error); }
};

export const updateAvailabilityStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    if (!printerId) { const e = new Error("Unauthorized") as any; e.statusCode = 401; throw e; }

    const { status } = req.body as { status?: string };
    const valid = ["open", "paused"] as const;
    if (!status || !valid.includes(status as any)) {
      const e = new Error("status must be one of: open, paused") as any;
      e.statusCode = 400;
      throw e;
    }

    const result = await changePartnerAvailability({
      partnerId: String(printerId),
      to: status as "open" | "paused",
      actor: { id: String(printerId), name: (req.user as any)?.name || null, kind: "partner" },
    });

    if (!result) { const e = new Error("Printer not found") as any; e.statusCode = 404; throw e; }

    res.json({
      availabilityStatus: result.availabilityStatus,
      capacityLocked: result.capacityLocked,
      capacityPaused: result.capacityPaused,
      activeJobs: result.activeJobs,
      maxJobs: result.maxJobs,
    });
  } catch (error) { next(error); }
};
