import { LEGAL_DOCUMENTS } from "./legal/documents";

/**
 * Which page an address shows. The store is one app at "/", plus the legal
 * documents at addresses of their own so they can be linked to from anywhere
 * (sign-up in the partner app, payment providers, search results). Anything
 * else is not a page here.
 */
export type StoreRoute = { kind: "app" } | { kind: "legal"; docId: string } | { kind: "notFound" };

const LEGAL_SLUGS = new Set(Object.values(LEGAL_DOCUMENTS).map((doc) => doc.id));

export const resolveRoute = (pathname: string): StoreRoute => {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/index.html") return { kind: "app" };
  const legal = /^\/legal\/([a-z-]+)$/.exec(path);
  if (legal && LEGAL_SLUGS.has(legal[1])) return { kind: "legal", docId: legal[1] };
  return { kind: "notFound" };
};

/** The legal pages, in the order they are listed. */
export const LEGAL_PAGES = [LEGAL_DOCUMENTS.terms, LEGAL_DOCUMENTS.privacy, LEGAL_DOCUMENTS.contentPolicy].map((doc) => ({
  slug: doc.id,
  title: doc.title,
  path: `/legal/${doc.id}`,
}));
