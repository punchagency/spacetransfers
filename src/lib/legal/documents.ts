import { useEffect, useState } from "react";
import { apiFetch } from "../utils/api";
import { parseLegalMarkup, type ParsedLegalText } from "./markup";

/**
 * The legal documents. Their wording and versions live on the server, where
 * admins edit them; this names them and fetches what is current.
 */

export type LegalKey = "terms" | "privacy" | "contentPolicy";

export const LEGAL_DOCUMENTS: Record<LegalKey, { id: string; title: string; url: string }> = {
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

/** Payload shape expected by `POST /auth/register` and `POST /auth/google`. */
export interface LegalAcceptancePayload {
  termsAccepted: boolean;
  contentResponsibilityAccepted: boolean;
  termsVersion: string;
  privacyVersion: string;
  contentPolicyVersion: string;
}

/**
 * The acceptance block for a sign-up: both ticks, and the version of each
 * document that is published now, which is the wording the person was shown.
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

export interface LegalDocumentText {
  id: string;
  title: string;
  version: string;
  isDraft: boolean;
  text: ParsedLegalText;
}

/** One document's current wording, fetched when it is opened. */
export const useLegalDocument = (docId: string | null) => {
  const [doc, setDoc] = useState<LegalDocumentText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!docId) return;
    let alive = true;
    setDoc(null);
    setError(null);
    apiFetch(`/public/legal/${encodeURIComponent(docId)}`)
      .then((data: any) => {
        if (!alive) return;
        setDoc({ id: data.id, title: data.title, version: data.version, isDraft: Boolean(data.isDraft), text: parseLegalMarkup(data.body) });
      })
      .catch((err: any) => {
        if (alive) setError(err?.message || "This document couldn't be loaded.");
      });
    return () => {
      alive = false;
    };
  }, [docId, attempt]);

  return { doc, error, retry: () => setAttempt((n) => n + 1) };
};
