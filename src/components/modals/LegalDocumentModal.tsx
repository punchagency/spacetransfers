import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MdCheckCircle, MdClose, MdWarningAmber } from "react-icons/md";
import { readingProgress, useLegalDocument } from "../../lib/legal/documents";
import LegalText from "../common/LegalText";

/**
 * Reader for a single legal document, opened from the sign-up agreements.
 *
 * Mounted from within the sign-up form but portalled to <body> (see the note at
 * the return). AuthModal closes on a backdrop click and its card stops
 * propagation; because React events bubble through the component tree rather
 * than the DOM, that shield still applies here — without it, closing this reader
 * would also close sign-up and discard the half-filled form.
 *
 * Focus handling: focus moves to the close button on open and returns to the
 * trigger on close, so a keyboard user is not dropped back at the top of the
 * page. Escape closes only this layer (AuthModal has no key handler of its own).
 *
 * Reading to the end: sign-up only lets a box be ticked once each document it
 * covers has been scrolled to its last line here. The footer shows how far
 * through the document the reader is, then, at the end, offers the next
 * document still to read or the way back to the form.
 */

interface LegalDocumentModalProps {
  /** The document to show, "terms", "privacy" or "content-policy"; null when closed. */
  docId: string | null;
  onClose: () => void;
  /** When this document was already read to the end, if it was. */
  readAt?: string;
  /** Called once the reader reaches the end of the document. */
  onReadToEnd?: () => void;
  /** The next document still to be read, offered at the end of this one. */
  next?: { title: string; onOpen: () => void };
}

export default function LegalDocumentModal({ docId, onClose, readAt, onReadToEnd, next }: LegalDocumentModalProps) {
  const { doc, error, retry } = useLegalDocument(docId);
  const [progress, setProgress] = useState(0);
  const [reachedEnd, setReachedEnd] = useState(false);
  const tracksReading = Boolean(onReadToEnd);
  const done = reachedEnd || Boolean(readAt);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Remembered so focus can be handed back to whatever opened this.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Kept current so the effects below don't re-run when the parent re-renders.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isOpen = Boolean(docId);

  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      returnFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  // Each document starts at the top rather than inheriting the last one's
  // scroll position, and is read afresh.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    setProgress(0);
    setReachedEnd(false);
  }, [docId]);

  const measure = useCallback(() => {
    const el = bodyRef.current;
    if (!el || !doc) return;
    const { atEnd, fraction } = readingProgress(el);
    setProgress((p) => Math.max(p, fraction));
    if (atEnd && !reachedEnd) {
      setReachedEnd(true);
      onReadToEnd?.();
    }
  }, [doc, reachedEnd, onReadToEnd]);

  // A document short enough to fit is read as soon as it is shown.
  useEffect(() => {
    if (!doc) return;
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [doc, measure]);

  if (!docId) return null;

  // Portalled to <body>: AuthModal's backdrop uses `backdrop-filter`, which
  // creates a containing block for fixed-position descendants, and its card is
  // an `overflow-y-auto` scroll container. Rendering in place would make this
  // reader's positioning depend on both. React events still bubble through the
  // component tree, so the card's stopPropagation continues to shield
  // AuthModal's close-on-backdrop-click handler from clicks in here.
  return createPortal(
    <div
      // Match the sign-up dialog's backdrop so opening a document does not
      // look like an extra, darker overlay has been added.
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-doc-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* Header stays put while the body scrolls, so the close control is
            always reachable in a long document. */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id="legal-doc-title" className="text-[15px] font-semibold text-gray-900">
              {doc?.title ?? "Loading…"}
            </h2>
            {doc && <p className="mt-0.5 text-[11px] text-gray-500">Version {doc.version}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={`Close ${doc?.title ?? "document"}`}
            className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div
          ref={bodyRef}
          onScroll={measure}
          // Focusable so the document can be scrolled with the keyboard.
          tabIndex={0}
          aria-label={doc ? `${doc.title}, scrollable` : undefined}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40"
        >
          {error ? (
            <div className="py-6 text-center text-[12.5px] text-gray-700">
              <p>{error}</p>
              <button type="button" onClick={retry} className="mt-2 font-semibold text-blue-600 hover:underline">
                Try again
              </button>
            </div>
          ) : !doc ? (
            <p className="py-6 text-center text-[12.5px] text-gray-500">Loading…</p>
          ) : (
            <>
              {doc.isDraft && (
                <div
                  role="note"
                  className="mb-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11.5px] leading-relaxed text-amber-900"
                >
                  <MdWarningAmber className="mt-px h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    <strong className="font-semibold">Draft.</strong> This document has not been finalised yet.
                  </span>
                </div>
              )}
              <LegalText text={doc.text} compact />
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-gray-100 px-5 py-3">
          {tracksReading && doc && (
            <div className="mb-2.5" aria-live="polite">
              {done ? (
                <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-700">
                  <MdCheckCircle className="h-4 w-4 shrink-0" aria-hidden />
                  Read to the end
                </p>
              ) : (
                <>
                  <div
                    className="h-1 overflow-hidden rounded-full bg-gray-100"
                    role="progressbar"
                    aria-label="How much of the document you have read"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress * 100)}
                  >
                    <div className="h-full rounded-full bg-blue-600 transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-gray-500">Scroll to the end to agree to this document.</p>
                </>
              )}
            </div>
          )}
          {/* Deliberately not an "Accept" button: acceptance belongs to the
              checkboxes on the sign-up form, so there is exactly one place a
              user can consent and one place the state lives. */}
          {tracksReading && done && next ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-[13px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
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
              {tracksReading && done ? "Back to sign-up" : "Close"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
