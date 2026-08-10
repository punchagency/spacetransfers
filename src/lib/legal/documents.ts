/**
 * Client mirror of the server's legal document registry
 * (`space-transfer-server/src/config/legal.ts`).
 *
 * These versions are sent back with the registration so the server can record
 * *which wording* the user actually saw. If this file drifts from the server's,
 * registration fails closed with "please review the updated terms" rather than
 * recording consent against text the user never read — so a stale deploy is
 * safe, just briefly inconvenient.
 *
 * When legal wording changes: bump the version here **and** in the server file.
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

/** Payload shape expected by `POST /auth/register` and `POST /auth/google`. */
export interface LegalAcceptancePayload {
  termsAccepted: boolean;
  contentResponsibilityAccepted: boolean;
  termsVersion: string;
  privacyVersion: string;
  contentPolicyVersion: string;
}

export const buildLegalAcceptancePayload = (
  termsAccepted: boolean,
  contentResponsibilityAccepted: boolean,
): LegalAcceptancePayload => ({
  termsAccepted,
  contentResponsibilityAccepted,
  termsVersion: LEGAL_DOCUMENTS.terms.version,
  privacyVersion: LEGAL_DOCUMENTS.privacy.version,
  contentPolicyVersion: LEGAL_DOCUMENTS.contentPolicy.version,
});
