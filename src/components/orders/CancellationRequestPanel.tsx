import { useState } from "react";
import toast from "react-hot-toast";
import { FiAlertCircle } from "react-icons/fi";
import { apiFetch } from "../../utils/api";
import { ConfirmDialog } from "../common/ConfirmDialog";

export interface PartnerCancellationRequest {
  status: "PENDING" | "ACCEPTED" | "DECLINED";
  reason: string | null;
  requestedAt: string | null;
  declineReason: string | null;
}

const when = (value: string | null) =>
  value ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/**
 * The customer has asked to cancel. The partner accepts, which cancels and
 * refunds the order, or declines and says why. Until then the job is on hold.
 */
export function CancellationRequestPanel({
  orderId,
  displayId,
  request,
  onAnswered,
}: {
  orderId: string;
  displayId: string;
  request: PartnerCancellationRequest | null | undefined;
  onAnswered: () => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!request) return null;
  if (request.status === "DECLINED") {
    return (
      <div role="status" className="rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600">
        The customer asked to cancel and you declined: <span className="text-gray-900">“{request.declineReason}”</span>
      </div>
    );
  }
  if (request.status !== "PENDING") return null;

  const answer = async (decision: "accept" | "decline") => {
    if (busy) return;
    if (decision === "decline" && reason.trim().length < 3) return setError("Tell the customer why, in a few words.");
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/printer/orders/${encodeURIComponent(orderId)}/cancellation`, {
        method: "POST",
        body: JSON.stringify({ decision, reason: reason.trim() }),
      });
      toast.success(
        decision === "decline"
          ? "Declined. The customer has been told why."
          : Number(res?.refundAmount) > 0
            ? `Order ${displayId} cancelled. The customer has been refunded.`
            : `Order ${displayId} cancelled.`,
        { duration: 7000 },
      );
      setConfirmAccept(false);
      setDeclining(false);
      onAnswered();
    } catch (err: any) {
      setConfirmAccept(false);
      setError(err?.message || "That didn't work. Please try again.");
      onAnswered();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="cancel-request-title" className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <FiAlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="cancel-request-title" className="font-bold text-gray-900">
            The customer asked to cancel this order
          </h2>
          <p className="mt-0.5 text-sm text-amber-900">{when(request.requestedAt)}</p>
          {request.reason && <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-sm text-gray-800">“{request.reason}”</p>}
          <p className="mt-3 text-sm text-gray-700">
            The job is on hold until you answer. Accept if you haven't printed it yet: the order is cancelled, the customer is refunded in full, and
            it isn't paid. Decline if it's too far along, and tell the customer why. The order then carries on.
          </p>

          {declining && (
            <div className="mt-3">
              <label htmlFor="cancel-decline-reason" className="block text-sm font-medium text-gray-800">
                Why can't it be cancelled?
              </label>
              <textarea
                id="cancel-decline-reason"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                }}
                rows={2}
                maxLength={500}
                autoFocus
                placeholder="e.g. It's already printed and packed"
                className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {declining ? (
              <>
                <button
                  onClick={() => void answer("decline")}
                  disabled={busy}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
                >
                  {busy ? "Sending…" : "Decline and tell the customer"}
                </button>
                <button
                  onClick={() => {
                    setDeclining(false);
                    setError(null);
                  }}
                  disabled={busy}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Back
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setConfirmAccept(true)}
                  disabled={busy}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  Accept and cancel
                </button>
                <button
                  onClick={() => setDeclining(true)}
                  disabled={busy}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
                >
                  Decline
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmAccept}
        title={`Cancel order ${displayId}?`}
        body="The customer is refunded in full and you won't be paid for this job. Stop any work on it. This can't be undone."
        confirmLabel="Cancel the order"
        busy={busy}
        onConfirm={() => void answer("accept")}
        onCancel={() => setConfirmAccept(false)}
      />
    </section>
  );
}
