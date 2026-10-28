import { useEffect, useRef, useState, type ReactNode } from "react";
import { MdClose, MdWarningAmber } from "react-icons/md";
import { NOT_FOUND_HINT, type AddressFields, type NotFoundReason } from "../../lib/utils/addressCheck";

export type AddressPrompt =
  | { status: "suggested"; suggestion: AddressFields; changed: (keyof AddressFields)[] }
  | { status: "not_found"; reason: NotFoundReason };

type Props = {
  prompt: AddressPrompt | null;
  entered: AddressFields;
  /** Ship to this address: the carrier's version or the customer's own. */
  onUse: (address: AddressFields) => void;
  /** Back to the form. Closing the dialog any other way means this too. */
  onEdit: () => void;
};

/** A part of the carrier's version that isn't what the customer typed. */
const Changed = ({ changed, children }: { changed: boolean; children: ReactNode }) =>
  changed ? <mark className="rounded bg-amber-100 px-0.5 text-amber-950">{children}</mark> : <>{children}</>;

/**
 * Asked when the customer presses Continue and the carrier disagrees with the
 * address: either it has a corrected version, or it can't find the address.
 */
export default function AddressCheckModal({ prompt, entered, onUse, onEdit }: Props) {
  const [choice, setChoice] = useState<"suggested" | "entered">("suggested");
  const primaryRef = useRef<HTMLButtonElement>(null);
  // Read through a ref so a parent re-render doesn't reset the choice made here.
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;

  useEffect(() => {
    if (!prompt) return;
    setChoice("suggested");
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onEditRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [prompt]);

  if (!prompt) return null;

  const suggested = prompt.status === "suggested" ? prompt.suggestion : null;
  const changed = new Set(prompt.status === "suggested" ? prompt.changed : []);
  const title = suggested ? "Confirm your shipping address" : "We couldn't verify this address";
  const message = suggested
    ? "The carrier has a slightly different version of it. Choose the one to ship to."
    : NOT_FOUND_HINT[prompt.status === "not_found" ? prompt.reason : "not_found"];

  const option = (value: "suggested" | "entered", heading: string, body: ReactNode) => (
    <label
      className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${
        choice === value ? "border-blue-600 bg-blue-50/60 ring-1 ring-blue-600" : "border-gray-200 hover:bg-gray-50"
      }`}
    >
      <input
        type="radio"
        name="address-choice"
        value={value}
        checked={choice === value}
        onChange={() => setChoice(value)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
      />
      <span className="min-w-0 text-[13px] leading-relaxed text-gray-700">
        <span className="mb-0.5 flex items-center gap-2 text-[12px] font-semibold text-gray-900">
          {heading}
          {value === "suggested" && (
            <span className="rounded-full bg-blue-100 px-1.5 py-px text-[10px] font-semibold text-blue-700">Recommended</span>
          )}
        </span>
        {body}
      </span>
    </label>
  );

  return (
    <div onClick={onEdit} className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="address-check-title"
        aria-describedby="address-check-message"
        onClick={(e) => e.stopPropagation()}
        className="mx-4 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div>
            <h2 id="address-check-title" className="text-[16px] font-semibold text-gray-900">{title}</h2>
            <p id="address-check-message" className="mt-1 text-[12px] text-gray-500">{message}</p>
          </div>
          <button type="button" onClick={onEdit} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {suggested ? (
            <div className="space-y-2" role="radiogroup" aria-label="Shipping address">
              {option(
                "suggested",
                "Suggested by the carrier",
                <>
                  <Changed changed={changed.has("street")}>{suggested.street}</Changed>
                  <br />
                  <Changed changed={changed.has("city")}>{suggested.city}</Changed>,{" "}
                  <Changed changed={changed.has("state")}>{suggested.state}</Changed>{" "}
                  <Changed changed={changed.has("postalCode")}>{suggested.postalCode}</Changed>
                </>,
              )}
              {option(
                "entered",
                "As you entered it",
                <>
                  {entered.street}
                  <br />
                  {entered.city}, {entered.state} {entered.postalCode}
                </>,
              )}
              <p className="pt-1 text-[11px] text-gray-500">Shipping is priced for the address you choose.</p>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-950">
              <MdWarningAmber className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <span>
                {entered.street}
                <br />
                {entered.city}, {entered.state} {entered.postalCode}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              ref={primaryRef}
              type="button"
              onClick={() => (suggested ? onUse(choice === "suggested" ? suggested : entered) : onEdit())}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700"
            >
              {suggested ? "Use this address" : "Edit address"}
            </button>
            {suggested ? (
              <button
                type="button"
                onClick={onEdit}
                className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
              >
                Edit address
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onUse(entered)}
                  className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Ship to this address anyway
                </button>
                <p className="text-center text-[11px] text-gray-500">
                  A parcel the carrier can't deliver comes back to the printer.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
