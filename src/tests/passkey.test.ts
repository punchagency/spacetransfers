import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  consumeRecoveryCode,
  generateRecoveryCodes,
  hasPasskey,
  hashRecoveryCode,
  mustEnrollPasskey,
  newRecoveryCode,
  normalizeRecoveryCode,
  passkeySummary,
  readStep,
  relyingParty,
  startPasskeySetup,
  startSecondStep,
} from "../services/passkey.service.js";
import { requireAdminPasskey } from "../middleware/auth.js";
import { isLiveSession, signSessionToken, verifyJwt } from "../utils/jwt.js";

const key = { id: "cred-1", publicKey: "AAAA", counter: 0, name: "MacBook", createdAt: new Date(), backedUp: true };
const user = (over: any = {}) => ({ id: "64b7f0c2a1b2c3d4e5f60718", email: "ada@example.com", name: "Ada", role: "CUSTOMER", ...over });

describe("who needs a passkey", () => {
  it("is every admin, and nobody else is forced", () => {
    assert.equal(mustEnrollPasskey(user({ role: "ADMIN" })), true);
    assert.equal(mustEnrollPasskey(user({ role: "ADMIN", passkeys: [key] })), false);
    assert.equal(mustEnrollPasskey(user({ role: "PRINTER" })), false);
    assert.equal(mustEnrollPasskey(user()), false);
    assert.equal(hasPasskey(user({ passkeys: [] })), false);
    assert.equal(hasPasskey(user({ passkeys: [key] })), true);
  });

  it("stops an admin without one at the console's door, with a reason the app can act on", () => {
    const run = (u: any) => {
      let status = 0, body: any = null, passed = false;
      const res: any = { status: (s: number) => ((status = s), res), json: (b: any) => ((body = b), res) };
      requireAdminPasskey({ user: u } as any, res, () => (passed = true));
      return { status, body, passed };
    };
    assert.deepEqual(run(user({ role: "ADMIN" })), { status: 403, body: { message: "Set up a passkey to continue.", code: "PASSKEY_REQUIRED" }, passed: false });
    assert.equal(run(user({ role: "ADMIN", passkeys: [key] })).passed, true);
  });
});

describe("what an account is shown about its passkeys", () => {
  it("names them and counts unused codes, without any key material", () => {
    const summary = passkeySummary(user({ role: "ADMIN", passkeys: [key], recoveryCodes: [{ hash: "a" }, { hash: "b", usedAt: new Date() }] }));
    assert.equal(summary.passkeys[0].name, "MacBook");
    assert.equal(summary.passkeys[0].synced, true);
    assert.equal(summary.recoveryCodesLeft, 1);
    assert.equal(summary.required, true);
    assert.equal(JSON.stringify(summary).includes("AAAA"), false);
    assert.equal(passkeySummary(user()).required, false);
  });
});

describe("recovery codes", () => {
  it("are ten, unalike, and stored only as hashes", () => {
    const { codes, stored } = generateRecoveryCodes();
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    for (const code of codes) assert.match(code, /^[A-HJKMNP-TV-Z2-9]{5}-[A-HJKMNP-TV-Z2-9]{5}$/);
    assert.equal(JSON.stringify(stored).includes(codes[0]), false);
    assert.equal(stored[0].hash, hashRecoveryCode(codes[0]));
  });

  it("are read whatever the case, spacing or dash", () => {
    const code = newRecoveryCode();
    assert.equal(normalizeRecoveryCode(` ${code.toLowerCase().replace("-", " ")} `), code.replace("-", ""));
  });

  it("work once each", () => {
    const { codes, stored } = generateRecoveryCodes();
    const account = user({ recoveryCodes: stored });
    assert.equal(consumeRecoveryCode(account, "AAAAA-AAAAA"), false);
    assert.equal(consumeRecoveryCode(account, ""), false);
    assert.equal(consumeRecoveryCode(account, { $ne: null }), false);
    assert.equal(consumeRecoveryCode(account, codes[3].toLowerCase()), true);
    assert.equal(consumeRecoveryCode(account, codes[3]), false);
    assert.equal(passkeySummary(account).recoveryCodesLeft, 9);
  });
});

describe("the steps of a passkey ceremony", () => {
  it("bind the passkey to the app the account signs in to", () => {
    assert.equal(relyingParty("ADMIN").rpName, "Space Transfers");
    for (const role of ["ADMIN", "PRINTER", "CUSTOMER"]) assert.equal(relyingParty(role).origin.includes(relyingParty(role).rpID), true);
  });

  it("carry a challenge that is not a session and cannot stand in for the other step", async () => {
    const setup = await startPasskeySetup(user());
    const second = await startSecondStep(user({ passkeys: [key] }));
    assert.equal(isLiveSession(verifyJwt(setup.stepToken), { status: "Active" }), false);
    assert.equal(isLiveSession(verifyJwt(second.stepToken), { status: "Active" }), false);
    assert.equal(readStep(second.stepToken, "2fa").challenge, second.options.challenge);
    assert.throws(() => readStep(setup.stepToken, "2fa"), (e: any) => e.statusCode === 401 && e.code === "STEP_EXPIRED");
    assert.throws(() => readStep(signSessionToken(user()), "2fa"), (e: any) => e.statusCode === 401);
    assert.throws(() => readStep(undefined, "2fa"), (e: any) => e.statusCode === 401);
    assert.deepEqual(second.options.allowCredentials?.map((c) => c.id), ["cred-1"]);
  });

  it("will not register a passkey the account already has, and caps how many", async () => {
    const setup = await startPasskeySetup(user({ passkeys: [key] }));
    assert.deepEqual(setup.options.excludeCredentials?.map((c) => c.id), ["cred-1"]);
    const full = user({ passkeys: Array.from({ length: 10 }, (_, i) => ({ ...key, id: `c${i}` })) });
    await assert.rejects(startPasskeySetup(full), (e: any) => e.statusCode === 400);
  });
});
