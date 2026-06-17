import { User, UserRoles, UserRole } from "../models/user.model.js";
import { getRegionFromState, getRegionFromCoords, normalizeRegion } from "../utils/region.js";
import { geocodeAddress, isUSCountry } from "../utils/geocoding.js";
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
  address
}: RegisterParams): Promise<AuthResponse> => {
  const existing = await User.findOne({ email });
  if (existing) {
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
  // Default to CUSTOMER if no role provided or invalid role
  const resolvedRole = role && Object.values(UserRoles).includes(role) ? role : UserRoles.CUSTOMER;

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

  const userPayload: any = {
    name,
    email,
    passwordHash,
    role: resolvedRole,
    status: resolvedRole === UserRoles.PRINTER ? "Pending" : "Active"
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
    // Attempt Census geocoding for accurate region + coordinate storage
    let geocoded = null;
    try {
      geocoded = await geocodeAddress({
        street:  address.street,
        city:    address.city,
        state:   address.state,
        zip:     address.postalCode,
        country: address.country,
      });
    } catch {
      // Non-fatal — fall back to state-based detection below
    }

    if (geocoded) {
      address = {
        street:     geocoded.street     || address.street,
        city:       geocoded.city       || address.city,
        state:      geocoded.state      || address.state,
        postalCode: geocoded.zip        || address.postalCode,
        country:    address.country,
      };
      addressCoordinates = { lat: geocoded.lat, lng: geocoded.lng };
      resolvedRegion =
        normalizeRegion(getRegionFromState(geocoded.state)) ??
        getRegionFromCoords(geocoded.lat, geocoded.lng);
    } else {
      resolvedRegion = normalizeRegion(getRegionFromState(address.state));
    }

    console.log(
      `[region-assign] role=${resolvedRole} state=${address.state} ` +
      `region=${resolvedRegion ?? "null"} geocoded=${!!geocoded}`
    );
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

  const user = await User.create(userPayload);

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

  const existing = await User.findOne({ email: subAccountData.email });
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

export const loginUser = async ({ email, password }: Partial<RegisterParams>): Promise<AuthResponse> => {
  const user = await User.findOne({ email });
  if (!user) {
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

export const requestPasswordReset = async (email: string): Promise<{ resetToken?: string }> => {
  const user = await User.findOne({ email: email.toLowerCase().trim() });

  if (!user) {
    return {};
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  user.resetPasswordTokenHash = tokenHash;
  user.resetPasswordExpiresAt = new Date(Date.now() + 1000 * 60 * 15);
  await user.save();

  const resetUrl = `${env.appUrl.replace(/\/$/, "")}/?resetToken=${encodeURIComponent(
    rawToken
  )}&email=${encodeURIComponent(user.email)}`;

  const hasSmtp =
    Boolean(env.smtpHost) &&
    Boolean(env.smtpPort) &&
    Boolean(env.smtpUser) &&
    Boolean(env.smtpPass) &&
    Boolean(env.smtpFrom);

  if (hasSmtp) {
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

    return {};
  }

  if (env.nodeEnv !== "production") {
    return { resetToken: rawToken };
  }

  return {};
};

export const loginWithGoogle = async (credential: string): Promise<AuthResponse & { isNew: boolean }> => {
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
  if (!user) user = await User.findOne({ email: normalizedEmail }) as any;

  let isNew = false;

  if (user) {
    if (user.status === "Suspended") {
      const error = new Error("Your account has been suspended. Please contact support.") as any;
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
  newPassword
}: {
  token: string;
  newPassword: string;
}): Promise<void> => {
  if (newPassword.length < 8) {
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
