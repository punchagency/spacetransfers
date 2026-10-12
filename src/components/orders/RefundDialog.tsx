import { useState } from 'react';
import toast from 'react-hot-toast';
import { apiFetch } from '../../utils/api';
import { isFullRefund, parseRefundAmount } from '../../utils/refunds';

interface RefundDialogProps {
    orderId: string;
    number: string;
    /** What is left of the payment that can still be refunded. */
    refundable: number;
    /** What the customer paid in all. */
    paid: number;
    onClose: () => void;
    onRefunded: () => void;
}

/** Refunds part or all of an order's payment. The order itself carries on. */
export const RefundDialog = ({ orderId, number, refundable, paid, onClose, onRefunded }: RefundDialogProps) => {
    const [amount, setAmount] = useState(refundable.toFixed(2));
    const [reason, setReason] = useState('');
    const [amountError, setAmountError] = useState<string | null>(null);
    const [reasonMissing, setReasonMissing] = useState(false);
    const [busy, setBusy] = useState(false);

    const parsed = parseRefundAmount(amount, refundable);
    const alreadyRefunded = Math.max(0, Math.round((paid - refundable) * 100) / 100);

    const submit = async () => {
        setAmountError(parsed.error);
        const noReason = !reason.trim();
        setReasonMissing(noReason);
        if (parsed.error || parsed.amount === null) {
            document.getElementById('order-refund-amount')?.focus();
            return;
        }
        if (noReason) {
            document.getElementById('order-refund-reason')?.focus();
            return;
        }
        setBusy(true);
        try {
            const res = await apiFetch(`/admin/orders/${encodeURIComponent(orderId)}/refund`, {
                method: 'POST',
                body: JSON.stringify({ amount: parsed.amount, reason: reason.trim() }),
            });
            toast.success(
                res?.full
                    ? `$${Number(res.amount).toFixed(2)} refunded. The order is now refunded in full.`
                    : `$${Number(res.amount).toFixed(2)} refunded. $${Number(res.remaining).toFixed(2)} of the payment is left.`,
                { duration: 7000 },
            );
            if (res && res.customerNotified === false) {
                toast('The customer could not be emailed about this.', { duration: 7000 });
            }
            onRefunded();
            onClose();
        } catch (e: any) {
            toast.error(e?.message || 'The refund could not be made', { duration: 9000 });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div role="dialog" aria-modal="true" aria-label={`Refund order ${number}`} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                <h3 className="text-lg font-bold text-gray-900">Refund order {number}</h3>
                <p className="mt-1 text-sm text-gray-500">
                    The money goes back to the customer's card and they're told by email. The order is not cancelled.
                    {alreadyRefunded > 0 ? ` $${alreadyRefunded.toFixed(2)} of $${paid.toFixed(2)} has been refunded already.` : ''}
                </p>

                <label htmlFor="order-refund-amount" className="mt-4 block text-sm font-medium text-gray-700">
                    Amount <span className="font-normal text-gray-500">(up to ${refundable.toFixed(2)})</span>
                </label>
                <div className="mt-1 flex gap-2">
                    <div className="relative flex-1">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                        <input
                            id="order-refund-amount"
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => {
                                setAmount(e.target.value);
                                setAmountError(null);
                            }}
                            aria-invalid={Boolean(amountError)}
                            aria-describedby={amountError ? 'order-refund-amount-error' : undefined}
                            className={`w-full rounded-lg border py-2 pl-7 pr-3 text-sm tabular-nums focus:outline-none ${
                                amountError ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-blue-500'
                            }`}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setAmount(refundable.toFixed(2));
                            setAmountError(null);
                        }}
                        className="shrink-0 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Full amount
                    </button>
                </div>
                {amountError ? (
                    <p id="order-refund-amount-error" className="mt-1 text-sm text-red-600">
                        {amountError}
                    </p>
                ) : (
                    parsed.amount !== null && (
                        <p className="mt-1 text-xs text-gray-500">
                            {isFullRefund(parsed.amount, refundable)
                                ? 'Everything left of the payment.'
                                : `A part refund. $${(refundable - parsed.amount).toFixed(2)} stays with the order.`}
                        </p>
                    )
                )}

                <label htmlFor="order-refund-reason" className="mt-4 block text-sm font-medium text-gray-700">
                    Reason <span className="font-normal text-gray-500">(required — the customer sees this)</span>
                </label>
                <textarea
                    id="order-refund-reason"
                    value={reason}
                    onChange={(e) => {
                        setReason(e.target.value);
                        setReasonMissing(false);
                    }}
                    rows={3}
                    placeholder="e.g. Sorry your order arrived late."
                    aria-invalid={reasonMissing}
                    className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                        reasonMissing ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-blue-500'
                    }`}
                />
                {reasonMissing && <p className="mt-1 text-sm text-red-600">Enter a reason for this refund.</p>}

                <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
                    <button
                        onClick={onClose}
                        disabled={busy}
                        className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                    >
                        Back
                    </button>
                    <button
                        onClick={() => void submit()}
                        disabled={busy}
                        className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                        {busy ? 'Refunding…' : parsed.amount !== null ? `Refund $${parsed.amount.toFixed(2)}` : 'Refund'}
                    </button>
                </div>
            </div>
        </div>
    );
};
