import { useState, type ReactNode } from "react";
import { FaCheck } from "react-icons/fa";
import { FiCheckCircle } from "react-icons/fi";
import { LEGAL_DOCUMENTS, type LegalKey, type LegalReadTimes } from "../../utils/legal";
import { LegalReader } from "./LegalReader";

/**
 * The two acknowledgements a partner gives when they sign up or accept an
 * invitation, with the documents they cover.
 *
 * A box can be ticked only once every document it covers has been read to the
 * end in the reader. Trying to tick it before then opens the first one still
 * unread, and the line under each box says which are read. The read times go
 * to the server with the acceptance, which records them.
 */

const COVERS: Record<"terms" | "content", LegalKey[]> = {
  terms: ["terms", "privacy"],
  content: ["contentPolicy"],
};
const ORDER: LegalKey[] = ["terms", "privacy", "contentPolicy"];

interface LegalAgreementsProps {
  termsAccepted: boolean;
  onTermsChange: (value: boolean) => void;
  contentAccepted: boolean;
  onContentChange: (value: boolean) => void;
  readAt: LegalReadTimes;
  onRead: (key: LegalKey) => void;
  /** Prefix for element ids, so two forms on a page never share one. */
  idPrefix: string;
}

export const LegalAgreements = ({
  termsAccepted,
  onTermsChange,
  contentAccepted,
  onContentChange,
  readAt,
  onRead,
  idPrefix,
}: LegalAgreementsProps) => {
  const [open, setOpen] = useState<LegalKey | null>(null);
  const unread = (box: keyof typeof COVERS) => COVERS[box].filter((k) => !readAt[k]);

  /** Ticks or unticks the box, or opens the first document it covers that is still unread. */
  const toggle = (box: keyof typeof COVERS, checked: boolean, set: (v: boolean) => void) => {
    const [first] = unread(box);
    if (!checked && first) {
      setOpen(first);
      return;
    }
    set(!checked);
  };

  const DocLink = ({ docKey }: { docKey: LegalKey }) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setOpen(docKey);
      }}
      className="text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-sm"
    >
      {LEGAL_DOCUMENTS[docKey].title}
    </button>
  );

  const Box = ({ box, checked, set, children }: { box: keyof typeof COVERS; checked: boolean; set: (v: boolean) => void; children: ReactNode }) => {
    const left = unread(box);
    const id = `${idPrefix}-${box}`;
    return (
      <div>
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => toggle(box, checked, set)}
            role="checkbox"
            aria-checked={checked}
            aria-labelledby={id}
            aria-describedby={`${id}-status`}
            className={`mt-0.5 flex-shrink-0 h-4 w-4 rounded border transition-colors flex items-center justify-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
              checked ? "bg-blue-600 border-blue-600" : "bg-white border-slate-300 hover:border-blue-400"
            }`}
          >
            {checked && <FaCheck className="text-white text-[9px]" />}
          </button>
          <span id={id} onClick={() => toggle(box, checked, set)} className="text-xs text-slate-500 leading-snug cursor-pointer select-none">
            {children}
          </span>
        </div>
        <p id={`${id}-status`} className="mt-1 pl-6 text-[11px] text-slate-400">
          {left.length === 0 ? (
            <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
              <FiCheckCircle className="h-3 w-3" aria-hidden />
              Read to the end
            </span>
          ) : (
            <>
              Read {COVERS[box].length > 1 ? "both documents" : "the policy"} to the end to tick this
              {COVERS[box].length > 1 && left.length === 1 ? ` (${LEGAL_DOCUMENTS[left[0]].title} still to read)` : ""}.
            </>
          )}
        </p>
      </div>
    );
  };

  const nextKey = open ? ORDER.find((k) => k !== open && !readAt[k]) : undefined;

  return (
    <div className="space-y-2.5 pt-1">
      <Box box="terms" checked={termsAccepted} set={onTermsChange}>
        I have read and agree to the <DocLink docKey="terms" /> and <DocLink docKey="privacy" />
      </Box>
      <Box box="content" checked={contentAccepted} set={onContentChange}>
        I accept the <DocLink docKey="contentPolicy" /> and am solely responsible for the content uploaded through this account
      </Box>
      {open && (
        <LegalReader
          docKey={open}
          onClose={() => setOpen(null)}
          readAt={readAt[open]}
          onReadToEnd={() => onRead(open)}
          next={nextKey ? { title: LEGAL_DOCUMENTS[nextKey].title, onOpen: () => setOpen(nextKey) } : undefined}
        />
      )}
    </div>
  );
};
