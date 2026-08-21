#!/usr/bin/env node
/**
 * Creates an ADMIN account directly against the database.
 *
 * This is the only way to make an admin. `POST /api/auth/register` refuses
 * `role: "ADMIN"` with a 403 — it is unauthenticated, so honouring it would let
 * anyone who can reach the API mint full access to pricing, partners and
 * payouts — and the admin console has no sign-up screen.
 *
 * Usage:
 *   node scripts/create-admin.mjs "Ada Lovelace" ada@yourcompany.com
 *
 * The password is generated and printed once. Hand it to the person over a
 * secure channel and have them change it in the console under
 * Settings → Security. To set one yourself instead:
 *
 *   node scripts/create-admin.mjs "Ada Lovelace" ada@yourcompany.com "their-password"
 *
 * Re-running for an existing email does NOT overwrite the account; it reports
 * what is already there and exits, so this is safe to run twice.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomBytes } from "crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const __dir = dirname(fileURLToPath(import.meta.url));

// Load .env manually, matching the other scripts in this folder.
const envPath = join(__dir, "../.env");
let env = {};
try {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
} catch {
  console.error(`Could not read ${envPath}`);
  process.exit(1);
}

const MONGO_URI = process.env.MONGO_URI || env.MONGO_URI;
if (!MONGO_URI) {
  console.error("MONGO_URI is not set (checked the environment and .env).");
  process.exit(1);
}

const [name, email, providedPassword] = process.argv.slice(2);

if (!name || !email) {
  console.error('Usage: node scripts/create-admin.mjs "Full Name" email@company.com [password]');
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(`"${email}" is not a valid email address.`);
  process.exit(1);
}
if (providedPassword && providedPassword.length < 8) {
  console.error("Password must be at least 8 characters (the login endpoint enforces this).");
  process.exit(1);
}

// URL-safe, no ambiguous characters to misread when read aloud or copied.
const generatePassword = () =>
  randomBytes(18).toString("base64").replace(/[+/=]/g, "").slice(0, 20);

const password = providedPassword || generatePassword();
const normalisedEmail = String(email).toLowerCase().trim();

const run = async () => {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });

  // Talk to the collection directly rather than importing the TS model — this
  // script runs under plain node, with no build step or tsx required.
  const users = mongoose.connection.collection("users");

  const existing = await users.findOne({ email: normalisedEmail });
  if (existing) {
    console.error(
      `\n✗ ${normalisedEmail} already exists (role: ${existing.role}, status: ${existing.status}).\n` +
        `  Nothing was changed. Use a different email, or reset the password from the console.\n`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const now = new Date();
  const passwordHash = await bcrypt.hash(password, 10);

  await users.insertOne({
    name: String(name).trim(),
    email: normalisedEmail,
    passwordHash,
    role: "ADMIN",
    // Must be "Active": notifyAllAdmins only targets active admins, and a
    // "Pending" account is the printer-approval state, not an admin one.
    status: "Active",
    googleId: null,
    isSubAccount: false,
    parentAccount: null,
    rating: 5,
    // Mirrors the defaults the Mongoose schema would apply, since a raw insert
    // bypasses it. Without these the console reads undefined preferences.
    settings: {
      notifications: {
        email: { orderUpdates: true, partnerActivity: true, systemAlerts: true },
      },
      security: { twoFactorEnabled: false },
    },
    verificationStatus: { email: false, phone: false, business: false, document: false },
    createdAt: now,
    updatedAt: now,
  });

  console.log(
    `\n✓ Admin created\n\n` +
      `  Name      ${name}\n` +
      `  Email     ${normalisedEmail}\n` +
      `  Password  ${password}\n\n` +
      (providedPassword
        ? `  Have them change it under Settings → Security after first sign-in.\n`
        : `  This password is shown once and is not stored anywhere else.\n` +
          `  Send it over a secure channel; have them change it under Settings → Security.\n`),
  );

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(`\n✗ Failed: ${err?.message || err}\n`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
