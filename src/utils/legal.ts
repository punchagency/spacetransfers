import { apiFetch } from "./api";

/**
 * The legal documents a partner agrees to. Their wording and versions live on
 * the server, where admins edit them, and are published by the customer store.
 */

export interface LegalDocument {
  id: string;
  title: string;
  url: string;
}

export const LEGAL_DOCUMENTS: Record<"terms" | "privacy" | "contentPolicy", LegalDocument> = {
  terms: { id: "terms", title: "Terms of Service", url: "/legal/terms" },
  privacy: { id: "privacy", title: "Privacy Policy", url: "/legal/privacy" },
  contentPolicy: { id: "content-policy", title: "Content & Intellectual Property Policy", url: "/legal/content-policy" },
};

export interface LegalVersions {
  terms: string;
  privacy: string;
  contentPolicy: string;
}

let versions: Promise<LegalVersions> | null = null;
let fetchedAt = 0;

/**
 * The versions published now. Kept for a minute, as the server does, so a page
 * left open across a new publication picks it up instead of sending the old one.
 */
export const fetchLegalVersions = (): Promise<LegalVersions> => {
  if (versions && Date.now() - fetchedAt > 60_000) versions = null;
  if (!versions) fetchedAt = Date.now();
  versions ??= apiFetch("/public/legal")
    .then((data: any) => {
      const byId = Object.fromEntries((data?.documents || []).map((d: any) => [d.id, String(d.version)]));
      return { terms: byId["terms"], privacy: byId["privacy"], contentPolicy: byId["content-policy"] };
    })
    .catch((err: unknown) => {
      versions = null;
      throw err;
    });
  return versions;
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
 * rule out. The versions are those published now, the wording the partner was
 * shown.
 */
export const buildLegalAcceptancePayload = (
  termsAccepted: boolean,
  contentResponsibilityAccepted: boolean,
  current: LegalVersions,
): LegalAcceptancePayload => ({
  termsAccepted: termsAccepted === true,
  contentResponsibilityAccepted: contentResponsibilityAccepted === true,
  termsVersion: current.terms,
  privacyVersion: current.privacy,
  contentPolicyVersion: current.contentPolicy,
});

/**
 * Where a document can be read. The documents are published by the customer
 * store; this app has no pages for them, so a relative link landed on a page
 * that does not exist here. VITE_STORE_URL names the store; without it, the
 * store is assumed to sit beside this app at "store." in place of "printer.".
 */
export const storeOrigin = (env: string | undefined, here: string): string => {
  const configured = (env || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  try {
    const url = new URL(here);
    if (url.hostname.startsWith("printer.")) url.hostname = "store." + url.hostname.slice("printer.".length);
    return url.origin;
  } catch {
    return "";
  }
};

export const legalUrl = (doc: LegalDocument): string =>
  `${storeOrigin(import.meta.env.VITE_STORE_URL, typeof window === "undefined" ? "" : window.location.origin)}${doc.url}`;
