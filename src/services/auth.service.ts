import { User, UserRoles, UserRole } from "../models/user.model.js";
import { buildLegalAcceptance, type LegalAcceptanceInput, type LegalAcceptanceRecord } from "../config/legal.js";
import { getRegionFromState, getRegionFromCoords, normalizeRegion } from "../utils/region.js";
import { isUSCountry } from "../utils/geocoding.js";
import { isValidEmail, resolveAddress } from "../utils/accountFields.js";
import { hashPassword, verifyPassword } from "../utils/passwords.js";
import { signJwt } from "../utils/jwt.js";
import crypto from "crypto";
import { env } from "../config/env.js";
import nodemailer from "nodemailer";
import { sendEmail } from "./email.service.js";
import { notifyAllAdmins } from "./adminNotifications.service.js";
import { OAuth2Client } from "google-auth-library";
import dotenv from "dotenv";

interface RegisterParams {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
  companyName?: string;
  phone?: string;
  region?: string;
  website?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  /** Required. Registration is refused without both acknowledgements. */
  legalAcceptance?: LegalAcceptanceInput;
  /** Audit context, supplied by the controller from the request. */
  legalContext?: { ip?: string; userAgent?: string };
}

interface UserResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  companyName?: string;
  phone?: string;
  website?: string;
  avatarUrl?: string | null;
  status?: string;
  isSubAccount?: boolean;
  parentAccount?: string | null;
  region?: string;
  regions?: string[];
  isGoogleAccount?: boolean;
}

interface AuthResponse {
  user: UserResponse;
  token: string;
}

