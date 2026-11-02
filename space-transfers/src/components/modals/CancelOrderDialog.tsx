import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { apiFetch } from "../../lib/utils/api";
import { cancelCopy } from "../../lib/utils/orderCancellation";

interface CancelOrderDialogProps {
  /** The order being cancelled; null while closed. */
  order: { orderId: string; number: string; option: "now" | "request" } | null;
  onClose: () => void;
  /** Called after the order was cancelled or the request was sent. */
  onDone: () => void;
}

/** Cancelling an order, or asking the print partner to. */
export default function CancelOrderDialog({ order, onClose, onDone }: CancelOrderDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason("");
    setError(null);
  }, [order?.orderId]);

  useEffect(() => {
    if (!order) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [order, busy, onClose]);

  if (!order) return null;
  const copy = cancelCopy(order.option);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/customer/orders/${order.orderId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (res?.outcome === "cancelled") {
        toast.success(
          res.refundAmount > 0
            ? `Order ${order.number} cancelled. $${Number(res.refundAmount).toFixed(2)} is on its way back to your card.`
            : `Order ${order.number} cancelled.`,
          { duration: 7000 },
        );
      } else {
        toast.success("We've asked your print partner. You'll get an email when they answer.", { duration: 7000 });
      }
      onDone();
      onClose();
    } catch (err: any) {
      setError(err?.message || "This couldn't be done. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-order-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h2 id="cancel-order-title" className="text-lg font-semibold text-gray-900">
          {copy.title}
        </h2>
        <p className="mt-1 text-sm text-gray-500">Order {order.number}</p>
        <p className="mt-3 text-sm text-gray-600">{copy.body}</p>
        <label htmlFor="cancel-order-reason" className="mt-4 block text-sm font-medium text-gray-700">
          Why are you cancelling? <span className="font-normal text-gray-500">(optional)</span>
        </label>
        <textarea
          id="cancel-order-reason"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
          rows={3}
          maxLength={500}
          placeholder="e.g. I ordered the wrong size"
          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Keep my order
          </button>
          <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
            {busy ? "Working…" : copy.confirm}
          </button>
        </div>
      </form>
    </div>
  );
}
