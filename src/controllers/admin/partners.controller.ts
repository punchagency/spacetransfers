import { Request, Response, NextFunction } from "express";
import { resolveOrderStatusInput } from "../../utils/orderStatusInput.js";
import { getRegionFromState, normalizeRegion, resolvePartnerRegion } from "../../utils/region.js";
import { sendEmail } from "../../services/email.service.js";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Order } from "../../models/order.model.js";
import { User, UserRoles } from "../../models/user.model.js";
import { computePartnerPerformance } from "../../services/partnerPerformance.service.js";
import { env } from "../../config/env.js";
import { isValidEmail, isValidPhone, resolveAddress } from "../../utils/accountFields.js";
import { changePartnerStatus } from "../../services/partnerStatus.service.js";
import { changePartnerAvailability } from "../../services/partnerAvailability.service.js";
import { CustomError } from "./shared.js";

export const createPartner = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      partnerName,
      contactName,
      name,
      companyName,
      email,
      phone,
      regions,
      address,
      status
    } = req.body;

    const resolvedCompanyName = (typeof partnerName === "string" && partnerName.trim())
      || (typeof companyName === "string" && companyName.trim())
      || (typeof name === "string" && name.trim())
      || "";
    const resolvedContactName = (typeof contactName === "string" && contactName.trim())
      || (typeof name === "string" && name.trim())
      || resolvedCompanyName;

    if (!resolvedCompanyName) {
      const error = new Error("partnerName is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (typeof email !== "string" || !email.trim()) {
      const error = new Error("email is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    /*
     * Name and email are the whole requirement.
     *
     * Everything else — phone, address, service areas — is the
     * partner's own information, and they know it better than whoever is typing
     * the form. They fill it in after they set their password. Nothing can be
     * assigned to them before an admin approves them anyway, which is where
     * completeness is checked.
     */

    /*
     * Scoped to partners. One address may hold an account per role now, so an
     * admin adding a print partner must not be blocked because that person also
     * shops on the store — which is exactly the case an unscoped check refused.
     */
    const existingUser = await User.findOne({ email, role: UserRoles.PRINTER });
    if (existingUser) {
      const error = new Error("Partner with this email already exists") as CustomError;
      error.statusCode = 409;
      throw error;
    }

    const unusableSecret = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(unusableSecret, 10);

    const inviteToken = crypto.randomBytes(32).toString("hex");
    const inviteTokenHash = crypto.createHash("sha256").update(inviteToken).digest("hex");

    /**
     * Validated here, not only in the form.
     *
     * The console checks all of this, but the endpoint accepted anything: a
     * region of "Atlantis", an email of "not-an-email", no address, a state of
     * "ZZ", a negative sheet size. None of it errors — it produces a partner
     * that is quietly broken:
     *
     *  - a region that does not normalize makes them unassignable, because
     *    `normalizeRegion` returns null and a null region blocks assignment
     *  - an unresolvable state means no region and an infinite distance, so
     *    they rank last in their own region forever
     *  - a malformed email means they can never be contacted or sign in
     *
     * A form is a convenience, not a boundary. This is the boundary.
     */
    // The shared validator, so this rule and public registration's cannot drift.
    if (!isValidEmail(String(email).trim())) {
      const error = new Error("A valid email address is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    /*
     * Same shape check as public signup. This endpoint required phone to be
     * present but never checked what was in it, so "1" or "abc" created a
     * partner with an unreachable contact number.
     */
    if (typeof phone === "string" && phone.trim() && !isValidPhone(phone)) {
      const error = new Error("Enter a valid phone number") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const suppliedRegions = Array.isArray(regions) ? regions : [];
    const normalizedRegions = suppliedRegions
      .map((r: any) => normalizeRegion(String(r).trim()))
      .filter(Boolean) as string[];
    if (normalizedRegions.length !== suppliedRegions.length) {
      const unknown = suppliedRegions.filter((r: any) => !normalizeRegion(String(r).trim()));
      const error = new Error(
        `Unrecognised service area(s): ${unknown.join(", ")}. Must be one of West, Midwest, South, Northeast.`,
      ) as CustomError;
      error.statusCode = 400;
      throw error;
    }

    /*
     * The address is optional now, but if one is given it must be usable: a
     * state that resolves to no region means no ranking distance and no
     * shipping origin, which is worse than having no address at all because it
     * looks complete.
     */
    const hasAddress = Boolean(address && typeof address === "object" && String(address.street || "").trim());
    if (hasAddress) {
      if (!getRegionFromState(String(address.state || ""))) {
        const error = new Error(
          `'${address.state}' is not a US state this platform serves`,
        ) as CustomError;
        error.statusCode = 400;
        throw error;
      }
      if (!String(address.city || "").trim() || !String(address.postalCode || "").trim()) {
        const error = new Error("Business address needs a city and a postal code") as CustomError;
        error.statusCode = 400;
        throw error;
      }
    }

    /*
     * An admin adding a partner IS the approval — they already vouched for them
     * off-platform. Defaulting to Pending made the invitation a dead end: the
     * partner set their password from the invite email and then hit "Your
     * account is pending approval" at sign-in, with no way to fill in the
     * business details the admin deliberately left for them to complete.
     *
     * Partners who sign up on their own still land in Pending (see
     * `registerUser`) and still need approving — that is the Approvals queue.
     */
    const allowedStatuses = ["Active", "Pending", "Suspended", "Under Review"];
    const resolvedStatus = (typeof status === "string" && allowedStatuses.includes(status)) ? status : "Active";

    /**
     * A partner created without an address is quietly degraded, not broken —
     * which is worse, because nothing reports it:
     *
     *  - `predictShippingOrigin` needs a postcode, so rates for their region
     *    fall back to the configured warehouse instead of shipping from them.
     *  - `createShipStationLabel` uses `businessAddress` as the ship-from, so
     *    their labels declare the wrong origin.
     *  - candidate ranking sorts nearest-first on a state centroid; with no
     *    state the distance is Infinity, so they are always chosen last within
     *    their own region.
     *
     * Stored in both fields because both are read: `businessAddress` for the
     * label, `defaultShippingAddress` for region and distance.
     */
    const resolvedPartnerAddress =
      address && typeof address === "object"
        ? await resolveAddress({
            street: String(address.street || "").trim(),
            city: String(address.city || "").trim(),
            state: String(address.state || "").trim().toUpperCase(),
            postalCode: String(address.postalCode || "").trim(),
            country: String(address.country || "US").trim(),
          })
        : null;

    const partnerAddress = resolvedPartnerAddress
      ? {
          ...resolvedPartnerAddress.address,
          ...(resolvedPartnerAddress.coordinates
            ? { coordinates: resolvedPartnerAddress.coordinates }
            : {}),
        }
      : null;

    /*
     * The admin picks service areas explicitly, so those stay authoritative.
     * `detectedRegion` records what the address itself resolves to, which is a
     * different fact and the one both profile screens display.
     */
    const partnerDetectedRegion = resolvedPartnerAddress?.region ?? null;

    const newPartner = new User({
      name: resolvedContactName,
      companyName: resolvedCompanyName,
      email: String(email).trim(),
      phone: String(phone).trim(),
      regions: normalizedRegions,
      role: UserRoles.PRINTER,
      status: resolvedStatus,
      passwordHash,
      /*
       * Stored in the reset-password fields rather than a new pair, so the
       * existing `POST /auth/reset-password` consumes an invite unchanged. A
       * 7-day window because this is an invitation, not a password recovery —
       * the 15 minutes used for recovery would expire before most people read
       * their email.
       */
      resetPasswordTokenHash: inviteTokenHash,
      resetPasswordExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      /*
       * Opens the trail, recording that this partner exists because an admin
       * added them rather than because they applied — which is also why they
       * start Active rather than Pending.
       */
      statusHistory: [
        {
          from: null,
          to: resolvedStatus,
          reason: "Added by an admin",
          at: new Date(),
          byId: req.user?.id || null,
          byName: req.user?.name || req.user?.email || null,
          notified: false,
        },
      ],
      ...(partnerAddress
        ? { businessAddress: partnerAddress, defaultShippingAddress: partnerAddress }
        : {}),
      ...(partnerDetectedRegion ? { detectedRegion: partnerDetectedRegion } : {}),
      settings: {
        /*
         * No per-partner pricing is written. Every partner is paid at the one
         * network rate from Settings -> General, resolved at payout time by
         * `getPartnerPayRate`. A copy stored here would be a second source of
         * truth free to drift from it.
         */
      }
    });

    await newPartner.save();

    const inviteUrl = `${env.printerAppUrl.replace(/\/$/, "")}/set-password?inviteToken=${encodeURIComponent(inviteToken)}`;
    const invite = await sendEmail({
      to: String(email).trim(),
      subject: "You have been added to Space Transfers",
      html: `
        <p>Hello ${resolvedContactName || resolvedCompanyName},</p>
        <p>${resolvedCompanyName} has been added to Space Transfers as a print partner.</p>
        <p>Set your password to get started — the link is valid for 7 days:</p>
        <p><a href="${inviteUrl}">Set your password</a></p>
        <p>Once you are in, please check that your business address is correct — we
          route work by region, so it decides which orders reach you. We cannot send you
          work until your account has been approved.</p>
      `,
    }).catch((e: any) => ({ sent: false, messageId: null, error: e?.message || "send failed" }));

    if (!invite.sent) {
      // Loud, because the partner cannot sign in until this reaches them — and
      // silence here is exactly how the previous version hid the same problem.
      console.error(
        `[PARTNER_INVITE] could not email ${email} — they cannot set a password until this is fixed. ` +
          `Reason: ${invite.error || "no email transport configured"}`,
      );
    } else {
      console.log(`[PARTNER_INVITE] invite sent to ${email}`);
    }

    res.status(201).json({
      id: newPartner._id,
      status: newPartner.status,
      /*
       * Whether the invitation actually reached them, and the link itself when
       * it did not.
       *
       * A failed send was written to the server log and nowhere else: the
       * console showed "Partner created", the admin had no idea the email had
       * not gone out, and the link existed only inside an email that was never
       * sent — so the partner could never set a password and nothing on screen
       * said why. The URL is returned only on failure, so it is there exactly
       * when someone needs to pass it on by hand and not in the ordinary case.
       */
      invite: {
        sent: invite.sent === true,
        reason: invite.sent ? undefined : invite.error || "no email transport configured",
        url: invite.sent ? undefined : inviteUrl,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const listPartners = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, region, search, cursor, limit = "20" } = req.query;
    const pageSize = parseInt(limit as string);

    const matchQuery: any = { role: UserRoles.PRINTER };

    if (status) {
      matchQuery.status = status;
    }

    if (region) {
      matchQuery.regions = String(region);
    }

    if (search) {
      // Escaped: the raw value was compiled straight into a RegExp, so a single
      // "[" typed into the search box threw and returned a 500.
      const searchRegex = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      matchQuery.$or = [
        { name: searchRegex },
        { companyName: searchRegex },
        { email: searchRegex }
      ];
    }

    const pipeline: any[] = [
      { $match: matchQuery },
      {
        $lookup: {
          from: "orders",
          let: { partnerId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$assignedPrinter", "$$partnerId"] },
                    { $eq: ["$status", "COMPLETED"] }
                  ]
                }
              }
            },
            { $count: "count" }
          ],
          as: "completedCountArr"
        }
      },
      {
        /*
         * How many jobs this partner is holding right now.
         *
         * Replaces the base/sale/profit columns, which became the same three
         * numbers on every row once pricing went network-wide. This one differs
         * per partner and is what an admin needs when deciding who to assign to.
         */
        $lookup: {
          from: "orders",
          let: { partnerId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$assignedPrinter", "$$partnerId"] },
                    { $in: ["$status", ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK"]] }
                  ]
                }
              }
            },
            { $count: "count" }
          ],
          as: "activeCountArr"
        }
      },
      {
        $addFields: {
          ordersCompleted: { $ifNull: [{ $arrayElemAt: ["$completedCountArr.count", 0] }, 0] },
          ordersInProgress: { $ifNull: [{ $arrayElemAt: ["$activeCountArr.count", 0] }, 0] }
        }
      },
      {
        $project: {
          companyName: 1,
          name: 1,
          email: 1,
          status: 1,
          availabilityStatus: 1,
          capacityPaused: 1,
          regions: 1,
          rating: 1,
          ordersCompleted: 1,
          ordersInProgress: 1,
        }
      },
      { $sort: { ordersCompleted: -1, _id: -1 } }
    ];

    if (cursor) {
      const [cursorValue, cursorId] = (cursor as string).split("_");
      pipeline.push({
        $match: {
          $or: [
            { ordersCompleted: { $lt: parseInt(cursorValue) } },
            {
              ordersCompleted: parseInt(cursorValue),
              _id: { $lt: new mongoose.Types.ObjectId(cursorId) }
            }
          ]
        }
      });
    }

    pipeline.push({ $limit: pageSize + 1 });

    const partners = await User.aggregate(pipeline);

    const hasNextPage = partners.length > pageSize;
    const results = hasNextPage ? partners.slice(0, pageSize) : partners;

    const formattedPartners = results.map(p => ({
      id: p._id,
      name: p.companyName || p.name,
      email: p.email,
      status: p.status,
      availabilityStatus: p.availabilityStatus ?? "open",
      // Carried alongside it so the console can distinguish a partner who
      // paused themselves from one the capacity monitor paused — the first
      // needs a conversation, the second clears itself.
      capacityPaused: Boolean(p.capacityPaused),
      regions: p.regions || [],
      rating: p.rating || 5.0,
      ordersCompleted: p.ordersCompleted,
      /*
       * Base price, sale price and profit removed. With one network-wide rate
       * they were the same three numbers on every row, and "profit" was a
       * per-sq-ft margin rather than this partner's contribution — which read
       * like a partner-level figure and was not one.
       */
      ordersInProgress: Number(p.ordersInProgress ?? 0).toLocaleString(),
      orders: Number(p.ordersCompleted ?? 0).toLocaleString()
    }));

    let nextCursor = null;
    if (hasNextPage) {
      const lastPartner = results[results.length - 1];
      nextCursor = `${lastPartner.ordersCompleted}_${lastPartner._id}`;
    }

    res.status(200).json({
      partners: formattedPartners,
      nextCursor
    });
  } catch (error) {
    next(error);
  }
};

