import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

/**
 * Throttles for the unauthenticated auth surface.
 *
 * `express-rate-limit` was already a dependency and had never been imported, so
 * login, registration and password reset accepted unlimited attempts. There is
 * no account lockout either — nothing tracks failed attempts on the user — which
 * left a password the only thing between an attacker and an account, guessable
 * as fast as the network allows.
 *
 * Limits are per IP. Behind Render's proxy that requires `trust proxy`, set in
 * app.ts; without it every request appears to come from the proxy and one
 * attacker would rate-limit everybody.
 */

// Disabled under test so the suite is not throttled by its own fixtures.
const skip = () => env.nodeEnv === "test";

const message = (retryAfterMinutes: number) => ({
  message: `Too many attempts. Please try again in ${retryAfterMinutes} minutes.`,
});

/**
 * Sign-in and anything else that verifies a secret against an account.
 *
 * Counts successes as well as failures. Skipping successful requests sounds
 * appealing but hands an attacker a free pass the moment they guess correctly,
 * and credential-stuffing runs are mostly successes against reused passwords.
 */
export const authAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip,
  message: message(15),
});

/**
 * Account creation. Looser than sign-in — a shared office NAT can legitimately
 * register several people — but bounded, since this writes rows and sends mail.
 */
export const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip,
  message: message(60),
});

/**
 * Password reset and OTP delivery.
 *
 * Tightest of the three: each request sends an email to an address the caller
 * chose, so an unthrottled endpoint is a way to use our mail reputation to spam
 * someone else's inbox.
 */
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip,
  message: message(60),
});
