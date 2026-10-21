import { useState } from "react";
import toast from "react-hot-toast";
import { apiFetch } from "../../lib/utils/api";
import { cancellationNote, type OrderCancellation } from "../../lib/utils/orderCancellation";

/** An open request to cancel, which the customer can take back, or the partner's refusal. */
export default function CancellationNote({
  orderId,
  cancellation,
  onChanged,
}: {
  orderId: string;
  cancellation: OrderCancellation | null | undefined;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const note = cancellationNote(cancellation);
  if (!note) return null;

  const withdraw = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch(`/customer/orders/${orderId}/cancel/withdraw`, { method: "POST" });
      toast.success("Your order will carry on as normal.");
      onChanged();
    } catch (err: any) {
      toast.error(err?.message || "This couldn't be done. Please try again.");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ${
        note.tone === "waiting" ? "bg-amber-50 text-amber-900" : "bg-gray-100 text-gray-700"
      }`}
    >
      <span>{note.text}</span>
      {note.tone === "waiting" && (
        <button onClick={() => void withdraw()} disabled={busy} className="font-semibold underline-offset-2 hover:underline disabled:opacity-60">
          {busy ? "Working…" : "Keep my order"}
        </button>
      )}
    </div>
  );
}