const buildCustomerWelcomeEmailHtml = (name: string) => {
  const safeName = String(name || "").trim() || "there";
  const appUrl = env.appUrl.replace(/\/$/, "");

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
      <h2 style="margin: 0 0 12px 0;">Welcome, ${safeName}!</h2>
      <p style="margin: 0 0 12px 0;">Your Space Transfers account is ready.</p>
      <div style="margin: 0 0 16px 0; padding: 12px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px;">
        <div style="font-weight: 600; margin: 0 0 6px 0;">Getting started</div>
        <div style="margin: 0 0 6px 0;">1) Create a new gang sheet and upload your images</div>
        <div style="margin: 0 0 6px 0;">2) Arrange your items and maximize your sheet space</div>
        <div style="margin: 0 0 6px 0;">3) Add to cart and checkout</div>
      </div>
      <p style="margin: 0 0 16px 0;">
        <a href="${appUrl}" style="display: inline-block; padding: 10px 14px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 10px;">
          Start Designing
        </a>
      </p>
      <p style="margin: 0; font-size: 12px; color: #6b7280;">
        This is a welcome email only. No verification is required.
      </p>
    </div>
  `;
};

export const registerUser = async ({
  name,
  email,
  password,
  role,
  companyName,
  phone,
  region,
  website,
  address,
  legalAcceptance,
  legalContext
}: RegisterParams): Promise<AuthResponse> => {
  // Validated before anything else: an account must never come into existence
  // without its acceptance record, so this runs ahead of the duplicate-email
  // check and every other validation.
  const acceptanceRecord = buildLegalAcceptance(legalAcceptance, legalContext || {});

  /*
   * Format checked here, using the same rule the console's create-partner path
   * has always applied. Public registration had none at all: "not-an-email",
   * "no-at-sign.com" and "spaces in@email.com" each produced a working account
   * that could never receive verification, an invitation or a reset — so it was
   * unreachable the moment its password was forgotten.
   */
  if (!isValidEmail(email)) {
    const error = new Error("A valid email address is required") as any;
    error.statusCode = 400;
    throw error;
  }

  const SELF_REGISTERABLE_ROLES: UserRole[] = [UserRoles.CUSTOMER, UserRoles.PRINTER];
  if (role && !SELF_REGISTERABLE_ROLES.includes(role)) {
    const error = new Error("That account type cannot be created through registration.") as any;
    error.statusCode = 403;
    throw error;
  }
  const resolvedRole = role && SELF_REGISTERABLE_ROLES.includes(role) ? role : UserRoles.CUSTOMER;

  /*
   * Scoped to the role being registered.
   *
   * Uniqueness is on the pair now, so the same address may hold one account of
   * each kind — an admin who also runs a print shop, a partner who also buys.
   * Checking the address alone made the first account someone created a
   * permanent claim on it.
   */
  const existing = await User.findOne({ email, role: resolvedRole });
  /*
   * A rejected applicant may re-apply with the same address.
   *
   * The account still holds the email, so "Email already in use" turned a
   * declined application into a permanent ban on that address — which is not
   * what rejection is meant to mean, and left the only route back as inventing
   * a second mailbox. Re-applying resets the existing record to Pending with
   * the new details, and `statusHistory` carries the previous rejection and its
   * reason into the queue, so the approver sees the history rather than a
   * stranger.
   *
   * Only from Rejected. Every other status still refuses: a Pending applicant
   * re-submitting would silently overwrite their own application, and allowing
   * it against an Active partner would be account takeover.
   */
  /*
   * Both sides must be a partner application.
   *
   * Checking only the stored role let a rejected printer re-register as a
   * customer: the payload's `role: CUSTOMER` was merged straight onto their
   * record, silently converting the account and carrying the partner status
   * history onto a customer. Requiring the incoming role to match keeps
   * re-application to what it is for, and anything else gets the ordinary
   * "email already in use".
   */
  const isReapplication =
    existing &&
    existing.status === "Rejected" &&
    existing.role === UserRoles.PRINTER &&
    resolvedRole === UserRoles.PRINTER;
  if (existing && !isReapplication) {
    const error = new Error("Email already in use") as any;
    error.statusCode = 400;
    throw error;
  }

  if (password.length < 8) {
    const error = new Error("Password must be at least 8 characters long") as any;
    error.statusCode = 400;
    throw error;
  }

  const passwordHash = await hashPassword(password);

  /**
   * Public registration covers customers and print partners only.
   *
   * ADMIN is refused outright rather than quietly downgraded: this endpoint is
   * unauthenticated, so honouring `role: "ADMIN"` let anyone who could reach it
   * mint themselves an account with full access to pricing, partner management
   * and payouts. Admin accounts are provisioned directly against the database,
   * and the admin console has no sign-up screen to match.
   *
   * Silently downgrading instead would create a CUSTOMER for someone who asked
   * for an ADMIN and believes they got one — an error is the honest answer.
   */

  // Validate required fields based on role
  if (resolvedRole === UserRoles.PRINTER) {
    if (!companyName) {
      const error = new Error("Business Name is required for Printer registration") as any;
      error.statusCode = 400;
      throw error;
    }
    if (!phone) {
      const error = new Error("Phone Number is required for Printer registration") as any;
      error.statusCode = 400;
      throw error;
    }
    if (!address || !address.street || !address.city || !address.state || !address.postalCode || !address.country) {
      const error = new Error("Address is required for Printer registration") as any;
      error.statusCode = 400;
      throw error;
    }
  } else if (resolvedRole === UserRoles.ADMIN) {
    if (!companyName || !phone) {
      const error = new Error("Company Name and Phone Number are required for Admin registration") as any;
      error.statusCode = 400;
      throw error;
    }
  }

  const initialStatus = resolvedRole === UserRoles.PRINTER ? "Pending" : "Active";
  const userPayload: any = {
    name,
    email,
    passwordHash,
    role: resolvedRole,
    status: initialStatus,
    legalAcceptance: acceptanceRecord,
    /*
     * The trail starts at creation, so a partner's history is complete rather
     * than beginning at whatever happened to them first. Without it the record
     * reads as though they appeared already Pending.
     */
    statusHistory: [
      {
        from: null,
        to: initialStatus,
        reason: "Signed up",
        at: new Date(),
        byId: null,
        byName: null,
        notified: false,
      },
    ]
  };

  if (companyName) userPayload.companyName = companyName;
  if (phone) userPayload.phone = phone;
  if (website) userPayload.website = website;
  // ── Auto-geocode address and derive region ─────────────────────────────────
  // resolvedRegion is null when we genuinely cannot determine the region — we
  // never default to "West" because a wrong stored region causes false-positive
  // matches in the assignment service.
  let resolvedRegion: string | null = null;
  let addressCoordinates: { lat: number; lng: number } | undefined;

  if (address) {
    // Shared with the console's create-partner path, so both produce the same
    // normalised address, coordinates and region rather than two versions of it.
    const resolved = await resolveAddress(address);
    address = resolved.address;
    addressCoordinates = resolved.coordinates;
    resolvedRegion = resolved.region;

    console.log(
      `[region-assign] role=${resolvedRole} state=${address.state} ` +
      `region=${resolvedRegion ?? "null"} geocoded=${resolved.geocoded}`
    );

    /*
     * A print partner with no region is invisible to assignment, which filters
     * on exactly that — so the account would sit approved and never receive a
     * single job, with nothing anywhere reporting why. An unresolvable address
     * is refused at the door instead, naming the fields to check.
     */
    if (resolvedRole === UserRoles.PRINTER && !resolvedRegion) {
      const error = new Error(
        "We could not determine a service region from that address. Please check the state and postal code.",
      ) as any;
      error.statusCode = 400;
      throw error;
    }
  } else {
    // No address provided — only accept a region hint if it normalizes cleanly.
    // Never default to "West": an unknown region is better than a wrong one.
    resolvedRegion = normalizeRegion(region) ?? null;
  }

  if (resolvedRegion) {
    userPayload.regions = [resolvedRegion];
    userPayload.detectedRegion = resolvedRegion;
  }

  if (address) {
    const addressData: any = {
      street:     String(address.street     || ""),
      city:       String(address.city       || ""),
      state:      String(address.state      || ""),
      postalCode: String(address.postalCode || ""),
      country:    String(address.country    || ""),
    };
    if (addressCoordinates) addressData.coordinates = addressCoordinates;

    userPayload.defaultShippingAddress = addressData;

    if (resolvedRole === UserRoles.PRINTER) {
      userPayload.businessAddress = { ...addressData, verified: false };
    }
  }

  let user;
  if (isReapplication && existing) {
    /*
     * Updated in place rather than deleted and recreated, so the prior
     * rejection stays attached to the same record. A fresh document would look
     * to the approver exactly like a first-time applicant.
     */
    /*
     * The prior history is captured before the merge and restored after it.
     *
     * `userPayload` carries its own opening `statusHistory` entry for a brand
     * new account, so assigning it wholesale overwrote the record this whole
     * branch exists to preserve — the earlier rejection vanished, and the queue
     * showed a re-application as a first-time applicant.
     */
    const priorHistory = [...(((existing as any).statusHistory || []) as any[])];
    Object.assign(existing, userPayload);
    (existing as any).statusHistory = [
      ...priorHistory,
      {
        from: "Rejected",
        to: "Pending",
        reason: "Re-applied after rejection",
        at: new Date(),
        byId: null,
        byName: null,
        notified: false,
      },
    ];
    // A previous rejection must not carry over as a live reset token.
    (existing as any).resetPasswordTokenHash = null;
    (existing as any).resetPasswordExpiresAt = null;
    user = await existing.save();
  } else {
    user = await User.create(userPayload);
  }

  const isPending = user.status === "Pending";
  const token = isPending ? "" : signJwt({ sub: user.id, role: user.role });

  if (resolvedRole === UserRoles.PRINTER) {
    notifyAllAdmins({
      category: "partners",
      priority: "low",
      title: "New printer signup",
      message: `${user.companyName || user.name} • ${user.email}`,
      meta: { partnerId: user.id, status: user.status, region: user.regions?.[0] || null }
    }).catch(() => {});
  }

  if (resolvedRole === UserRoles.CUSTOMER) {
    const attemptedAt = new Date();
    let status: "sent" | "skipped" | "failed" = "skipped";
    let sentAt: Date | null = null;
    let error: string | null = null;
    let messageId: string | null = null;

    try {
      const sendResult = await Promise.race([
        sendEmail({
          to: user.email,
          subject: "Welcome to Space Transfers",
          html: buildCustomerWelcomeEmailHtml(user.name)
        }),
        new Promise<{ sent: boolean; messageId: string | null; error: string | null }>((_, reject) =>
          setTimeout(() => reject(new Error("welcome_email_timeout")), 25_000)
        )
      ]);

      messageId = sendResult.messageId;
      if (sendResult.sent) {
        status = "sent";
        sentAt = new Date();
      } else {
        status = sendResult.error ? "failed" : "skipped";
        error = sendResult.error;
      }
    } catch (e: any) {
      status = "failed";
      error = e?.message ? String(e.message) : "welcome_email_failed";
    }

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          welcomeEmail: {
            status,
            attemptedAt,
            sentAt,
            error,
            messageId
          }
        }
      }
    );
  }

  const userResponse: UserResponse = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl || null,
    status: user.status,
    isGoogleAccount: !!user.googleId,
  };

  if (user.companyName) userResponse.companyName = user.companyName;
  if (user.phone) userResponse.phone = user.phone;
  if (user.website) userResponse.website = user.website;
  if (user.regions && user.regions.length > 0) {
    userResponse.region = user.regions[0];
    userResponse.regions = user.regions;
  }

  return {
    user: userResponse,
    token
  };
};

export const getCurrentUser = async (userId: string): Promise<UserResponse> => {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error("User not found") as any;
    error.statusCode = 404;
    throw error;
  }

  const userResponse: UserResponse = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl || null,
    status: user.status,
    isGoogleAccount: !!user.googleId,
  };

  if (user.companyName) userResponse.companyName = user.companyName;
  if (user.phone) userResponse.phone = user.phone;
  if (user.website) userResponse.website = user.website;
  if (user.regions && user.regions.length > 0) {
    userResponse.region = user.regions[0];
    userResponse.regions = user.regions;
  }

  return userResponse;
};

export const listSubAccounts = async (userId: string): Promise<UserResponse[]> => {
  const currentUser = await User.findById(userId);
  if (!currentUser) {
    const error = new Error("User not found") as any;
    error.statusCode = 404;
    throw error;
  }

  const parentId = currentUser.isSubAccount
    ? currentUser.parentAccount
    : currentUser._id;

  if (!parentId) {
    const error = new Error("Account relationship is invalid") as any;
    error.statusCode = 400;
    throw error;
  }

  const linkedUsers = await User.find({
    $or: [{ _id: parentId }, { parentAccount: parentId }],
  }).select("name email role companyName phone parentAccount isSubAccount avatarUrl googleId");

  const currentId = currentUser._id.toString();

  return linkedUsers
    .filter((u) => u._id.toString() !== currentId)
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyName: user.companyName,
      phone: user.phone,
      isSubAccount: Boolean((user as any).isSubAccount),
      parentAccount: (user as any).parentAccount ? String((user as any).parentAccount) : null,
      avatarUrl: (user as any).avatarUrl || null,
      isGoogleAccount: !!(user as any).googleId,
    }));
};

export const createSubAccount = async (parentId: string, subAccountData: RegisterParams): Promise<AuthResponse> => {
  const parent = await User.findById(parentId);
  if (!parent) {
    const error = new Error("Parent user not found") as any;
    error.statusCode = 404;
    throw error;
  }

  const actualParentId = parent.isSubAccount ? parent.parentAccount : parent._id;
  if (!actualParentId) {
    const error = new Error("Parent account relationship is invalid") as any;
    error.statusCode = 400;
    throw error;
  }

  const linkedCount = await User.countDocuments({
    $or: [{ _id: actualParentId }, { parentAccount: actualParentId }]
  });
  if (linkedCount >= 5) {
    const error = new Error("Linked accounts limit reached (max 5).") as any;
    error.statusCode = 400;
    throw error;
  }

  // Sub-accounts are always CUSTOMER, so the clash that matters is another
  // customer on this address.
  const existing = await User.findOne({ email: subAccountData.email, role: UserRoles.CUSTOMER });
  if (existing) {
    const error = new Error("Email already in use") as any;
    error.statusCode = 400;
    throw error;
  }

  if (subAccountData.password.length < 8) {
    const error = new Error("Password must be at least 8 characters long") as any;
    error.statusCode = 400;
    throw error;
  }

  const passwordHash = await hashPassword(subAccountData.password);

  const subAccount = await User.create({
    name: subAccountData.name,
    email: subAccountData.email,
    passwordHash,
    role: UserRoles.CUSTOMER,
    companyName: subAccountData.companyName,
    phone: subAccountData.phone,
    parentAccount: actualParentId,
    isSubAccount: true
  });

  const token = signJwt({ sub: subAccount.id, role: subAccount.role });

  return {
    user: {
      id: subAccount.id,
      name: subAccount.name,
      email: subAccount.email,
      role: subAccount.role,
      companyName: subAccount.companyName
    },
    token
  };
};

export const deleteSubAccount = async (actorUserId: string, subAccountId: string): Promise<void> => {
  const actor = await User.findById(actorUserId);
  if (!actor) {
    const error = new Error("User not found") as any;
    error.statusCode = 404;
    throw error;
  }

  if (actor.isSubAccount) {
    const error = new Error("Only the main account can delete sub-accounts.") as any;
    error.statusCode = 403;
    throw error;
  }

  const sub = await User.findById(subAccountId);
  if (!sub) {
    const error = new Error("Sub-account not found") as any;
    error.statusCode = 404;
    throw error;
  }

  if (!sub.isSubAccount) {
    const error = new Error("Only sub-accounts can be deleted via this endpoint.") as any;
    error.statusCode = 400;
    throw error;
  }

  if (!sub.parentAccount || sub.parentAccount.toString() !== actor._id.toString()) {
    const error = new Error("Forbidden") as any;
    error.statusCode = 403;
    throw error;
  }

  await User.deleteOne({ _id: sub._id });
};

export const switchSubAccount = async (currentUserId: string, targetUserId: string): Promise<AuthResponse> => {
  const currentUser = await User.findById(currentUserId);
  const targetUser = await User.findById(targetUserId);

  if (!currentUser || !targetUser) {
    const error = new Error("User not found") as any;
    error.statusCode = 404;
    throw error;
  }

  // Check if they are related
  const currentParentId = currentUser.isSubAccount ? currentUser.parentAccount?.toString() : currentUser.id.toString();
  const targetParentId = targetUser.isSubAccount ? targetUser.parentAccount?.toString() : targetUser.id.toString();

  if (currentParentId !== targetParentId) {
    const error = new Error("Unauthorized to switch to this account") as any;
    error.statusCode = 403;
    throw error;
  }

  const token = signJwt({ sub: targetUser.id, role: targetUser.role });

  return {
    user: {
      id: targetUser.id,
      name: targetUser.name,
      email: targetUser.email,
      role: targetUser.role,
      companyName: targetUser.companyName,
      avatarUrl: targetUser.avatarUrl || null,
      isGoogleAccount: !!targetUser.googleId,
    },
    token
  };
};

export const loginUser = async ({
  email,
  password,
  role,
}: Partial<RegisterParams>): Promise<AuthResponse> => {
  /*
   * One address can now hold an account per role, so signing in has to say which
   * one. Each app knows: the printer portal sends PRINTER, the console ADMIN,
   * the store CUSTOMER.
   *
   * Without a role we fall back to the single account on that address — which
   * keeps every existing caller working, and only fails when it genuinely cannot
   * be resolved. Answering with whichever account happened to be found first
   * would sign someone into the wrong side of the platform.
   */
  const candidates = await User.find({ email }).limit(5);

  let user: any = null;
  if (role) {
    user = candidates.find((c: any) => c.role === role) || null;
  } else if (candidates.length === 1) {
    user = candidates[0];
  } else if (candidates.length > 1) {
    const error = new Error(
      "This email has more than one account. Please sign in from the app you are trying to reach.",
    ) as any;
    error.statusCode = 400;
    throw error;
  }

  if (!user) {
    // Deliberately the same message as a wrong password: distinguishing "no
    // such account for this role" would let anyone map which addresses hold
    // which kinds of account.
    const error = new Error("Invalid credentials") as any;
    error.statusCode = 401;
    throw error;
  }

  if (!user.passwordHash) {
    const error = new Error("This account was created with Google. Please sign in with Google.") as any;
    error.statusCode = 401;
    throw error;
  }

  const valid = await verifyPassword(password!, user.passwordHash);
  if (!valid) {
    const error = new Error("Invalid credentials") as any;
    error.statusCode = 401;
    throw error;
  }

  if (user.status === "Pending") {
    const error = new Error("Your account is pending approval. Please check back later.") as any;
    error.statusCode = 403;
    throw error;
  }

  if (user.status === "Suspended") {
    const error = new Error("Your account has been suspended. Please contact support.") as any;
    error.statusCode = 403;
    throw error;
  }

  /*
   * Distinct from suspension, and worded to match: a suspension is a pause that
   * support can lift, so "contact support" is real advice. A rejection is a
   * declined application, and telling those applicants to contact support about
   * an account they never had just generates tickets nobody can action.
   */
  if (user.status === "Rejected") {
    const error = new Error("Your partner application was not approved.") as any;
    error.statusCode = 403;
    throw error;
  }

  const token = signJwt({ sub: user.id, role: user.role });

  return {
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
    },
    token
  };
};

export const requestPasswordReset = async (
  email: string,
  role?: UserRole,
): Promise<{ resetToken?: string }> => {
  /*
   * Scoped to the app that asked, now that one address can hold several
   * accounts. Resetting by address alone would let a partner's "forgot
   * password" mint a token for that person's admin account instead — and the
   * link is emailed straight to them, so it would silently hand over the wrong
   * one.
   *
   * Without a role we fall back to the single account, which keeps the
   * behaviour for addresses that only have one.
   */
  const normalized = email.toLowerCase().trim();
  const user = role
    ? await User.findOne({ email: normalized, role })
    : await (async () => {
        const found = await User.find({ email: normalized }).limit(2);
        return found.length === 1 ? found[0] : null;
      })();

  if (!user) {
    return {};
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  user.resetPasswordTokenHash = tokenHash;
  user.resetPasswordExpiresAt = new Date(Date.now() + 1000 * 60 * 15);
  await user.save();

  /*
   * The link goes to the app the account actually belongs to.
   *
   * This was always built from `env.appUrl` — the customer store — whoever
   * asked. A print partner resetting their password was emailed a link into the
   * storefront, where the token does work, but they end up signed into the wrong
   * application and nowhere near the portal they were trying to reach.
   *
   * Admins have no reset screen anywhere yet, so they are sent to the console
   * root rather than to a storefront that is not theirs; that page cannot
   * complete the reset, and building it is still outstanding.
   */
  const resetUrl = (() => {
    const trim = (u: string) => u.replace(/\/$/, "");
    const token = encodeURIComponent(rawToken);

    if (user.role === UserRoles.PRINTER) {
      return `${trim(env.printerAppUrl)}/set-password?resetToken=${token}`;
    }
    if (user.role === UserRoles.ADMIN) {
      return `${trim(env.adminAppUrl)}/?resetToken=${token}`;
    }
    return `${trim(env.appUrl)}/?resetToken=${token}&email=${encodeURIComponent(user.email)}`;
  })();

  const hasSmtp =
    Boolean(env.smtpHost) &&
    Boolean(env.smtpPort) &&
    Boolean(env.smtpUser) &&
    Boolean(env.smtpPass) &&
    Boolean(env.smtpFrom);

  if (hasSmtp) {
    try {
      const transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort!,
      secure: env.smtpSecure ?? env.smtpPort === 465,
      auth: {
        user: env.smtpUser,
        pass: env.smtpPass
      }
    });

    await transporter.sendMail({
      from: env.smtpFrom,
      to: user.email,
      subject: "Reset your Space Transfers password",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
          <h2 style="margin: 0 0 12px 0;">Reset your password</h2>
          <p style="margin: 0 0 12px 0;">We received a request to reset your password.</p>
          <p style="margin: 0 0 16px 0;">
            <a href="${resetUrl}" style="display: inline-block; padding: 10px 14px; background: #0f172a; color: #ffffff; text-decoration: none; border-radius: 10px;">
              Reset Password
            </a>
          </p>
          <p style="margin: 0 0 12px 0; font-size: 12px; color: #6b7280;">
            This link expires in 15 minutes. If you didn’t request this, you can ignore this email.
          </p>
        </div>
      `
      });
    } catch (error: any) {
      /*
       * A delivery failure must not fail the request.
       *
       * The token is already saved by this point, so an SMTP error answered 500
       * on an operation that had in fact succeeded. Worse, it answered 500 only
       * for addresses that exist — an unknown address returns early without
       * sending — so the status code alone told a caller which emails were
       * registered, on an endpoint that takes an arbitrary address.
       */
      console.error(
        `[PASSWORD_RESET] token issued but the email could not be sent to ${user.email}: ${error?.message}`,
      );
    }
  }

  /*
   * Outside production the raw token is returned so the flow can be exercised
   * without a working mailbox — including when the send above failed, which is
   * the state every environment is in until SendGrid is configured.
   */
  if (env.nodeEnv !== "production") {
    return { resetToken: rawToken };
  }

  return {};
};

