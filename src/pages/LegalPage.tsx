import { useEffect } from "react";
import { MdWarningAmber } from "react-icons/md";
import { useLegalDocument } from "../lib/legal/documents";
import LegalText from "../components/common/LegalText";
import PublicPageShell from "./PublicPageShell";

/** A legal document at its own address, readable without opening the builder. */
export default function LegalPage({ docId }: { docId: string }) {
  const { doc, error, retry } = useLegalDocument(docId);

  useEffect(() => {
    // The page's own address, not the builder's, so search engines keep it as itself.
    document.querySelector('link[rel="canonical"]')?.setAttribute("href", `${window.location.origin}/legal/${docId}`);
  }, [docId]);
  useEffect(() => {
    if (doc) document.title = `${doc.title} — Space Transfers`;
  }, [doc]);

  return (
    <PublicPageShell>
      <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-10" aria-busy={!doc && !error}>
        {error ? (
          <div className="py-8 text-center">
            <p className="text-gray-700">{error}</p>
            <button onClick={retry} className="mt-3 text-sm font-semibold text-blue-600 hover:underline">
              Try again
            </button>
          </div>
        ) : !doc ? (
          <div className="space-y-3" aria-label="Loading">
            <div className="h-8 w-2/3 animate-pulse rounded bg-gray-100" />
            <div className="h-4 w-1/4 animate-pulse rounded bg-gray-100" />
            <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-gray-100" />
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{doc.title}</h1>
            <p className="mt-1 text-sm text-gray-500">Version {doc.version}</p>
            {doc.isDraft && (
              <div role="note" className="mt-5 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <MdWarningAmber className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  <strong className="font-semibold">Draft.</strong> This document has not been finalised yet.
                </span>
              </div>
            )}
            <LegalText text={doc.text} />
          </>
        )}
      </article>
    </PublicPageShell>
  );
}