export const getPartnerById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOne({ _id: partnerIdString, role: UserRoles.PRINTER })
      .select("-passwordHash")
      .lean();

    if (!partner) {
      const error = new Error("Partner not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const ordersCompleted = await Order.countDocuments({
      assignedPrinter: partnerIdString,
      status: "COMPLETED"
    });

    /*
     * Moved to `partnerPerformance.service`. The partner's own Profile page
     * showed invented figures for these same two ideas — a stored
     * `user.performance` object nothing ever writes — so both sides read one
     * computation now.
     */
    const { averageProductionHours, onTimeDeliveryRate, sampleSize: performanceSamples } =
      await computePartnerPerformance(partnerIdString);

    const detectedRegion =
      (partner as any).detectedRegion ||
      normalizeRegion(getRegionFromState((partner as any).businessAddress?.state || "")) ||
      normalizeRegion(getRegionFromState((partner.defaultShippingAddress as any)?.state || "")) ||
      (partner.regions?.[0] ?? null);

    res.status(200).json({
      id: partner._id,
      name: partner.companyName || partner.name,
      companyName: partner.companyName || partner.name,
      contactName: partner.name,
      status: partner.status,
      /*
       * Operational availability, distinct from account status above. The
       * console rendered neither this nor the live broadcast the server was
       * already sending, so a partner who paused themselves looked fully
       * available to the admin deciding where to route work.
       */
      availabilityStatus: (partner as any).availabilityStatus ?? "open",
      capacityPaused: Boolean((partner as any).capacityPaused),
      statusHistory: [...(((partner as any).statusHistory || []) as any[])]
        .reverse()
        .slice(0, 20)
        .map((h) => ({
          from: h.from || null,
          to: h.to,
          reason: h.reason || null,
          at: h.at,
          by: h.byName || null,
          notified: h.notified === true,
        })),
      regions: partner.regions || [],
      detectedRegion,
      /*
       * Where they print from. The detail page rendered a hardcoded "N/A" here
       * and the endpoint never sent an address at all, so a partner who gave a
       * full address at signup was shown as having none — on the same screen
       * that decides whether they can be routed work.
       *
       * `businessAddress` first: that is the ship-from on a label. It falls back
       * to the shipping address, which is what signup fills in.
       */
      address: (() => {
        const a = (partner as any).businessAddress || (partner as any).defaultShippingAddress || null;
        if (!a) return null;
        return {
          street: a.street || null,
          city: a.city || null,
          state: a.state || null,
          postalCode: a.postalCode || null,
          country: a.country || null,
        };
      })(),
      ordersCompleted,
      averageProductionHours,
      onTimeDeliveryRate,
      // Measured against how many finished jobs, so the console can say "from
      // 3 orders" rather than presenting one data point as a track record.
      performanceSampleSize: performanceSamples,
      rating: partner.rating || 5.0,
      email: partner.email,
      phone: partner.phone || "N/A",
      website: partner.website || "N/A",
      businessType: (partner as any).businessDetails?.businessType || null
    });
  } catch (error) {
    next(error);
  }
};

