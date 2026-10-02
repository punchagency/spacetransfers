import { Request, Response, NextFunction } from "express";
import { rollWidthError } from "../../services/pricing.service.js";
import mongoose from "mongoose";
import { User, UserRoles } from "../../models/user.model.js";
import { Settings } from "../../models/settings.model.js";
import { DEFAULT_GLOBAL_PRICING, normalizeGlobalPricing } from "../../services/pricing.service.js";
import { normalizeSlaSettings } from "../../services/partnerCapacity.service.js";
import { CustomError } from "./shared.js";

export const getGlobalPricing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await Settings.findOne({ key: "global_pricing" });

    if (!settings) {
      return res.status(200).json(DEFAULT_GLOBAL_PRICING);
    }

    // Normalised, not raw: a document saved before a field existed must still
    // come back with that field, or the console would render it blank and then
    // save the blank over the working default.
    res.status(200).json(normalizeGlobalPricing(settings.value));
  } catch (error) {
    next(error);
  }
};

export const updateGlobalPricing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.body && req.body.sheetWidthIn !== undefined) {
      const problem = rollWidthError(req.body.sheetWidthIn);
      if (problem) {
        const error = new Error(problem) as CustomError;
        error.statusCode = 400;
        throw error;
      }
    }

    const existing = await Settings.findOne({ key: "global_pricing" }).lean();
    const merged = normalizeGlobalPricing({
      ...((existing as any)?.value || {}),
      ...req.body,
    });

    const settings = await Settings.findOneAndUpdate(
      { key: "global_pricing" },
      { $set: { value: merged } },
      { upsert: true, new: true, runValidators: true }
    );

    res.status(200).json(settings?.value);
  } catch (error) {
    next(error);
  }
};

export const getPartnerSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOne({ _id: partnerIdString, role: UserRoles.PRINTER })
      .select("settings shipStationWarehouseId")
      .lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const settings = partner.settings || {};

    res.status(200).json({
      // autoAccept was missing from this fallback, so a partner with no
      // jobCapacity document came back without it and the toggle defaulted
      // blind.
      jobCapacity: settings.jobCapacity || { maxConcurrent: 0, dailyMax: 0, autoAccept: true },
      // Lives on the user, not in settings — it identifies this partner inside
      // the client's ShipStation account rather than configuring the platform.
      shipStationWarehouseId: (partner as any).shipStationWarehouseId ?? null,
    });
  } catch (error) {
    next(error);
  }
};

export const updatePartnerSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { jobCapacity, shipStationWarehouseId } = req.body;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const updateData: any = {};

    if (jobCapacity) {
      if (jobCapacity.maxConcurrent !== undefined) updateData["settings.jobCapacity.maxConcurrent"] = jobCapacity.maxConcurrent;
      if (jobCapacity.dailyMax !== undefined) updateData["settings.jobCapacity.dailyMax"] = jobCapacity.dailyMax;
      /*
       * Auto-accept had no branch at all, so the toggle in the console never
       * saved anything: it moved, reported success, and reverted on reload.
       */
      if (jobCapacity.autoAccept !== undefined) updateData["settings.jobCapacity.autoAccept"] = jobCapacity.autoAccept;
    }

    if (shipStationWarehouseId !== undefined) {
      const raw = shipStationWarehouseId;
      if (raw === null || raw === "") {
        updateData["shipStationWarehouseId"] = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) {
          const error = new Error(
            "ShipStation warehouse ID must be a positive whole number — it is the number in the warehouse's URL",
          ) as CustomError;
          error.statusCode = 400;
          throw error;
        }
        updateData["shipStationWarehouseId"] = n;
      }
    }

    const partner = await User.findOneAndUpdate(
      { _id: partnerIdString, role: UserRoles.PRINTER },
      { $set: updateData },
      { new: true, runValidators: true }
    ).lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({ updated: true });
  } catch (error) {
    next(error);
  }
};

export const getPartnerAssignmentSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await Settings.findOne({ key: "partnerAssignment" }).lean();
    const value = (settings as any)?.value || {};

    res.json({
      assignmentRule: value.rule || "nearest-region",
      maxJobsEnabled: value.maxJobsEnabled !== false,
      // The stored number, whether the limit is on or off, so the console can
      // show what it would go back to. 10 only stands in for "never set".
      maxJobsValue: Number(value.maxJobsValue) > 0 ? Math.floor(Number(value.maxJobsValue)) : 10,
      // Normalised, so a document saved before the SLA existed still comes back
      // with usable windows instead of blanks the console would save over.
      sla: normalizeSlaSettings(value.sla),
    });
  } catch (error) {
    next(error);
  }
};

export const updatePartnerAssignmentSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { assignmentRule, maxJobsEnabled, maxJobsValue, sla } = req.body;

    if (!assignmentRule || !["nearest-region", "manual"].includes(assignmentRule)) {
      return res.status(400).json({ error: "Invalid assignment rule" });
    }

    /**
     * Merged over what is stored, not written fresh.
     *
     * This replaced the whole value object from three named fields, so saving
     * the assignment rule would have silently deleted the SLA windows — and the
     * monitor would have carried on against defaults nobody chose. Same failure
     * the pricing settings had.
     */
    const existing = await Settings.findOne({ key: "partnerAssignment" }).lean();
    const enabled = maxJobsEnabled !== false;
    const previousMax = Number((existing as any)?.value?.maxJobsValue);
    const keptMax = Number.isFinite(previousMax) && previousMax > 0 ? Math.floor(previousMax) : null;
    const parsedMax = parseInt(maxJobsValue, 10);

    // A limit that is on must be a real number — storing NaN would disable
    // capacity checks silently, which is the opposite of what was asked for.
    if (enabled && (!Number.isFinite(parsedMax) || parsedMax < 1)) {
      const error = new Error("Maximum jobs per partner must be a whole number of at least 1.") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const settingValue = {
      rule: assignmentRule,
      maxJobsEnabled: enabled,
      maxJobsValue: enabled ? parsedMax : keptMax,
      sla: normalizeSlaSettings(sla ?? (existing as any)?.value?.sla),
    };

    let settings = await Settings.findOne({ key: "partnerAssignment" });
    if (!settings) {
      settings = new Settings({
        key: "partnerAssignment",
        value: settingValue,
      });
    } else {
      settings.value = settingValue;
    }

    await settings.save();

    res.json({
      assignmentRule: settingValue.rule,
      maxJobsEnabled: settingValue.maxJobsEnabled,
      maxJobsValue: settingValue.maxJobsValue,
      sla: settingValue.sla,
    });
  } catch (error) {
    next(error);
  }
};
