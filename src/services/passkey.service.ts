import crypto from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { adminPasskeyRequired, env } from "../config/env.js";
import { signJwt, verifyJwt } from "../utils/jwt.js";

/**
 * Passkeys as the second step of sign-in.
 *
 * A password alone is one stolen or guessed secret away from an account. A
 * passkey is a key pair held by the person's own device, unlocked by their
 * fingerprint, face or PIN, and bound to our address, so it cannot be phished
 * or reused elsewhere. After the password, an account that has one must prove
 * it holds the device. Admins must have one; partners and customers may.
 */

const MAX_PASSKEYS = 10;
const RECOVERY_CODE_COUNT = 10;
const STEP_TTL = "5m";
const httpError = (message: string, statusCode: number, code?: string) => Object.assign(new Error(message), { statusCode, code });

/** The app an account signs in to: a passkey is bound to that address and no other. */
export const relyingParty = (role: string): { rpID: string; origin: string; rpName: string } => {
  const url = role === "ADMIN" ? env.adminAppUrl : role === "PRINTER" ? env.printerAppUrl : env.appUrl;
  const parsed = new URL(url);
  return { rpID: parsed.hostname, origin: parsed.origin, rpName: "Space Transfers" };
};

export const hasPasskey = (user: any): boolean => Array.isArray(user?.passkeys) && user.passkeys.length > 0;

/** An admin without a passkey can do nothing in the console but set one up. */
export const mustEnrollPasskey = (user: any): boolean =>
  adminPasskeyRequired && String(user?.role) === "ADMIN" && !hasPasskey(user);

/** What the account's owner is shown about their passkeys. Never the keys themselves. */
export const passkeySummary = (user: any) => ({
  passkeys: ((user?.passkeys || []) as any[]).map((p) => ({
    id: String(p.id),
    name: String(p.name || "Passkey"),
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt || null,
    synced: Boolean(p.backedUp),
  })),
  recoveryCodesLeft: ((user?.recoveryCodes || []) as any[]).filter((c) => !c.usedAt).length,
  required: adminPasskeyRequired && String(user?.role) === "ADMIN",
});

// ── recovery codes ──

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/** "K7PQR-2MXTV": ten characters without the ones that read alike. */
export const newRecoveryCode = (): string => {
  const bytes = crypto.randomBytes(10);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
};

/** A typed code as stored: case, spaces and the dash do not matter. */
export const normalizeRecoveryCode = (input: unknown): string =>
  String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export const hashRecoveryCode = (code: string): string =>
  crypto.createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");

export const generateRecoveryCodes = (): { codes: string[]; stored: { hash: string; usedAt: null }[] } => {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  return { codes, stored: codes.map((code) => ({ hash: hashRecoveryCode(code), usedAt: null })) };
};

/** Marks the code used and returns true, or returns false when it is wrong or already spent. */
export const consumeRecoveryCode = (user: any, input: unknown, now = new Date()): boolean => {
  const normalized = normalizeRecoveryCode(input);
  if (normalized.length !== 10) return false;
  const hash = hashRecoveryCode(normalized);
  const entry = ((user?.recoveryCodes || []) as any[]).find((c) => !c.usedAt && c.hash === hash);
  if (!entry) return false;
  entry.usedAt = now;
  return true;
};

// ── step tokens ──

/*
 * The challenge for each ceremony travels in a short-lived signed token, so
 * nothing has to be stored between the two requests. Each is good once: a used
 * challenge is remembered until it would have expired anyway.
 */
const spent = new Map<string, number>();
const spend = (challenge: string): boolean => {
  const now = Date.now();
  for (const [key, until] of spent) if (until < now) spent.delete(key);
  if (spent.has(challenge)) return false;
  spent.set(challenge, now + 6 * 60 * 1000);
  return true;
};

type StepKind = "2fa" | "passkey-setup";
const signStep = (kind: StepKind, userId: string, challenge: string) => signJwt({ typ: kind, sub: userId, ch: challenge }, STEP_TTL);

export const readStep = (token: unknown, kind: StepKind): { userId: string; challenge: string } => {
  const payload = typeof token === "string" ? verifyJwt(token) : null;
  if (!payload || payload.typ !== kind || !payload.sub || !payload.ch) {
    throw httpError("This sign-in step has expired. Please start again.", 401, "STEP_EXPIRED");
  }
  return { userId: String(payload.sub), challenge: String(payload.ch) };
};

