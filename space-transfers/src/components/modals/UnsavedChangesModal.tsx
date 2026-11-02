import { MdClose } from "react-icons/md";

type UnsavedChangesModalProps = {
  isOpen: boolean;
  title?: string;
  message: string;
  primaryLabel: string;
  secondaryLabel: string;
  cancelLabel?: string;
  isBusy?: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
  onCancel: () => void;
};

export default function UnsavedChangesModal({
  isOpen,
  title = "Unsaved Changes",
  message,
  primaryLabel,
  secondaryLabel,
  cancelLabel = "Cancel",
  isBusy = false,
  onPrimary,
  onSecondary,
  onCancel,
}: UnsavedChangesModalProps) {
  if (!isOpen) return null;

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
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-gray-900">{title}</h2>
            <p className="mt-1 text-[12px] text-gray-500">{message}</p>
          </div>
          <button
            onClick={() => {
              if (!isBusy) onCancel();
            }}
            className="text-gray-400 hover:text-gray-600"
            disabled={isBusy}
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="flex flex-col gap-2">
            <button
              onClick={onPrimary}
              disabled={isBusy}
              className={`w-full rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white ${
                isBusy ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {primaryLabel}
            </button>
            <button
              onClick={onSecondary}
              disabled={isBusy}
              className={`w-full rounded-lg border px-4 py-2.5 text-[13px] font-semibold ${
                isBusy
                  ? "border-gray-200 text-gray-400 cursor-not-allowed"
                  : "border-gray-200 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {secondaryLabel}
            </button>
            <button
              onClick={onCancel}
              disabled={isBusy}
              className={`w-full rounded-lg px-4 py-2.5 text-[13px] font-semibold ${
                isBusy ? "text-gray-400 cursor-not-allowed" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {cancelLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