export const loginWithGoogle = async (
  credential: string,
  // Only consulted when this sign-in creates a new account; existing users
  // accepted at their own registration.
  legalAcceptance?: LegalAcceptanceInput,
  legalContext?: { ip?: string; userAgent?: string },
): Promise<AuthResponse & { isNew: boolean }> => {
  dotenv.config({ override: true });
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim() || env.googleClientId;
  if (!clientId) {
    const error = new Error("Google Sign-In is not configured on this server") as any;
    error.statusCode = 503;
    throw error;
  }

  const client = new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
  const payload = ticket.getPayload();

  if (!payload?.email) {
    const error = new Error("Google account has no email address") as any;
    error.statusCode = 400;
    throw error;
  }

  const { email, name, sub: googleId, picture: avatarUrl } = payload;
  const normalizedEmail = email.toLowerCase().trim();

  // The /api/auth/google endpoint is the customer-facing Google sign-in flow.
  // Only ever resolve it to a customer record — never a printer/admin, even if
  // they happen to share an email. Without this guard, a Google sign-in could
  // silently link to a non-customer account and the resulting JWT would carry
  // a non-CUSTOMER role, triggering 403s on every /api/customer/* route.
  let user = await User.findOne({ googleId }) as any;
  // Customer-scoped: this path only ever creates or signs in CUSTOMER accounts,
  // so an unscoped lookup could now return that person's partner or admin
  // account and refuse them for having "a different role".
  if (!user) user = await User.findOne({ email: normalizedEmail, role: UserRoles.CUSTOMER }) as any;

  let isNew = false;

  if (user) {
    if (user.status === "Suspended") {
      const error = new Error("Your account has been suspended. Please contact support.") as any;
      error.statusCode = 403;
      throw error;
    }
    if (user.status === "Rejected") {
      const error = new Error("Your partner application was not approved.") as any;
      error.statusCode = 403;
      throw error;
    }
    if (user.role !== UserRoles.CUSTOMER) {
      const error = new Error(
        "An account with this email already exists with a different role. Please use the standard sign-in or contact support.",
      ) as any;
      error.statusCode = 403;
      throw error;
    }
    // Sync Google profile data on every login so name/photo stay current
    let changed = false;
    if (!user.googleId) { user.googleId = googleId; changed = true; }
    if (name && user.name !== name) { user.name = name; changed = true; }
    if (avatarUrl && user.avatarUrl !== avatarUrl) { user.avatarUrl = avatarUrl; changed = true; }
    if (changed) await user.save();
  } else {
    // A Google sign-in that creates an account IS a registration, so it needs
    // the same acknowledgements as the email form. Existing users skip this —
    // they accepted at their own sign-up and this is just a login.
    const googleAcceptance = buildLegalAcceptance(legalAcceptance, legalContext || {});

    isNew = true;
    user = await User.create({
      email: normalizedEmail,
      name: name || normalizedEmail.split("@")[0],
      passwordHash: null,
      googleId,
      avatarUrl: avatarUrl || null,
      role: UserRoles.CUSTOMER,
      status: "Active",
      regions: ["West"],
      legalAcceptance: googleAcceptance,
    });

    // Send welcome email (non-blocking)
    sendEmail({
      to: normalizedEmail,
      subject: "Welcome to Space Transfers",
      html: buildCustomerWelcomeEmailHtml(user.name),
    }).catch(() => {});
  }

  // Belt-and-braces: by this point user.role must be CUSTOMER (we either just
  // created a customer or refused the login above). Assert it before signing
  // the JWT so a future code change can never produce a non-customer Google token.
  if (user.role !== UserRoles.CUSTOMER) {
    const error = new Error("Google sign-in resolved to a non-customer account") as any;
    error.statusCode = 500;
    throw error;
  }

  const token = signJwt({ sub: user.id, role: user.role });

  const userResponse: UserResponse = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl || null,
    status: user.status,
    isGoogleAccount: true,
  };
  if (user.regions?.length) {
    userResponse.region = user.regions[0];
    userResponse.regions = user.regions;
  }

  return { user: userResponse, token, isNew };
};

