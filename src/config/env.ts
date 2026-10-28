import dotenv from "dotenv";

dotenv.config();

interface Env {
  nodeEnv: string;
  port: number;
  mongoUri: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  appUrl: string;
  printerAppUrl: string;
  adminAppUrl: string;
  resendApiKey?: string;
  resendFromEmail?: string;
  googleDriveClientEmail?: string;
  googleDrivePrivateKey?: string;
  googleDriveFolderId?: string;
  googleClientId?: string;
  // Stripe Connect (TEST MODE ONLY)
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  minimumPayoutAmountCents: number;
  /**
   * Cloudflare R2 — where artwork lives once the client has provisioned it.
   *
   * All four are required — this is the only artwork store. Cloudinary, which
   * preceded it, capped an image at 10MB and downscaled print files on the way
   * in; the file stored was not the file the customer sent.
   */
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2Bucket?: string;
  r2PublicBaseUrl?: string;
  // EasyPost: shipping rates, labels and tracking
  /**
   * Whether this environment may buy postage.
   *
   * With a test API key a label is a free test label; with a production key it
   * is real postage on the client's account. Staging that holds a production
   * key leaves this off, so it can quote rates but never spend. Defaults to
   * false, so an environment that forgets to set it fails safe.
   */
  easyPostLabelsEnabled: boolean;
  easyPostApiKey?: string;
  /** Signs EasyPost's webhook events; checked against `X-Hmac-Signature`. */
  easyPostWebhookSecret?: string;
  /** Carriers to quote and buy from, e.g. ["USPS"]. Empty: every carrier on the account. */
  easyPostCarriers: string[];
  /** EasyPost carrier account ids to restrict to. Empty: all of them. */
  easyPostCarrierAccounts: string[];
  /** How often shipped orders are checked for delivery, as a backup to webhooks. */
  trackingPollIntervalMs: number;
  /** Shipped orders older than this are no longer checked. */
  trackingMaxPollingDays: number;
  /** How many print-size exports may render at once; each can need about 2 GB. */
  exportRenderConcurrency: number;
  /** Days a print export or preview is kept on disk; it is made again on request. */
  exportRetentionDays: number;
  /** Where shipping quotes start when no partner serves the address. Never a label's return address. */
  shipFrom: {
    name?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    phone?: string;
  };
  /** Effort level for the copyright vision pass. Higher = more accurate, slower, costlier. */
  /**
   * Google Gemini — the primary (and free) generative editing tier. An AI
   * Studio key needs no card and covers ~500 image edits/day, so it is tried
   * before the paid providers rather than as a fallback behind them.
   */
  geminiApiKey?: string;
  /** Overridable so a paid key can point at a stronger image model. */
  geminiImageModel?: string;
  /** Text model used for prompt understanding / multi-step planning. */
  geminiTextModel?: string;
}

const cleanEnvString = (value?: string): string | undefined => {
  if (value == null) return undefined;
  return value.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
};

/** A comma-separated setting as a list, blanks dropped. */
const listEnv = (value?: string): string[] =>
  (cleanEnvString(value) || "").split(",").map((s) => s.trim()).filter(Boolean);

const cleanJwtExpiresIn = (value?: string): string => {
  const cleaned = (cleanEnvString(value) || "7d").replace(/\s+/g, "");
  if (/^\d+$/.test(cleaned)) return cleaned;
  if (/^\d+[smhdwy]$/.test(cleaned)) return cleaned;
  return "7d";
};

