import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { apiFetch } from "./api";

/** Passkeys: the second step of sign-in, and an account's own list of them. */

export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Kept in a password manager or cloud keychain, so it survives losing the device. */
  synced: boolean;
}

export interface PasskeySummary {
  passkeys: PasskeyInfo[];
  recoveryCodesLeft: number;
  /** True when this kind of account must always have one. */
  required: boolean;
  /** Present once, right after they are made. */
  recoveryCodes?: string[] | null;
}

/** What sign-in answers when the password was right but a passkey is still owed. */
export interface SecondStepChallenge {
  twoFactorRequired: true;
  stepToken: string;
  options: any;
}

export const needsSecondStep = (res: any): res is SecondStepChallenge =>
  Boolean(res && res.twoFactorRequired && res.stepToken && res.options);

export const passkeysSupported = (): boolean =>
  typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";

/**
 * Why a passkey prompt ended without one, in words for the person. The browser
 * reports a dismissed prompt, a timeout and a refusal the same way.
 */
export const passkeyErrorMessage = (err: any): string => {
  const name = String(err?.name || "");
  if (name === "NotAllowedError" || name === "AbortError") return "The passkey prompt was closed or timed out. Try again when you're ready.";
  if (name === "InvalidStateError") return "This device already has a passkey for this account.";
  if (name === "NotSupportedError" || name === "SecurityError") return "This browser can't use a passkey here. Try another browser or device.";
  return err?.message || "Something went wrong with the passkey. Please try again.";
};

/** A name for a new passkey that says where it lives, e.g. "Chrome on Mac". */
export const suggestPasskeyName = (userAgent: string): string => {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const device = /iPhone/.test(userAgent) ? "iPhone" : /iPad/.test(userAgent) ? "iPad" : /Android/.test(userAgent) ? "Android" : /Mac OS X/.test(userAgent) ? "Mac" : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : "this device";
  return `${browser} on ${device}`;
};

/** The codes as a file a person can keep: one per line under a heading that says what they are. */
export const recoveryCodesFile = (codes: string[], account: string): string =>
  [`Space Transfers recovery codes for ${account}`, "Each code signs you in once if you can't use your passkey.", "", ...codes, ""].join("\n");

export const completeSecondStepWithPasskey = async (challenge: SecondStepChallenge) => {
  const response = await startAuthentication({ optionsJSON: challenge.options });
  return apiFetch("/auth/2fa/passkey", { method: "POST", body: JSON.stringify({ stepToken: challenge.stepToken, response }) });
};

export const completeSecondStepWithCode = (challenge: SecondStepChallenge, code: string) =>
  apiFetch("/auth/2fa/recovery", { method: "POST", body: JSON.stringify({ stepToken: challenge.stepToken, code }) });

export const fetchPasskeys = (): Promise<PasskeySummary> => apiFetch("/auth/passkeys");

export const addPasskey = async (name: string): Promise<PasskeySummary> => {
  const { options, stepToken } = await apiFetch("/auth/passkeys/options", { method: "POST" });
  const response = await startRegistration({ optionsJSON: options });
  return apiFetch("/auth/passkeys", { method: "POST", body: JSON.stringify({ stepToken, response, name }) });
};

export const removePasskey = (id: string, password: string): Promise<PasskeySummary> =>
  apiFetch(`/auth/passkeys/${encodeURIComponent(id)}/remove`, { method: "POST", body: JSON.stringify({ password }) });

export const regenerateRecoveryCodes = (password: string): Promise<PasskeySummary> =>
  apiFetch("/auth/recovery-codes", { method: "POST", body: JSON.stringify({ password }) });