export const getPartnerOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { status, cursor, limit = "20" } = req.query;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const query: any = { assignedPrinter: partnerIdString };

    if (status) {
      query.status = resolveOrderStatusInput(status) ?? String(status).toUpperCase();
    }

    if (cursor) {
      const [cursorTime, cursorId] = (cursor as string).split("_");
      query.$or = [
        { createdAt: { $lt: new Date(Number(cursorTime)) } },
        { 
          createdAt: new Date(Number(cursorTime)), 
          _id: { $lt: cursorId } 
        }
      ];
    }

    const pageSize = parseInt(limit as string);
    const orders = await Order.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasNextPage = orders.length > pageSize;
    const results = hasNextPage ? orders.slice(0, pageSize) : orders;

    const formattedOrders = results.map(order => ({
      id: order._id,
      displayId: (order as any).displayId || null,
      status: order.status,
      customer: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
      total: order.pricing?.total || 0,
      createdAt: order.createdAt
    }));

    let nextCursor = null;
    if (hasNextPage) {
      const lastOrder = results[results.length - 1];
      nextCursor = `${lastOrder.createdAt.getTime()}_${lastOrder._id}`;
    }

    res.status(200).json({
      orders: formattedOrders,
      nextCursor
    });
  } catch (error) {
    next(error);
  }
};

