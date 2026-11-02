import { useState } from 'react';
import toast from 'react-hot-toast';
import { FiArrowLeft } from 'react-icons/fi';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { formatOrderNumber } from '../../utils/orderNumber';
import { formatOrderStatus, orderStatusBadgeClass } from '../../utils/orderStatus';
import { isFullRefund, parseRefundAmount } from '../../utils/refunds';

interface OrderHeaderProps {
    orderId: string;
    /** Canonical order number (DTF-####). Falls back to a slice of the raw id. */
    displayId?: string | null;
    status: string;
    /** What the customer paid, shown in the cancel confirmation. */
    amountPaid?: number;
    /** What is left of the payment to refund; zero when there was no card payment. */
    refundable?: number;
    /** The order this one replaces free of charge, and any free replacements made for it. */
    reprintOf?: { orderId: string; displayId: string } | null;
    reprints?: { orderId: string; displayId: string }[];
    /** Set when a partner has started the job, so they can be paid for it on cancel. */
    partnerPay?: { partnerName: string; amount: number | null } | null;
    /** Called after the order is cancelled, to reload it. */
    onCancelled?: () => void;
}

/** An order can be cancelled until it ships. */
const CANCELLABLE = ['PENDING', 'PROCESSING', 'PRINTING', 'QUALITY_CHECK'];

export const OrderHeader = ({ orderId, displayId, status, amountPaid, refundable = 0, reprintOf, reprints = [], partnerPay, onCancelled }: OrderHeaderProps) => {
    const navigate = useNavigate();
    const [asking, setAsking] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [reasonMissing, setReasonMissing] = useState(false);
    // Ticked by default: a cancellation is the business's decision, not the partner's fault.
    const [payPartner, setPayPartner] = useState(true);
    const [refundInput, setRefundInput] = useState('');
    const [refundError, setRefundError] = useState<string | null>(null);
    const number = formatOrderNumber(displayId, orderId);
    const started = status === 'PRINTING' || status === 'QUALITY_CHECK';

    const cancel = async () => {
        const refund = refundable > 0 ? parseRefundAmount(refundInput, refundable, { allowZero: true }) : null;
        if (refund?.error) {
            setRefundError(refund.error);
            document.getElementById('order-cancel-refund')?.focus();
            return;
        }
        if (!reason.trim()) {
            setReasonMissing(true);
            document.getElementById('order-cancel-reason')?.focus();
            return;
        }
        setBusy(true);
        try {
            const res = await apiFetch(`/admin/orders/${encodeURIComponent(orderId)}/cancel`, {
                method: 'POST',
                body: JSON.stringify({
                    reason: reason.trim(),
                    payPartner: Boolean(partnerPay) && payPartner,
                    ...(refund && refund.amount !== null ? { refundAmount: refund.amount } : {}),
                }),
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
                    {reprintOf && (
                        <p className="mt-1 text-sm text-gray-600">
                            Free reprint of{' '}
                            <Link to={`/dashboard/orders/${reprintOf.orderId}`} className="font-medium text-blue-600 hover:underline">
                                {reprintOf.displayId}
                            </Link>
                        </p>
                    )}
                    {reprints.length > 0 && (
                        <p className="mt-1 text-sm text-gray-600">
                            Reprinted free as{' '}
                            {reprints.map((r, i) => (
                                <span key={r.orderId}>
                                    {i > 0 ? ', ' : ''}
                                    <Link to={`/dashboard/orders/${r.orderId}`} className="font-medium text-blue-600 hover:underline">
                                        {r.displayId}
                                    </Link>
                                </span>
                            ))}
                        </p>
                    )}
                </div>
                {CANCELLABLE.includes(status) && (
                    <button
                        onClick={() => {
                            setRefundInput(refundable.toFixed(2));
                            setRefundError(null);
                            setAsking(true);
                        }}
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
                            {refundable > 0
                                ? "The customer is refunded to their card and told by email. This can't be undone."
                                : "There is no card payment left to refund. The customer is told by email. This can't be undone."}
                        </p>
                        {refundable > 0 && (
                            <div className="mt-4">
                                <label htmlFor="order-cancel-refund" className="block text-sm font-medium text-gray-700">
                                    Refund amount{' '}
                                    <span className="font-normal text-gray-500">
                                        (up to ${refundable.toFixed(2)}
                                        {typeof amountPaid === 'number' && amountPaid - refundable > 0.005 ? ` of $${amountPaid.toFixed(2)} paid` : ''})
                                    </span>
                                </label>
                                <div className="mt-1 flex gap-2">
                                    <div className="relative flex-1">
                                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                                        <input
                                            id="order-cancel-refund"
                                            inputMode="decimal"
                                            value={refundInput}
                                            onChange={(e) => {
                                                setRefundInput(e.target.value);
                                                setRefundError(null);
                                            }}
                                            aria-invalid={Boolean(refundError)}
                                            className={`w-full rounded-lg border py-2 pl-7 pr-3 text-sm tabular-nums focus:outline-none ${
                                                refundError ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-blue-500'
                                            }`}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setRefundInput(refundable.toFixed(2));
                                            setRefundError(null);
                                        }}
                                        className="shrink-0 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                    >
                                        Full amount
                                    </button>
                                </div>
                                {refundError ? (
                                    <p className="mt-1 text-sm text-red-600">{refundError}</p>
                                ) : (
                                    (() => {
                                        const typed = parseRefundAmount(refundInput, refundable, { allowZero: true }).amount;
                                        if (typed === null || isFullRefund(typed, refundable)) return null;
                                        return (
                                            <p className="mt-1 text-xs text-amber-700">
                                                {typed === 0
                                                    ? 'The order is cancelled and the customer gets nothing back.'
                                                    : `A part refund: $${(refundable - typed).toFixed(2)} is kept.`}
                                            </p>
                                        );
                                    })()
                                )}
                            </div>
                        )}
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
