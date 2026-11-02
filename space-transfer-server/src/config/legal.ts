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
    version: "2026-10-29",
    url: "/legal/terms",
  },
  privacy: {
    id: "privacy",
    title: "Privacy Policy",
    version: "2026-10-29",
    url: "/legal/privacy",
  },
  contentPolicy: {
    id: "content-policy",
    title: "Content & Intellectual Property Policy",
    version: "2026-10-29",
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
  /** When the person reached the end of each document in the sign-up reader, as ISO times. */
  readAt?: unknown;
}

/** When each document was read to the end before accepting. */
export interface LegalReadRecord {
  terms: Date;
  privacy: Date;
  contentPolicy: Date;
}

/** What gets persisted on the user. */
export interface LegalAcceptanceRecord {
  termsAccepted: true;
  contentResponsibilityAccepted: true;
  termsVersion: string;
  privacyVersion: string;
  contentPolicyVersion: string;
  readAt: LegalReadRecord;
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

/** How long a reading stays good for a sign-up, and how far a browser clock may run ahead. */
const READ_VALID_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * The sign-up forms only let a box be ticked once each document it covers has
 * been scrolled to the end, and send when that happened. A sign-up without
 * those times, or with times that can't be real, didn't come through that
 * reader, so it is refused rather than recorded as read.
 */
const readTimes = (value: unknown, now = Date.now()): LegalReadRecord => {
  const at = (key: keyof LegalReadRecord) => {
    const raw = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
    const time = typeof raw === "string" ? Date.parse(raw) : NaN;
    if (!Number.isFinite(time) || time > now + CLOCK_SKEW_MS || time < now - READ_VALID_MS) {
      throw badRequest(
        "Please open each agreement and read it to the end before creating an account.",
        "LEGAL_NOT_READ",
      );
    }
    return new Date(Math.min(time, now));
  };
  return { terms: at("terms"), privacy: at("privacy"), contentPolicy: at("contentPolicy") };
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
  /** The versions published now; admins change them from the console. */
  current: { terms: string; privacy: string; contentPolicy: string } = CURRENT_LEGAL_VERSIONS,
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
  for (const [key, version] of Object.entries(current)) {
    if (submitted[key as keyof typeof submitted] !== version) {
      throw badRequest(
        "Our legal terms have been updated. Please reload the page and review the current terms before creating an account.",
        "LEGAL_VERSION_MISMATCH",
      );
    }
  }

  const readAt = readTimes(input.readAt);

  return {
    termsAccepted: true,
    contentResponsibilityAccepted: true,
    termsVersion: current.terms,
    privacyVersion: current.privacy,
    contentPolicyVersion: current.contentPolicy,
    readAt,
    acceptedAt: new Date(),
    // Both are recorded for audit. Where a jurisdiction forbids storing the IP,
    // drop it at the controller rather than here so the shape stays uniform.
    ...(context.ip ? { ip: context.ip } : {}),
    ...(context.userAgent ? { userAgent: context.userAgent.slice(0, 512) } : {}),
  };
};
