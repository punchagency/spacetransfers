import { FiAlertTriangle } from "react-icons/fi";

export type AddressCheck = {
  status: "verified" | "differs" | "not_found" | "unchecked";
  suggestion?: string;
  reason?: string;
};

const REASONS: Record<string, string> = {
  missing_unit: "It may be missing an apartment or suite number.",
  invalid_unit: "Its apartment or suite number didn't match the building.",
  house_number: "Its house or building number didn't match the street.",
};

/** Shown when the customer shipped to an address the carrier didn't confirm at checkout. */
export const AddressCheckNote = ({ check }: { check?: AddressCheck | null }) => {
  if (check?.status !== "differs" && check?.status !== "not_found") return null;
  return (
    <div role="note" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-950">
      <FiAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
      <div>
        <p className="font-semibold">
          {check.status === "differs" ? "The customer kept an address the carrier corrected" : "The carrier couldn't find this address"}
        </p>
        {check.status === "differs" && check.suggestion && <p>The carrier's version: {check.suggestion}</p>}
        {check.status === "not_found" && check.reason && REASONS[check.reason] && <p>{REASONS[check.reason]}</p>}
        <p className="text-amber-900">If it looks wrong, contact Space Transfers before you buy the label.</p>
      </div>
    </div>
  );
};