// ── setting a passkey up ──

export const startPasskeySetup = async (user: any) => {
  if (((user.passkeys || []) as any[]).length >= MAX_PASSKEYS) {
    throw httpError(`You can have up to ${MAX_PASSKEYS} passkeys. Remove one to add another.`, 400);
  }
  const rp = relyingParty(user.role);
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: String(user.email),
    userDisplayName: String(user.name || user.email),
    userID: new TextEncoder().encode(String(user.id ?? user._id)),
    attestationType: "none",
    excludeCredentials: ((user.passkeys || []) as any[]).map((p) => ({ id: String(p.id), transports: p.transports })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  return { options, stepToken: signStep("passkey-setup", String(user.id ?? user._id), options.challenge) };
};

/**
 * Saves the new passkey on the account. The first one also issues recovery
 * codes, returned once and never again.
 */
export const finishPasskeySetup = async (user: any, stepToken: unknown, response: any, name: unknown) => {
  const step = readStep(stepToken, "passkey-setup");
  if (step.userId !== String(user.id ?? user._id)) throw httpError("This sign-in step has expired. Please start again.", 401, "STEP_EXPIRED");
  const rp = relyingParty(user.role);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: step.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
    });
  } catch (err: any) {
    throw httpError("That passkey couldn't be verified. Please try again.", 400);
  }
  if (!verification.verified || !verification.registrationInfo) throw httpError("That passkey couldn't be verified. Please try again.", 400);
  if (!spend(step.challenge)) throw httpError("This sign-in step has expired. Please start again.", 401, "STEP_EXPIRED");

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const existing = ((user.passkeys || []) as any[]);
  if (existing.some((p) => p.id === credential.id)) throw httpError("This passkey is already on your account.", 409);

  const first = existing.length === 0;
  const label = String(name ?? "").trim().slice(0, 60) || `Passkey ${existing.length + 1}`;
  user.passkeys = [
    ...existing,
    {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: label,
      createdAt: new Date(),
      lastUsedAt: null,
    },
  ];
  let recoveryCodes: string[] | null = null;
  if (first || !((user.recoveryCodes || []) as any[]).some((c) => !c.usedAt)) {
    const fresh = generateRecoveryCodes();
    user.recoveryCodes = fresh.stored;
    recoveryCodes = fresh.codes;
  }
  await user.save();
  return { ...passkeySummary(user), recoveryCodes };
};

// ── the second step of sign-in ──

export const startSecondStep = async (user: any) => {
  const rp = relyingParty(user.role);
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: ((user.passkeys || []) as any[]).map((p) => ({ id: String(p.id), transports: p.transports })),
    userVerification: "preferred",
  });
  return { options, stepToken: signStep("2fa", String(user.id ?? user._id), options.challenge) };
};

/** Checks the passkey's answer against the challenge. Throws unless it proves the device. */
export const finishSecondStep = async (user: any, challenge: string, response: any): Promise<void> => {
  const failed = () => httpError("That passkey didn't match this account. Please try again.", 401);
  const passkey = ((user.passkeys || []) as any[]).find((p) => p.id === String(response?.id || ""));
  if (!passkey) throw failed();
  const rp = relyingParty(user.role);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(Buffer.from(String(passkey.publicKey), "base64url")),
        counter: Number(passkey.counter) || 0,
        transports: passkey.transports,
      },
    });
  } catch {
    throw failed();
  }
  if (!verification.verified) throw failed();
  if (!spend(challenge)) throw httpError("This sign-in step has expired. Please start again.", 401, "STEP_EXPIRED");
  passkey.counter = verification.authenticationInfo.newCounter;
  passkey.lastUsedAt = new Date();
  user.markModified("passkeys");
  await user.save();
};

/** Removes every passkey and recovery code and signs the account out everywhere. */
export const clearPasskeys = async (user: any): Promise<void> => {
  user.passkeys = undefined;
  user.recoveryCodes = undefined;
  user.tokenVersion = (Number(user.tokenVersion) || 0) + 1;
  await user.save();
};
