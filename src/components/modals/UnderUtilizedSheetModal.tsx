import { MdClose } from "react-icons/md";

export default function UnderUtilizedSheetModal({
  isOpen,
  sheetSizeLabel,
  fullSheetAmount,
  utilizationPct,
  isBusy = false,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  sheetSizeLabel: string;
  fullSheetAmount: number;
  utilizationPct: number | null;
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!isOpen) return null;

  const amountText = `$${Number(fullSheetAmount || 0).toFixed(2)}`;
  const pctText =
    utilizationPct != null && Number.isFinite(utilizationPct)
      ? `${Math.max(0, Math.min(100, Math.round(utilizationPct)))}%`
      : "N/A";

  return (
    <div
      onClick={() => {
        if (!isBusy) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl mx-4"
        role="dialog"
        aria-modal="true"
        aria-label="Unused gang sheet space warning"
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-gray-900">
              Unused Sheet Space
            </h2>
            <p className="mt-1 text-[12px] text-gray-500">
              Your {sheetSizeLabel} gang sheet is not fully utilized.
            </p>
          </div>
          <button
            onClick={() => {
              if (!isBusy) onCancel();
            }}
            className="text-gray-400 hover:text-gray-600"
            disabled={isBusy}
            aria-label="Close"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-[13px] text-amber-900 font-semibold">
              You will be charged the full gang sheet amount of {amountText}.
            </p>
            <p className="mt-1 text-[12px] text-amber-800">
              Utilization: <span className="font-semibold">{pctText}</span>
            </p>
          </div>

          <p className="text-[12px] text-gray-500">
            Continue adding items to maximize your sheet, or add to cart anyway.
          </p>

          <div className="flex flex-col gap-2 pt-1">
            <button
              onClick={onConfirm}
              disabled={isBusy}
              className={`w-full rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white ${
                isBusy ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {isBusy ? "Adding..." : `Add to Cart (Charge ${amountText})`}
            </button>
            <button
              onClick={onCancel}
              disabled={isBusy}
              className={`w-full rounded-lg border px-4 py-2.5 text-[13px] font-semibold ${
                isBusy
                  ? "border-gray-200 text-gray-400 cursor-not-allowed"
                  : "border-gray-200 text-gray-700 hover:bg-gray-50"
              }`}
            >
              Continue Adding Items
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

