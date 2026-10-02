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
  // ShipStation
  /**
   * Whether this environment may buy real postage.
   *
   * ShipStation has no sandbox: a label is a real purchase against the client's
   * card, and there is no undo. Staging runs with this false so it can quote
   * rates and create orders but never spend.
   *
   * Defaults to false — an environment that forgets to set it fails safe rather
   * than silently spending.
   */
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
  shipStationLabelsEnabled: boolean;
  shipStationApiKey?: string;
  shipStationApiSecret?: string;
  shipStationCarrierId?: string;   // e.g. "stamps_com" | "ups" | "fedex"
  shipStationServiceCode?: string; // e.g. "usps_priority_mail" | "ups_ground"
  shipStationWebhookSecret?: string; // token appended as ?token= to the webhook URL
  shipStationPollIntervalMs: number;
  shipStationMaxPollingDays: number;
  // Warehouse ID from ShipStation → Settings → Warehouses (numeric ID in the page URL).
  shipStationWarehouseId?: number;
  // Ship-from address (the print shop). If omitted, ShipStation uses the default warehouse.
  shipStationFromName?: string;
  shipStationFromStreet?: string;
  shipStationFromCity?: string;
  shipStationFromState?: string;
  shipStationFromPostalCode?: string;
  shipStationFromCountry?: string;
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
  // ShipStation
  r2AccountId: cleanEnvString(process.env.R2_ACCOUNT_ID),
  r2AccessKeyId: cleanEnvString(process.env.R2_ACCESS_KEY_ID),
  r2SecretAccessKey: cleanEnvString(process.env.R2_SECRET_ACCESS_KEY),
  r2Bucket: cleanEnvString(process.env.R2_BUCKET),
  r2PublicBaseUrl: cleanEnvString(process.env.R2_PUBLIC_BASE_URL),
  shipStationLabelsEnabled:
    String(cleanEnvString(process.env.SHIPSTATION_LABELS_ENABLED) ?? "").toLowerCase() === "true",
  shipStationApiKey: cleanEnvString(process.env.SHIPSTATION_API_KEY),
  shipStationApiSecret: cleanEnvString(process.env.SHIPSTATION_API_SECRET),
  shipStationCarrierId: cleanEnvString(process.env.SHIPSTATION_CARRIER_ID),
  shipStationServiceCode: cleanEnvString(process.env.SHIPSTATION_SERVICE_CODE),
  shipStationWebhookSecret: cleanEnvString(process.env.SHIPSTATION_WEBHOOK_SECRET),
  shipStationPollIntervalMs: process.env.SHIPSTATION_POLL_INTERVAL_MS
    ? Number(process.env.SHIPSTATION_POLL_INTERVAL_MS)
    : 30 * 60 * 1000, // 30 minutes
  shipStationMaxPollingDays: process.env.SHIPSTATION_MAX_POLLING_DAYS
    ? Number(process.env.SHIPSTATION_MAX_POLLING_DAYS)
    : 30,
  // Accepts GOOGLE_AI_API_KEY as an alias — that is the name AI Studio itself
  // shows on the key page, and copying it verbatim should just work.
  geminiApiKey:
    cleanEnvString(process.env.GEMINI_API_KEY) ||
    cleanEnvString(process.env.GOOGLE_AI_API_KEY),
  geminiImageModel: cleanEnvString(process.env.GEMINI_IMAGE_MODEL),
  geminiTextModel: cleanEnvString(process.env.GEMINI_TEXT_MODEL),
  shipStationWarehouseId: process.env.SHIPSTATION_WAREHOUSE_ID
    ? Number(process.env.SHIPSTATION_WAREHOUSE_ID)
    : undefined,
  shipStationFromName: cleanEnvString(process.env.SHIPSTATION_FROM_NAME),
  shipStationFromStreet: cleanEnvString(process.env.SHIPSTATION_FROM_STREET),
  shipStationFromCity: cleanEnvString(process.env.SHIPSTATION_FROM_CITY),
  shipStationFromState: cleanEnvString(process.env.SHIPSTATION_FROM_STATE),
  shipStationFromPostalCode: cleanEnvString(process.env.SHIPSTATION_FROM_POSTAL_CODE),
  shipStationFromCountry: cleanEnvString(process.env.SHIPSTATION_FROM_COUNTRY),
};
