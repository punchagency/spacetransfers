import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiCheckCircle, FiX } from "react-icons/fi";
import { apiFetch } from "../../utils/api";
import { LEGAL_DOCUMENTS, readingProgress, type LegalKey } from "../../utils/legal";
import { parseLegalMarkup, type LegalBlock, type ParsedLegalText } from "../../utils/legalMarkup";

/**
 * One legal document, read in place during sign-up.
 *
 * The agreements' boxes can be ticked only once each document has been
 * scrolled to its last line here, so the text is shown in this app rather than
 * in a store tab whose scrolling this app can't see. The footer shows how far
 * through the reader is, then offers the next document still to read or the
 * way back to the form. Escape and the backdrop close it.
 */

interface LegalReaderProps {
  docKey: LegalKey;
  onClose: () => void;
  /** When this document was already read to the end, if it was. */
  readAt?: string;
  onReadToEnd: () => void;
  /** The next document still to be read, offered at the end of this one. */
  next?: { title: string; onOpen: () => void };
}

const Blocks = ({ list }: { list: LegalBlock[] }) => (
  <>
    {list.map((b, i) =>
      b.type === "p" ? (
        <p key={i} className="mt-1 text-[12px] leading-relaxed text-slate-600">
          {b.text}
        </p>
      ) : (
        <ul key={i} className="mt-1.5 list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-slate-600">
          {b.items.map((item, j) => (
            <li key={j}>{item}</li>
          ))}
        </ul>
      ),
    )}
  </>
);

export const LegalReader = ({ docKey, onClose, readAt, onReadToEnd, next }: LegalReaderProps) => {
  const [doc, setDoc] = useState<{ title: string; version: string; text: ParsedLegalText } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState(0);
  const [reachedEnd, setReachedEnd] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const done = reachedEnd || Boolean(readAt);

  useEffect(() => {
    let alive = true;
    setDoc(null);
    setError(null);
    setProgress(0);
    setReachedEnd(false);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    apiFetch(`/public/legal/${encodeURIComponent(LEGAL_DOCUMENTS[docKey].id)}`)
      .then((data: any) => {
        if (alive) setDoc({ title: data.title, version: String(data.version), text: parseLegalMarkup(data.body) });
      })
      .catch((err: any) => {
        if (alive) setError(err?.message || "This document couldn't be loaded.");
      });
    return () => {
      alive = false;
    };
  }, [docKey, attempt]);

  // Kept current so opening effects don't re-run when the form re-renders.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  const measure = useCallback(() => {
    const el = bodyRef.current;
    if (!el || !doc) return;
    const { atEnd, fraction } = readingProgress(el);
    setProgress((p) => Math.max(p, fraction));
    if (atEnd && !reachedEnd) {
      setReachedEnd(true);
      onReadToEnd();
    }
  }, [doc, reachedEnd, onReadToEnd]);

  // A document short enough to fit is read as soon as it is shown.
  useEffect(() => {
    if (!doc) return;
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [doc, measure]);

  const title = doc?.title ?? LEGAL_DOCUMENTS[docKey].title;
  const pct = Math.round(progress * 100);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-reader-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id="legal-reader-title" className="text-[15px] font-semibold text-slate-900">
              {title}
            </h2>
            {doc && <p className="mt-0.5 text-[11px] text-slate-500">Version {doc.version}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <FiX className="h-5 w-5" />
          </button>
        </div>

        <div
          ref={bodyRef}
          onScroll={measure}
          // Focusable so the document can be scrolled with the keyboard.
          tabIndex={0}
          aria-label={`${title}, scrollable`}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40"
        >
          {error ? (
            <div className="py-6 text-center text-[12.5px] text-slate-700">
              <p>{error}</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-2 font-semibold text-blue-600 hover:underline">
                Try again
              </button>
            </div>
          ) : !doc ? (
            <p className="py-6 text-center text-[12.5px] text-slate-500">Loading…</p>
          ) : (
            <>
              {doc.text.intro.length > 0 && (
                <div className="mb-4">
                  <Blocks list={doc.text.intro} />
                </div>
              )}
              <div className="space-y-4">
                {doc.text.sections.map((section, i) => (
                  <section key={i}>
                    <h3 className="text-[12.5px] font-semibold text-slate-900">{section.heading}</h3>
                    <Blocks list={section.blocks} />
                  </section>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 px-5 py-3">
          {doc && (
            <div className="mb-2.5" aria-live="polite">
              {done ? (
                <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-700">
                  <FiCheckCircle className="h-4 w-4 shrink-0" aria-hidden />
                  Read to the end
                </p>
              ) : (
                <>
                  <div
                    className="h-1 overflow-hidden rounded-full bg-slate-100"
                    role="progressbar"
                    aria-label="How much of the document you have read"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                  >
                    <div className="h-full rounded-full bg-blue-600 transition-[width] duration-150" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-slate-500">Scroll to the end to agree to this document.</p>
                </>
              )}
            </div>
          )}
          {done && next ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                Back
              </button>
              <button
                type="button"
                onClick={next.onOpen}
                className="flex-1 rounded-xl bg-slate-900 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                Next: {next.title}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-slate-900 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              {done ? "Back to the form" : "Close"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