export const updatePartner = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const { regions } = req.body ?? {};

    if (!Array.isArray(regions) || regions.length === 0) {
      const error = new Error("regions must be a non-empty array") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const normalizedRegions = regions
      .map((r: any) => normalizeRegion(String(r).trim()))
      .filter(Boolean) as string[];
    if (normalizedRegions.length !== regions.length) {
      const unknown = regions.filter((r: any) => !normalizeRegion(String(r).trim()));
      const error = new Error(
        `Unrecognised service area(s): ${unknown.join(", ")}. Must be one of West, Midwest, South, Northeast.`,
      ) as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const partner = await User.findOneAndUpdate(
      { _id: partnerIdString, role: UserRoles.PRINTER },
      { $set: { regions: normalizedRegions } },
      { new: true, runValidators: true }
    ).select("-passwordHash");

    if (!partner) {
      const error = new Error("Partner not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      id: partner._id,
      updated: true
    });
  } catch (error) {
    next(error);
  }
};

/**
 * An admin setting a partner's availability.
 *
 * Distinct from `updatePartnerStatus`: that is an account judgement that blocks
 * sign-in, this is operational — whether the partner is currently taking work.
 * An admin needs it to pull someone out of rotation without suspending them,
 * for instance while a quality issue is being discussed.
 *
 * Unlike the partner's own endpoint, an admin may reopen someone who is at
 * capacity: that is a deliberate act by a person who can see the whole network,
 * not a partner accidentally over-committing themselves.
 */
