/**
 * Versioned registry of the legal documents a user must accept to register.
 *
 * Versions are the whole point of this file. An acceptance record is only
 * defensible if it says *which text* the user agreed to — "user accepted the
 * Terms" is worthless in a dispute if the Terms have since been rewritten. So
 * every document carries a version, the client sends back the versions it
 * actually rendered, and the server refuses to record an acceptance whose
 * versions it does not recognise as current (see `assertCurrentLegalVersions`).
 *
 * When you change the wording of any document, bump its `version` here. Existing
 * users keep their historical acceptance record; re-acceptance for existing
 * users is a separate flow and is deliberately not handled at registration.
 *
 * The client mirrors these values in `src/lib/legal/documents.ts`. If the two
 * drift, registration fails closed with a "please review the updated terms"
 * message rather than silently recording the wrong version.
 */

export interface LegalDocument {
  id: string;
  title: string;
  /** Bump on any wording change. Date-based so ordering is obvious. */
  version: string;
  /** Where the customer can read it. Relative paths resolve against the app. */
  url: string;
}

export const LEGAL_DOCUMENTS = {
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
} as const satisfies Record<string, LegalDocument>;

export const CURRENT_LEGAL_VERSIONS = {
  terms: LEGAL_DOCUMENTS.terms.version,
  privacy: LEGAL_DOCUMENTS.privacy.version,
  contentPolicy: LEGAL_DOCUMENTS.contentPolicy.version,
};

/** What the client must send alongside a registration. */
export interface LegalAcceptanceInput {
  /** "I have read and agree to the Terms of Service and Privacy Policy." */
  termsAccepted?: unknown;
  /** "I am solely responsible for all content I upload…" */
  contentResponsibilityAccepted?: unknown;
  termsVersion?: unknown;
  privacyVersion?: unknown;
  contentPolicyVersion?: unknown;
}

/** What gets persisted on the user. */
export interface LegalAcceptanceRecord {
  termsAccepted: true;
  contentResponsibilityAccepted: true;
  termsVersion: string;
  privacyVersion: string;
  contentPolicyVersion: string;
  acceptedAt: Date;
  /** Recorded where legally permitted; omitted when unavailable. */
  ip?: string;
  userAgent?: string;
}

const badRequest = (message: string, code: string) => {
  const error = new Error(message) as any;
  error.statusCode = 400;
  error.code = code;
  return error;
};

/**
 * Validates a submitted acceptance and turns it into a persistable record.
 *
 * Strictly `=== true`: a checkbox that arrives as the string "false", "0", or
 * "off" is truthy in JavaScript, and every one of those is a plausible thing for
 * a form encoder or a hand-rolled client to send. Accepting any of them would
 * record consent the user never gave, which is the exact failure this record
 * exists to rule out.
 */
export const buildLegalAcceptance = (
  input: LegalAcceptanceInput | undefined | null,
  context: { ip?: string; userAgent?: string },
): LegalAcceptanceRecord => {
  if (!input || typeof input !== "object") {
    throw badRequest(
      "You must accept the Terms of Service, Privacy Policy, and content responsibility acknowledgement to create an account.",
      "LEGAL_ACCEPTANCE_REQUIRED",
    );
  }

  if (input.termsAccepted !== true) {
    throw badRequest(
      "You must accept the Terms of Service and Privacy Policy to create an account.",
      "TERMS_NOT_ACCEPTED",
    );
  }

  if (input.contentResponsibilityAccepted !== true) {
    throw badRequest(
      "You must acknowledge that you are responsible for the content you upload to create an account.",
      "CONTENT_RESPONSIBILITY_NOT_ACCEPTED",
    );
  }

  // Version check. A stale browser tab is the common case here — the user is
  // looking at superseded wording, so recording their consent against the
  // current text would misrepresent what they read.
  const submitted = {
    terms: input.termsVersion,
    privacy: input.privacyVersion,
    contentPolicy: input.contentPolicyVersion,
  };
  for (const [key, current] of Object.entries(CURRENT_LEGAL_VERSIONS)) {
    if (submitted[key as keyof typeof submitted] !== current) {
      throw badRequest(
        "Our legal terms have been updated. Please reload the page and review the current terms before creating an account.",
        "LEGAL_VERSION_MISMATCH",
      );
    }
  }

  return {
    termsAccepted: true,
    contentResponsibilityAccepted: true,
    termsVersion: CURRENT_LEGAL_VERSIONS.terms,
    privacyVersion: CURRENT_LEGAL_VERSIONS.privacy,
    contentPolicyVersion: CURRENT_LEGAL_VERSIONS.contentPolicy,
    acceptedAt: new Date(),
    // Both are recorded for audit. Where a jurisdiction forbids storing the IP,
    // drop it at the controller rather than here so the shape stays uniform.
    ...(context.ip ? { ip: context.ip } : {}),
    ...(context.userAgent ? { userAgent: context.userAgent.slice(0, 512) } : {}),
  };
};
