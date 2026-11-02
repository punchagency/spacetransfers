import { useState } from "react";
import toast from "react-hot-toast";
import { apiFetch } from "../../utils/api";

interface ResetPasskeysProps {
  userId: string;
  /** Whose passkeys, as the confirmation names them. */
  accountLabel: string;
  onReset: () => void;
}

/**
 * Clears another account's passkeys when its owner has lost the device and the
 * recovery codes. A reason is required and every admin is told.
 */
export function ResetPasskeys({ userId, accountLabel, onReset }: ResetPasskeysProps) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim()) return setError("Say why the passkeys are being reset.");
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/admin/users/${encodeURIComponent(userId)}/reset-passkeys`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      toast.success(`Passkeys reset for ${accountLabel}. They have been signed out.`, { duration: 7000 });
      setAsking(false);
      setReason("");
      onReset();
    } catch (e: any) {
      setError(e?.message || "The passkeys could not be reset.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setAsking(true)}
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Reset passkeys
      </button>
      {asking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" aria-label={`Reset passkeys for ${accountLabel}`} className="w-full max-w-md rounded-2xl bg-white p-6 text-left shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Reset passkeys for {accountLabel}?</h3>
            <p className="mt-1 text-sm text-gray-500">
              Use this only when they have lost their device and their recovery codes, and you are sure it is them
              asking. Their passkeys and codes are removed and they are signed out everywhere. Every admin is notified.
            </p>
            <label htmlFor="reset-passkeys-reason" className="mt-4 block text-sm font-medium text-gray-700">
              Reason <span className="font-normal text-gray-500">(required)</span>
            </label>
            <textarea
              id="reset-passkeys-reason"
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError(null); }}
              rows={3}
              placeholder="e.g. Lost phone, confirmed by video call."
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            {error && (
              <p role="alert" className="mt-1 text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
              <button onClick={() => { setAsking(false); setError(null); }} disabled={busy} className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={() => void submit()} disabled={busy} className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                {busy ? "Resetting…" : "Reset passkeys"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