export const updatePartnerAvailability = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { status, reason } = req.body || {};

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : (partnerId as string);
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (status !== "open" && status !== "paused") {
      const error = new Error("status must be one of: open, paused") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const result = await changePartnerAvailability({
      partnerId: partnerIdString,
      to: status,
      reason: typeof reason === "string" ? reason : null,
      actor: { id: req.user?.id, name: req.user?.name || req.user?.email, kind: "admin" },
    });

    if (!result) {
      const error = new Error("Partner not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      partnerId: partnerIdString,
      availabilityStatus: result.availabilityStatus,
      capacityLocked: result.capacityLocked,
      // Always false after a manual change — the console reads it to decide
      // whether to label the pill "at capacity", and an absent field there
      // would quietly become `false` by accident rather than by fact.
      capacityPaused: result.capacityPaused,
      activeJobs: result.activeJobs,
      maxJobs: result.maxJobs,
      // Whether the partner's in-app notification was created, so the console
      // can say plainly if they were not told.
      notified: result.partnerNotified,
      notifyError: result.partnerNotifyError,
    });
  } catch (error) {
    next(error);
  }
};

export const updatePartnerStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { status, reason } = req.body;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    /*
     * "Rejected" is deliberately not settable here. It is the outcome of
     * declining a pending application, not a state to move a real partner into
     * — that is what Suspended is for. Offering both on one dropdown would make
     * the difference a matter of which word an admin happened to pick.
     */
    if (!["Active", "Suspended", "Under Review", "Pending"].includes(status)) {
      const error = new Error("Invalid status. Allowed values: Active, Suspended, Under Review, Pending") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    /*
     * And rejection is terminal. A suspension is a pause the network can lift;
     * a rejection is a declined application, and reinstating one through a
     * status dropdown would quietly undo an approval decision without ever
     * passing back through the approvals queue.
     */
    const existingPartner = await User.findOne({ _id: partnerIdString, role: UserRoles.PRINTER })
      .select("status")
      .lean();
    if (existingPartner?.status === "Rejected") {
      const error = new Error(
        "This application was rejected and cannot be reinstated here. They can re-apply from the partner sign-up page, which starts a fresh application."
      ) as CustomError;
      error.statusCode = 409;
      throw error;
    }

    if (status === "Suspended" && (typeof reason !== "string" || reason.trim().length < 3)) {
      const error = new Error("A reason is required when suspending a partner") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const result = await changePartnerStatus({
      partnerId: partnerIdString,
      to: status,
      reason: typeof reason === "string" ? reason : null,
      // Anything but Rejected, which the check above already refuses.
      expectedFrom: ["Active", "Suspended", "Under Review", "Pending"],
      actor: { id: req.user?.id, name: req.user?.name || req.user?.email },
    });

    if (!result) {
      const error = new Error("Partner not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      id: result.partner._id,
      status: result.partner.status,
      notified: result.notified,
      notifyError: result.notifyError,
      updated: true
    });
  } catch (error) {
    next(error);
  }
};