export const env: Env = {
  nodeEnv: cleanEnvString(process.env.NODE_ENV) || "development",
  port: cleanEnvString(process.env.PORT) ? Number(cleanEnvString(process.env.PORT)) : 4000,
  mongoUri: cleanEnvString(process.env.MONGO_URI) || "mongodb://localhost:27017/space-transfer",
  jwtSecret: cleanEnvString(process.env.JWT_SECRET) || "change-me",
  jwtExpiresIn: cleanJwtExpiresIn(process.env.JWT_EXPIRES_IN),
  appUrl: cleanEnvString(process.env.APP_URL) || `http://localhost:${cleanEnvString(process.env.PORT) ? Number(cleanEnvString(process.env.PORT)) : 4000}`,
  printerAppUrl: cleanEnvString(process.env.PRINTER_APP_URL) || "http://localhost:5175",
  // Needed for the CORS allowlist. The console had no configured origin at all,
  // which is part of why CORS was left open to everything.
  adminAppUrl: cleanEnvString(process.env.ADMIN_APP_URL) || "http://localhost:5174",

  resendApiKey: cleanEnvString(process.env.RESEND_API_KEY),
  resendFromEmail: cleanEnvString(process.env.RESEND_FROM_EMAIL),

  googleDriveClientEmail: cleanEnvString(process.env.GOOGLE_DRIVE_CLIENT_EMAIL),
  googleDrivePrivateKey: cleanEnvString(process.env.GOOGLE_DRIVE_PRIVATE_KEY),
  googleDriveFolderId: cleanEnvString(process.env.GOOGLE_DRIVE_FOLDER_ID),
  googleClientId: cleanEnvString(process.env.GOOGLE_CLIENT_ID),
  // Stripe Connect (TEST MODE ONLY — use sk_test_* keys)
  stripeSecretKey: cleanEnvString(process.env.STRIPE_SECRET_KEY),
  stripeWebhookSecret: cleanEnvString(process.env.STRIPE_WEBHOOK_SECRET),
  minimumPayoutAmountCents: process.env.MINIMUM_PAYOUT_AMOUNT_CENTS
    ? Number(process.env.MINIMUM_PAYOUT_AMOUNT_CENTS)
    : 1000,
  r2AccountId: cleanEnvString(process.env.R2_ACCOUNT_ID),
  r2AccessKeyId: cleanEnvString(process.env.R2_ACCESS_KEY_ID),
  r2SecretAccessKey: cleanEnvString(process.env.R2_SECRET_ACCESS_KEY),
  r2Bucket: cleanEnvString(process.env.R2_BUCKET),
  r2PublicBaseUrl: cleanEnvString(process.env.R2_PUBLIC_BASE_URL),
  easyPostLabelsEnabled:
    String(cleanEnvString(process.env.EASYPOST_LABELS_ENABLED) ?? "").toLowerCase() === "true",
  easyPostApiKey: cleanEnvString(process.env.EASYPOST_API_KEY),
  easyPostWebhookSecret: cleanEnvString(process.env.EASYPOST_WEBHOOK_SECRET),
  easyPostCarriers: listEnv(process.env.EASYPOST_CARRIERS),
  easyPostCarrierAccounts: listEnv(process.env.EASYPOST_CARRIER_ACCOUNTS),
  trackingPollIntervalMs: Number(process.env.TRACKING_POLL_INTERVAL_MS) > 0
    ? Number(process.env.TRACKING_POLL_INTERVAL_MS)
    : 30 * 60 * 1000,
  trackingMaxPollingDays: Number(process.env.TRACKING_MAX_POLLING_DAYS) > 0
    ? Number(process.env.TRACKING_MAX_POLLING_DAYS)
    : 30,
  exportRenderConcurrency: Number.isInteger(Number(process.env.EXPORT_RENDER_CONCURRENCY)) && Number(process.env.EXPORT_RENDER_CONCURRENCY) > 0
    ? Number(process.env.EXPORT_RENDER_CONCURRENCY)
    : 3,
  exportRetentionDays: Number(process.env.EXPORT_RETENTION_DAYS) > 0 ? Number(process.env.EXPORT_RETENTION_DAYS) : 14,
  // Accepts GOOGLE_AI_API_KEY as an alias — that is the name AI Studio itself
  // shows on the key page, and copying it verbatim should just work.
  geminiApiKey:
    cleanEnvString(process.env.GEMINI_API_KEY) ||
    cleanEnvString(process.env.GOOGLE_AI_API_KEY),
  geminiImageModel: cleanEnvString(process.env.GEMINI_IMAGE_MODEL),
  geminiTextModel: cleanEnvString(process.env.GEMINI_TEXT_MODEL),
  shipFrom: {
    name: cleanEnvString(process.env.SHIP_FROM_NAME),
    street: cleanEnvString(process.env.SHIP_FROM_STREET),
    city: cleanEnvString(process.env.SHIP_FROM_CITY),
    state: cleanEnvString(process.env.SHIP_FROM_STATE),
    zip: cleanEnvString(process.env.SHIP_FROM_ZIP),
    country: cleanEnvString(process.env.SHIP_FROM_COUNTRY),
    phone: cleanEnvString(process.env.SHIP_FROM_PHONE),
  },
};

/**
 * Refuses to start with a session secret anyone could guess.
 *
 * A missing JWT_SECRET used to fall back to a published default without a
 * word, which let anyone sign themselves an admin session. Only a developer's
 * own machine and the test suite may run on the default.
 */
const WEAK_SECRETS = new Set(["", "change-me", "changeme", "secret"]);
const localOnly = env.nodeEnv === "development" || env.nodeEnv === "test";
const publiclyServed = [env.appUrl, env.printerAppUrl, env.adminAppUrl].some((u) => /^https:\/\//i.test(u));
if ((!localOnly || publiclyServed) && (WEAK_SECRETS.has(env.jwtSecret) || env.jwtSecret.length < 32)) {
  throw new Error("JWT_SECRET must be set to a random value of at least 32 characters. The server will not start without it.");
}

/**
 * Whether forgot-password hands the reset token back in its response, so the
 * flow can be exercised without a mailbox. It is account takeover for anyone
 * who can call the endpoint, so it has to be asked for by name and is never
 * honoured on a deployment served over https.
 */
export const exposeResetTokens =
  localOnly && !publiclyServed && String(cleanEnvString(process.env.EXPOSE_RESET_TOKENS) ?? "").toLowerCase() === "true";

/**
 * Whether an admin must have a passkey before the console will serve them.
 * On unless switched off by name, which is for a developer's machine only.
 */
export const adminPasskeyRequired =
  String(cleanEnvString(process.env.ADMIN_PASSKEY_REQUIRED) ?? "true").toLowerCase() !== "false" || (!localOnly || publiclyServed);
