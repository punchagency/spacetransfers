import { useState } from 'react';
import toast from 'react-hot-toast';
import { FiArrowLeft } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { formatOrderNumber } from '../../utils/orderNumber';
import { formatOrderStatus, orderStatusBadgeClass } from '../../utils/orderStatus';

interface OrderHeaderProps {
    orderId: string;
    /** Canonical order number (DTF-####). Falls back to a slice of the raw id. */
    displayId?: string | null;
    status: string;
    /** What the customer paid, shown in the cancel confirmation. */
    amountPaid?: number;
    /** Set when a partner has started the job, so they can be paid for it on cancel. */
    partnerPay?: { partnerName: string; amount: number | null } | null;
    /** Called after the order is cancelled, to reload it. */
    onCancelled?: () => void;
}

/** An order can be cancelled until it ships. */
const CANCELLABLE = ['PENDING', 'PROCESSING', 'PRINTING', 'QUALITY_CHECK'];

export const OrderHeader = ({ orderId, displayId, status, amountPaid, partnerPay, onCancelled }: OrderHeaderProps) => {
    const navigate = useNavigate();
    const [asking, setAsking] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [reasonMissing, setReasonMissing] = useState(false);
    // Ticked by default: a cancellation is the business's decision, not the partner's fault.
    const [payPartner, setPayPartner] = useState(true);
    const number = formatOrderNumber(displayId, orderId);
    const started = status === 'PRINTING' || status === 'QUALITY_CHECK';

    const cancel = async () => {
        if (!reason.trim()) {
            setReasonMissing(true);
            document.getElementById('order-cancel-reason')?.focus();
            return;
        }
        setBusy(true);
        try {
            const res = await apiFetch(`/admin/orders/${encodeURIComponent(orderId)}/cancel`, {
                method: 'POST',
                body: JSON.stringify({ reason: reason.trim(), payPartner: Boolean(partnerPay) && payPartner }),
            });
            toast.success(
                res?.refunded
                    ? `Order cancelled and $${Number(res.refundAmount).toFixed(2)} refunded${res?.partnerPaid ? '. The partner will be paid for this job.' : ''}`
                    : `Order cancelled. ${res?.noRefundReason || ''}`,
                { duration: 7000 },
            );
            if (res && res.customerNotified === false) {
                toast('The customer could not be emailed about this.', { duration: 7000 });
            }
            setAsking(false);
            setReason('');
            onCancelled?.();
        } catch (e: any) {
            toast.error(e?.message || 'The order could not be cancelled', { duration: 9000 });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-4 sticky top-0 bg-gray-50 z-10 -mt-6 -mx-6 px-6 pt-6 pb-4">
            <div className="flex justify-between items-center">
                <button
                    onClick={() => navigate('/orders')}
                    className="flex items-center gap-2 text-gray-600 hover:text-gray-900 w-fit"
                >
                    <FiArrowLeft />
                    <span className="font-medium">Back to Orders</span>
                </button>
                <span className={`px-3 py-1 rounded-full text-xs font-bold border ${orderStatusBadgeClass(status)}`}>
                    {formatOrderStatus(status)}
                </span>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Order {number}</h1>
                    <p className="text-gray-500">View and manage order details</p>
                </div>
                {CANCELLABLE.includes(status) && (
                    <button
                        onClick={() => setAsking(true)}
                        className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                    >
                        Cancel &amp; refund
                    </button>
                )}
            </div>

            {asking && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                        <h3 className="text-lg font-bold text-gray-900">Cancel order {number}?</h3>
                        <p className="mt-1 text-sm text-gray-500">
                            The customer is refunded
                            {typeof amountPaid === 'number' ? ` $${amountPaid.toFixed(2)}` : ' in full'} to their card and
                            told by email. This can't be undone.
                        </p>
                        {started && partnerPay && (
                            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                                <p>{partnerPay.partnerName} has already started this job. They'll be told to stop.</p>
                                <label htmlFor="order-cancel-pay-partner" className="mt-2 flex cursor-pointer items-start gap-2 font-medium">
                                    <input
                                        id="order-cancel-pay-partner"
                                        type="checkbox"
                                        checked={payPartner}
                                        onChange={(e) => setPayPartner(e.target.checked)}
                                        className="mt-0.5 h-4 w-4"
                                    />
                                    <span>
                                        Pay the partner for this job anyway
                                        {partnerPay.amount !== null ? ` ($${partnerPay.amount.toFixed(2)})` : ''}
                                    </span>
                                </label>
                                <p className="mt-1 pl-6 text-xs text-amber-800">
                                    {payPartner
                                        ? 'It joins their next payout, as if the job had shipped.'
                                        : "They won't be paid anything for the work done so far."}
                                </p>
                            </div>
                        )}
                        <label htmlFor="order-cancel-reason" className="mt-4 block text-sm font-medium text-gray-700">
                            Reason <span className="font-normal text-gray-500">(required — the customer sees this)</span>
                        </label>
                        <textarea
                            id="order-cancel-reason"
                            value={reason}
                            onChange={(e) => {
                                setReason(e.target.value);
                                setReasonMissing(false);
                            }}
                            rows={3}
                            placeholder="e.g. The artwork can't be printed as supplied."
                            aria-invalid={reasonMissing}
                            aria-describedby={reasonMissing ? 'order-cancel-reason-error' : undefined}
                            className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                                reasonMissing ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-blue-500'
                            }`}
                        />
                        {reasonMissing && (
                            <p id="order-cancel-reason-error" className="mt-1 text-sm text-red-600">
                                Enter a reason to cancel this order.
                            </p>
                        )}
                        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
                            <button
                                onClick={() => { setAsking(false); setReason(''); setReasonMissing(false); }}
                                disabled={busy}
                                className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                            >
                                Keep order
                            </button>
                            <button
                                onClick={() => void cancel()}
                                disabled={busy}
                                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                            >
                                {busy ? 'Cancelling…' : 'Cancel & refund'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
