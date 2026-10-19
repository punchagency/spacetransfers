import jwt, { SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

export const signJwt = (payload: string | object | Buffer, expiresIn: string = env.jwtExpiresIn): string => {
  return jwt.sign(payload, env.jwtSecret, {
    algorithm: "HS256",
    expiresIn: expiresIn as SignOptions["expiresIn"]
  });
};

export const verifyJwt = (token: string): any => {
  try {
    return jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    return null;
  }
};

/** An admin session is short: the console holds pricing, payouts and refunds. */
const ADMIN_SESSION = "24h";

/**
 * The token a signed-in session carries. `tv` is the account's token version:
 * raising it on the account ends every session issued before, which is how a
 * password change or a passkey reset signs the other devices out.
 */
export const signSessionToken = (user: { id?: unknown; _id?: unknown; role: string; tokenVersion?: number }): string =>
  signJwt(
    { sub: String(user.id ?? user._id), role: user.role, tv: Number(user.tokenVersion) || 0 },
    user.role === "ADMIN" ? ADMIN_SESSION : env.jwtExpiresIn,
  );

/** Account states that cannot sign in or keep a session. */
export const SIGN_IN_BLOCKED_STATUSES = ["Suspended", "Rejected", "Closed"];

/** Whether a verified token is a session for this account as it stands now. */
export const isLiveSession = (payload: any, user: { tokenVersion?: number; status?: string }): boolean => {
  // A token minted for one step of sign-in (a passkey challenge) is not a session.
  if (!payload || payload.typ) return false;
  if ((Number(payload.tv) || 0) !== (Number(user.tokenVersion) || 0)) return false;
  return !SIGN_IN_BLOCKED_STATUSES.includes(String(user.status || ""));
};
