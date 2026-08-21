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
 *  2. Version drift between the server registry and the three client mirrors.
 *     The mirror pattern is deliberate (see config/legal.ts) but it has four
 *     copies of the same constants, and a bump applied to fewer than all four
 *     fails closed at runtime for real users. Reading the mirrors off disk
 *     turns that into a CI failure instead.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { buildLegalAcceptance, CURRENT_LEGAL_VERSIONS } from "../config/legal.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

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

describe("client legal mirrors", () => {
  // Path -> the app it belongs to, for a failure message that names the file to
  // edit rather than just reporting a mismatched string.
  // Only apps that actually register users need a mirror: the mirror exists so
  // a registering client can echo back the versions it rendered. The admin
  // console has no sign-up — admin accounts are provisioned directly against
  // the database — so it has no mirror to drift.
  const mirrors = [
    ["customer", "space-transfers/src/lib/legal/documents.ts"],
    ["printer", "space-transfer-printer/src/utils/legal.ts"],
  ] as const;

  for (const [app, relPath] of mirrors) {
    it(`${app} mirror matches the server registry`, () => {
      const source = readFileSync(resolve(repoRoot, relPath), "utf8");

      // Parsed from source text rather than imported: these live in separate
      // Vite apps with their own tsconfigs, and importing across app
      // boundaries would couple the server build to all three frontends.
      const versions = [...source.matchAll(/version:\s*"([^"]+)"/g)].map((m) => m[1]);

      assert.equal(
        versions.length,
        3,
        `${relPath}: expected 3 document versions, found ${versions.length}`,
      );

      const [terms, privacy, contentPolicy] = versions;
      assert.equal(
        terms,
        CURRENT_LEGAL_VERSIONS.terms,
        `${relPath}: terms version drifted from the server — bump it there too`,
      );
      assert.equal(
        privacy,
        CURRENT_LEGAL_VERSIONS.privacy,
        `${relPath}: privacy version drifted from the server — bump it there too`,
      );
      assert.equal(
        contentPolicy,
        CURRENT_LEGAL_VERSIONS.contentPolicy,
        `${relPath}: contentPolicy version drifted from the server — bump it there too`,
      );
    });
  }
});