export const resetPassword = async ({
  token,
  newPassword,
  legalAcceptance,
  legalContext
}: {
  token: string;
  newPassword: string;
  /**
   * Required only for an account that has never accepted anything — in practice
   * a partner an admin invited, who reaches this screen without ever having seen
   * the terms. An ordinary password recovery does not ask again.
   */
  legalAcceptance?: LegalAcceptanceInput;
  legalContext?: { ip?: string; userAgent?: string };
}): Promise<void> => {
  /*
   * Checked before anything uses them. The types say `string`, but these arrive
   * straight from a JSON body and TypeScript cannot enforce that at the edge —
   * a request omitting `token` reached `createHash().update(undefined)`, which
   * throws a TypeError and answered 500 on what is plainly a bad request.
   */
  if (typeof token !== "string" || token.trim().length === 0) {
    const error = new Error("A reset token is required") as any;
    error.statusCode = 400;
    throw error;
  }

  if (typeof newPassword !== "string" || newPassword.length < 8) {
    const error = new Error("Password must be at least 8 characters long") as any;
    error.statusCode = 400;
    throw error;
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({
    resetPasswordTokenHash: tokenHash,
    resetPasswordExpiresAt: { $gt: new Date() }
  });

  if (!user) {
    const error = new Error("Invalid or expired reset token") as any;
    error.statusCode = 400;
    throw error;
  }

  /*
   * Consent is captured here for anyone who has none.
   *
   * A partner who signs up accepts the terms on the form. A partner an admin
   * adds never saw them: the invitation goes straight to this screen, and they
   * were working the moment they chose a password. That left two classes of
   * partner, one with a full acceptance record and one with nothing at all —
   * and no way to show the second had agreed to anything.
   *
   * Keyed on the stored record rather than on which token the client used, so a
   * caller cannot skip it by relabelling the parameter.
   */
  if (!(user as any).legalAcceptance) {
    (user as any).legalAcceptance = buildLegalAcceptance(legalAcceptance, legalContext || {});
  }

  user.passwordHash = await hashPassword(newPassword);
  user.resetPasswordTokenHash = null;
  user.resetPasswordExpiresAt = null;
  const settings: any = (user as any).settings || {};
  const security: any = settings.security || {};
  security.lastPasswordChange = new Date();
  settings.security = security;
  (user as any).settings = settings;

  await user.save();
};
