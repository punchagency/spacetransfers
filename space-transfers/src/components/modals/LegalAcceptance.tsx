import { useEffect } from "react";
import { MdCheckCircle } from "react-icons/md";
import { LEGAL_DOCUMENTS, fetchLegalVersions, type LegalKey, type LegalReadTimes } from "../../lib/legal/documents";

/**
 * The two mandatory acknowledgements shown during sign-up.
 *
 * Kept deliberately short. The full text of each agreement opens in its own
 * reader (`LegalDocumentModal`) rather than being inlined here — inline, the
 * content acknowledgement alone ran to ~600 characters in a ~310px column and
 * pushed the submit button out of the modal.
 *
 * The labels still state the binding commitment in plain words, because a
 * checkbox whose meaning is only discoverable behind a link is weak clickwrap.
 * What moved into the reader is the supporting detail — the non-verification
 * disclaimer, the indemnity, and the full terms — all reachable before
 * accepting, one tap away, without leaving the form.
 *
 * Accessibility:
 *  - Native `<input type="checkbox">`; keyboard and AT semantics come free.
 *  - The commitment text is inside the `<label>`, so it is the accessible name.
 *  - `aria-invalid` + `aria-describedby` tie each error to its control, and the
 *    error is `role="alert"` so it is announced when it appears after a submit.
 *  - Document triggers are `<button type="button">`, not links: they open a
 *    dialog rather than navigating, and `type="button"` stops them submitting
 *    the surrounding form.
 *
 * State is owned by the parent so the submit button can stay disabled until
 * both are true. Neither is ever pre-selected.
 *
 * A box can be ticked only once every document it covers has been read to the
 * end in the reader. Trying to tick it before then opens the first one still
 * unread, and the line under each box says which are read.
 */

/** The documents each acknowledgement covers. */
const COVERS: Record<"terms" | "content", LegalKey[]> = {
  terms: ["terms", "privacy"],
  content: ["contentPolicy"],
};

interface LegalAcceptanceProps {
  termsAccepted: boolean;
  contentResponsibilityAccepted: boolean;
  onTermsChange: (value: boolean) => void;
  onContentResponsibilityChange: (value: boolean) => void;
  /** True once the user has attempted to submit — errors stay hidden before that. */
  showErrors: boolean;
  disabled?: boolean;
  /** The auth dialog owns the reader so it can hide while a document is open. */
  onOpenDocument: (docId: string) => void;
  /** When each document was read to the end. */
  readAt: LegalReadTimes;
}

export default function LegalAcceptance({
  termsAccepted,
  contentResponsibilityAccepted,
  onTermsChange,
  onContentResponsibilityChange,
  showErrors,
  disabled,
  onOpenDocument,
  readAt,
}: LegalAcceptanceProps) {
  // Asked for as the form opens, so signing up does not wait on it.
  useEffect(() => {
    fetchLegalVersions().catch(() => {});
  }, []);

  const unread = (box: keyof typeof COVERS) => COVERS[box].filter((k) => !readAt[k]);
  /** Ticks the box, or opens the first document it covers that is still unread. */
  const tick = (box: keyof typeof COVERS, value: boolean, set: (v: boolean) => void) => {
    const [first] = unread(box);
    if (value && first) {
      onOpenDocument(LEGAL_DOCUMENTS[first].id);
      return;
    }
    set(value);
  };

  /** Which of a box's documents have been read, under the box. */
  const ReadStatus = ({ box, id }: { box: keyof typeof COVERS; id: string }) => {
    const left = unread(box);
    return (
      <p id={id} className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-[26px] text-[11px] text-gray-500">
        {left.length === 0 ? (
          <span className="flex items-center gap-1 font-medium text-emerald-700">
            <MdCheckCircle className="h-3.5 w-3.5" aria-hidden />
            Read to the end
          </span>
        ) : (
          <span>
            Read {COVERS[box].length > 1 ? "both documents" : "the policy"} to the end to tick this
            {COVERS[box].length > 1 && left.length === 1 ? ` (${LEGAL_DOCUMENTS[left[0]].title} still to read)` : ""}.
          </span>
        )}
      </p>
    );
  };

  const termsError = showErrors && !termsAccepted;
  const contentError = showErrors && !contentResponsibilityAccepted;

  const boxClass = (invalid: boolean) =>
    `mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-2 text-blue-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
      invalid ? "border-red-400" : "border-gray-300"
    }`;

  /** Opens a document reader. Must not toggle the checkbox it sits inside. */
  const DocButton = ({
    docKey,
    label,
  }: {
    docKey: LegalKey;
    label?: string;
  }) => (
    <button
      type="button"
      onClick={(e) => {
        // This trigger sits inside a <label>, so without both calls the click
        // would also toggle the associated checkbox.
        e.preventDefault();
        e.stopPropagation();
        onOpenDocument(LEGAL_DOCUMENTS[docKey].id);
      }}
      className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-sm"
    >
      {label ?? LEGAL_DOCUMENTS[docKey].title}
    </button>
  );

  return (
    <>
      {/* min-w-0: <fieldset> defaults to `min-width: min-content`, so without it
          the element refuses to shrink and punches out of a narrow parent. */}
      <fieldset className="min-w-0 space-y-2 rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
          Required agreements
        </legend>

        {/* 1 — Terms of Service + Privacy Policy */}
        <div>
          <label
            htmlFor="legal-terms"
            className="flex cursor-pointer items-start gap-2.5 text-[12px] leading-relaxed text-gray-700"
          >
            <input
              id="legal-terms"
              name="legalTerms"
              type="checkbox"
              checked={termsAccepted}
              disabled={disabled}
              onChange={(e) => tick("terms", e.target.checked, onTermsChange)}
              aria-invalid={termsError}
              aria-describedby={termsError ? "legal-terms-status legal-terms-error" : "legal-terms-status"}
              className={boxClass(termsError)}
            />
            <span>
              I have read and agree to the <DocButton docKey="terms" /> and{" "}
              <DocButton docKey="privacy" />.
            </span>
          </label>
          <ReadStatus box="terms" id="legal-terms-status" />
          {termsError && (
            <p
              id="legal-terms-error"
              role="alert"
              className="mt-1 pl-[26px] text-[11px] font-medium text-red-600"
            >
              You must accept the Terms of Service and Privacy Policy to continue.
            </p>
          )}
        </div>

        {/* 2 — Content ownership and responsibility */}
        <div>
          <label
            htmlFor="legal-content"
            className="flex cursor-pointer items-start gap-2.5 text-[12px] leading-relaxed text-gray-700"
          >
            <input
              id="legal-content"
              name="legalContentResponsibility"
              type="checkbox"
              checked={contentResponsibilityAccepted}
              disabled={disabled}
              onChange={(e) => tick("content", e.target.checked, onContentResponsibilityChange)}
              aria-invalid={contentError}
              aria-describedby={contentError ? "legal-content-status legal-content-error" : "legal-content-status"}
              className={boxClass(contentError)}
            />
            <span>
              I own or have permission to use everything I upload, and I accept sole responsibility
              for any intellectual property claims arising from it, as set out in the{" "}
              <DocButton docKey="contentPolicy" label="Content & IP Policy" />.
            </span>
          </label>
          <ReadStatus box="content" id="legal-content-status" />
          {contentError && (
            <p
              id="legal-content-error"
              role="alert"
              className="mt-1 pl-[26px] text-[11px] font-medium text-red-600"
            >
              You must acknowledge responsibility for the content you upload to continue.
            </p>
          )}
        </div>
      </fieldset>

    </>
  );
}