export const listPendingPrinters = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printers = await User.find({ role: UserRoles.PRINTER, status: "Pending" })
      .select("name companyName email phone createdAt regions defaultShippingAddress businessAddress statusHistory")
      .sort({ createdAt: -1 })
      .lean();

    /*
     * Who else is already registered at each of these addresses.
     *
     * Sharing one is not itself wrong — industrial units and co-working
     * buildings hold several businesses — so this does not block a signup. But
     * it is the shape both duplicate registration and rejection-evasion take,
     * and the approval screen is the one moment a person is deciding about this
     * applicant. Three accounts for the same company already sit at one address
     * in this database, all approved, because nothing ever surfaced it.
     *
     * Fetched in one query keyed by street and postcode rather than per row.
     */
    const addressKey = (a: any) =>
      a && a.street && a.postalCode
        ? `${String(a.street).trim().toLowerCase()}|${String(a.postalCode).trim().toLowerCase()}`
        : null;

    const pendingKeys = printers
      .map((p: any) => addressKey(p.defaultShippingAddress || p.businessAddress))
      .filter(Boolean) as string[];

    const neighboursByKey = new Map<string, Array<{ companyName: string; status: string }>>();
    if (pendingKeys.length > 0) {
      const others = await User.find({
        role: UserRoles.PRINTER,
        _id: { $nin: printers.map((p: any) => p._id) },
      })
        .select("companyName name status defaultShippingAddress businessAddress")
        .lean();

      for (const other of others as any[]) {
        const key = addressKey(other.defaultShippingAddress || other.businessAddress);
        if (!key || !pendingKeys.includes(key)) continue;
        const list = neighboursByKey.get(key) || [];
        list.push({
          companyName: other.companyName || other.name || "Unnamed partner",
          status: other.status || "Unknown",
        });
        neighboursByKey.set(key, list);
      }
    }

    const formattedPrinters = printers.map(p => {
      const address = (p as any).defaultShippingAddress || (p as any).businessAddress || null;
      const key = addressKey(address);
      return {
        id: p._id,
        name: p.name,
        companyName: p.companyName,
        email: p.email,
        phone: p.phone,
        createdAt: p.createdAt,
        // Null rather than a guess: geocoding can fail, and registration stores
        // no region when it does. "Unknown" on screen is honest; a wrong region
        // would route real work to the wrong side of the country.
        region: resolvePartnerRegion(p),
        location: address ? [address.city, address.state].filter(Boolean).join(", ") || null : null,
        /** Other partners at the same street and postcode. Empty when none. */
        sameAddressPartners: (key && neighboursByKey.get(key)) || [],
        /*
         * A previous rejection of this same account, now that a declined
         * applicant can re-apply with the address they used before. Without it
         * a re-application is indistinguishable from a first one, and the
         * approver repeats a decision someone already made.
         */
        priorRejection: (() => {
          const history = ((p as any).statusHistory || []) as any[];
          const last = [...history].reverse().find((h) => h.to === "Rejected");
          if (!last) return null;
          return {
            at: last.at,
            reason: last.reason || null,
            by: last.byName || null,
          };
        })()
      };
    });

    res.status(200).json(formattedPrinters);
  } catch (error) {
    next(error);
  }
};

