import { Modal } from "./Modal";

/**
 * Asks before a step that changes a job for someone else — the customer's
 * order, the label bought, the admin's view. Status buttons used to act on the
 * first click, so a stray tap moved a job forward, and moves are forward-only.
 */
export function ConfirmDialog({
  isOpen,
  title,
  body,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onClose={() => (busy ? undefined : onCancel())} title={title} className="max-w-md">
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-gray-600">{body}</p>
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
          >
            Not yet
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
