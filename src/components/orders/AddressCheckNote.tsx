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
export default function AddressCheckNote({ check }: { check?: AddressCheck | null }) {
    if (check?.status !== "differs" && check?.status !== "not_found") return null;
    return (
        <div role="note" className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
            <FiAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <div className="space-y-0.5">
                <p className="font-semibold">
                    {check.status === "differs" ? "The customer kept an address the carrier corrected" : "The carrier couldn't find this address"}
                </p>
                {check.status === "differs" && check.suggestion && <p>The carrier's version: {check.suggestion}</p>}
                {check.status === "not_found" && check.reason && REASONS[check.reason] && <p>{REASONS[check.reason]}</p>}
                <p className="text-amber-900">Confirm it with the customer before the label is bought.</p>
            </div>
        </div>
    );
}
