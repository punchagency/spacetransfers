/**
 * Client mirror of the server's legal document registry
 * (`space-transfer-server/src/config/legal.ts`).
 *
 * These versions are sent back with the registration so the server can record
 * *which wording* the printer actually saw. If this file drifts from the server's,
 * registration fails closed with "please review the updated terms" rather than
 * recording consent against text the user never read — so a stale deploy is
 * safe, just briefly inconvenient.
 *
 * A server test (`legalMirrors.test.ts`) reads this file and asserts the
 * versions match, so drift is caught in CI rather than by a failed signup.
 *
 * When legal wording changes: bump the version here **and** in the server file,
 * and in the matching mirrors in the customer and admin apps.
 */

export interface LegalDocument {
  id: string;
  title: string;
  version: string;
  url: string;
}

export const LEGAL_DOCUMENTS: Record<"terms" | "privacy" | "contentPolicy", LegalDocument> = {
  terms: {
    id: "terms",
    title: "Terms of Service",
    version: "2026-07-28",
    url: "/legal/terms",
  },
  privacy: {
    id: "privacy",
    title: "Privacy Policy",
    version: "2026-07-28",
    url: "/legal/privacy",
  },
  contentPolicy: {
    id: "content-policy",
    title: "Content & Intellectual Property Policy",
    version: "2026-07-28",
    url: "/legal/content-policy",
  },
};

/** Payload shape expected by `POST /auth/register`. */
export interface LegalAcceptancePayload {
  termsAccepted: boolean;
  contentResponsibilityAccepted: boolean;
  termsVersion: string;
  privacyVersion: string;
  contentPolicyVersion: string;
}

/**
 * Builds the acceptance block for a registration request.
 *
 * The server validates both flags with `=== true`, so these must be real
 * booleans — passing a checkbox's string value silently records consent that
 * was never given, which is the exact failure the acceptance record exists to
 * rule out.
 */
export const buildLegalAcceptancePayload = (
  termsAccepted: boolean,
  contentResponsibilityAccepted: boolean,
): LegalAcceptancePayload => ({
  termsAccepted: termsAccepted === true,
  contentResponsibilityAccepted: contentResponsibilityAccepted === true,
  termsVersion: LEGAL_DOCUMENTS.terms.version,
  privacyVersion: LEGAL_DOCUMENTS.privacy.version,
  contentPolicyVersion: LEGAL_DOCUMENTS.contentPolicy.version,
});
