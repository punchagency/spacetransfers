/**
 * Registration legal-acceptance tests.
 * Run with: npm test — no network, no API key, no database.
 *
 * Two distinct failures are pinned here, both of which shipped:
 *
 *  1. A client that omits the `legalAcceptance` block entirely. Both the admin
 *     and printer portals did this, so *every* signup on those portals failed
 *     with "You must accept the Terms of Service…" no matter how many boxes the
 *     user ticked — the consent never left the browser. The first block below
 *     documents which error that produces, so the message stays diagnostic.
 *
 *  2. A sign-up whose versions differ from those published, which is refused
 *     so consent is never recorded against wording the person did not see.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildLegalAcceptance, CURRENT_LEGAL_VERSIONS } from "../config/legal.js";
import { LEGAL_SEED } from "../config/legalSeed.js";


/** Acceptance block a correct client sends. */
const validInput = () => ({
  termsAccepted: true,
  contentResponsibilityAccepted: true,
  termsVersion: CURRENT_LEGAL_VERSIONS.terms,
  privacyVersion: CURRENT_LEGAL_VERSIONS.privacy,
  contentPolicyVersion: CURRENT_LEGAL_VERSIONS.contentPolicy,
});

describe("buildLegalAcceptance", () => {
  it("accepts a well-formed submission and stamps current versions", () => {
    const record = buildLegalAcceptance(validInput(), { ip: "1.2.3.4" });

    assert.equal(record.termsAccepted, true);
    assert.equal(record.contentResponsibilityAccepted, true);
    assert.equal(record.termsVersion, CURRENT_LEGAL_VERSIONS.terms);
    assert.equal(record.privacyVersion, CURRENT_LEGAL_VERSIONS.privacy);
    assert.equal(record.contentPolicyVersion, CURRENT_LEGAL_VERSIONS.contentPolicy);
    assert.ok(record.acceptedAt instanceof Date);
    assert.equal(record.ip, "1.2.3.4");
  });

  it("rejects a missing block with LEGAL_ACCEPTANCE_REQUIRED", () => {
    // This is the exact failure the admin and printer portals hit. It must stay
    // distinguishable from TERMS_NOT_ACCEPTED: the two have completely
    // different causes (client bug vs. user did not tick), and conflating them
    // sent debugging after the checkbox for a payload problem.
    for (const missing of [undefined, null, "yes", 1]) {
      assert.throws(
        () => buildLegalAcceptance(missing as any, {}),
        (err: any) => err.code === "LEGAL_ACCEPTANCE_REQUIRED" && err.statusCode === 400,
        `expected LEGAL_ACCEPTANCE_REQUIRED for ${JSON.stringify(missing)}`,
      );
    }
  });

  it("rejects truthy-but-not-true consent values", () => {
    // "false", "off" and 0 are all plausible form-encoder output, and every
    // non-empty string is truthy in JS. Recording consent from any of them
    // would fabricate an acceptance the user never gave.
    for (const value of ["false", "off", "0", 1, "true"]) {
      assert.throws(
        () => buildLegalAcceptance({ ...validInput(), termsAccepted: value }, {}),
        (err: any) => err.code === "TERMS_NOT_ACCEPTED",
        `expected TERMS_NOT_ACCEPTED for ${JSON.stringify(value)}`,
      );
    }
  });

  it("requires the content-responsibility acknowledgement separately", () => {
    assert.throws(
      () =>
        buildLegalAcceptance(
          { ...validInput(), contentResponsibilityAccepted: false },
          {},
        ),
      (err: any) => err.code === "CONTENT_RESPONSIBILITY_NOT_ACCEPTED",
    );
  });

  it("rejects a stale version from an old browser tab", () => {
    assert.throws(
      () => buildLegalAcceptance({ ...validInput(), privacyVersion: "2020-01-01" }, {}),
      (err: any) => err.code === "LEGAL_VERSION_MISMATCH",
    );
  });

  it("truncates an oversized user agent rather than storing it whole", () => {
    const record = buildLegalAcceptance(validInput(), { userAgent: "x".repeat(2000) });
    assert.equal(record.userAgent?.length, 512);
  });
});

describe("published legal documents", () => {
  it("start from the wording sign-ups have already accepted", () => {
    assert.equal(LEGAL_SEED.terms.published.version, CURRENT_LEGAL_VERSIONS.terms);
    assert.equal(LEGAL_SEED.privacy.published.version, CURRENT_LEGAL_VERSIONS.privacy);
    assert.equal(LEGAL_SEED["content-policy"].published.version, CURRENT_LEGAL_VERSIONS.contentPolicy);
  });

  it("check a sign-up against whatever is published now", () => {
    const now = { terms: "2026-10-16", privacy: "2026-10-16", contentPolicy: "2026-07-28" };
    const fresh = { ...validInput(), termsVersion: now.terms, privacyVersion: now.privacy };
    const record = buildLegalAcceptance(fresh, {}, now);
    assert.equal(record.termsVersion, "2026-10-16");
    assert.throws(() => buildLegalAcceptance(validInput(), {}, now), (e: any) => e.code === "LEGAL_VERSION_MISMATCH");
  });
});