export const approvePrinter = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { reason } = req.body || {};

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const result = await changePartnerStatus({
      partnerId: partnerIdString,
      to: "Active",
      reason: typeof reason === "string" ? reason : null,
      expectedFrom: "Pending",
      actor: { id: req.user?.id, name: req.user?.name || req.user?.email },
    });

    if (!result) {
      const existing = await User.findOne({ _id: partnerIdString, role: UserRoles.PRINTER })
        .select("status")
        .lean();
      const error = new Error(
        existing
          ? `This printer is already ${existing.status}, not awaiting approval. Refresh the queue.`
          : "Printer not found"
      ) as CustomError;
      error.statusCode = existing ? 409 : 404;
      throw error;
    }

    res.status(200).json({
      id: result.partner._id,
      status: result.partner.status,
      notified: result.notified,
      notifyError: result.notifyError,
      message: "Printer approved successfully"
    });
  } catch (error) {
    next(error);
  }
};

export const rejectPrinter = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { reason } = req.body || {};

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (typeof reason !== "string" || reason.trim().length < 3) {
      const error = new Error("A reason is required when rejecting an application") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const result = await changePartnerStatus({
      partnerId: partnerIdString,
      to: "Rejected",
      reason,
      expectedFrom: "Pending",
      actor: { id: req.user?.id, name: req.user?.name || req.user?.email },
    });

    if (!result) {
      const existing = await User.findOne({ _id: partnerIdString, role: UserRoles.PRINTER })
        .select("status")
        .lean();
      const error = new Error(
        existing
          ? `This printer is already ${existing.status}, not awaiting approval. Refresh the queue.`
          : "Printer not found"
      ) as CustomError;
      error.statusCode = existing ? 409 : 404;
      throw error;
    }

    res.status(200).json({
      id: result.partner._id,
      status: result.partner.status,
      notified: result.notified,
      notifyError: result.notifyError,
      message: "Printer registration rejected"
    });
  } catch (error) {
    next(error);
  }
};
