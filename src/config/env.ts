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
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  smtpSecure?: boolean;
  sendgridApiKey?: string;
  sendgridFromEmail?: string;
  googleDriveClientEmail?: string;
  googleDrivePrivateKey?: string;
  googleDriveFolderId?: string;
  googleClientId?: string;
  // Stripe Connect (TEST MODE ONLY)
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  minimumPayoutAmountCents: number;
  // Cloudinary
  cloudinaryCloudName: string;
  cloudinaryApiKey: string;
  cloudinaryApiSecret: string;
  // ShipStation
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
  // AI Upscaling — Replicate (best, ~$0.002/img) and/or HuggingFace (free tier)
  replicateApiToken?: string;
  hfApiToken?: string;
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
  printerAppUrl: cleanEnvString(process.env.PRINTER_APP_URL) || "http://localhost:5173",

  smtpHost: cleanEnvString(process.env.SMTP_HOST),
  smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
  smtpUser: cleanEnvString(process.env.SMTP_USER),
  smtpPass: cleanEnvString(process.env.SMTP_PASS),
  smtpFrom: cleanEnvString(process.env.SMTP_FROM),
  smtpSecure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : undefined,
  sendgridApiKey: cleanEnvString(process.env.SENDGRID_API_KEY),
  sendgridFromEmail: cleanEnvString(process.env.SENDGRID_FROM_EMAIL),

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
  cloudinaryCloudName: cleanEnvString(process.env.CLOUDINARY_CLOUD_NAME) || "",
  cloudinaryApiKey: cleanEnvString(process.env.CLOUDINARY_API_KEY) || "",
  cloudinaryApiSecret: cleanEnvString(process.env.CLOUDINARY_API_SECRET) || "",
  // ShipStation
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
  replicateApiToken: cleanEnvString(process.env.REPLICATE_API_TOKEN),
  hfApiToken: cleanEnvString(process.env.HF_API_TOKEN),
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
