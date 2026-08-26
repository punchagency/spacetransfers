import { useState } from 'react';
import toast from 'react-hot-toast';
import { FiDownload } from 'react-icons/fi';
import { downloadOrderInvoice } from '../../utils/downloads';

interface OrderFinancialsProps {
    orderId?: string;
    orderNumber?: string;
    order: {
        financials?: {
            customerPaid: number;
            partnerCost: number | null;
            processingFees?: number | null;
            adminProfit: number | null;
            profitRealized?: boolean;
            unavailableReason?: string;
            currency: string;
        };
        pricing?: {
            total: number;
            currency: string;
        };
    };
}

export const OrderFinancials = ({ order, orderId, orderNumber }: OrderFinancialsProps) => {
    const [downloading, setDownloading] = useState(false);

    const f = order.financials;
    const currency = f?.currency || order.pricing?.currency || 'USD';
    const customerPaid = f?.customerPaid ?? order.pricing?.total ?? 0;

    /**
     * `null` means the server could not derive a partner cost — an order whose
     * items carry no sheet dimensions has an unknown cost, not a zero one.
     *
     * This used to fall back to `customerPaid * 0.6`, inventing a 60% cost out
     * of nothing and deriving Admin Profit from it, so the panel could show a
     * confident margin built entirely on a guess.
     */
    const partnerCost = f?.partnerCost ?? null;
    const adminProfit = f?.adminProfit ?? null;

    // Never computed anywhere. Showing $0.00 read as "we checked, there are
    // none" — but Stripe is not configured, so no fee has been calculated at
    // all. Once it is, this must be subtracted before Admin Profit is credible.
    const processingFees = f?.processingFees ?? null;

    const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
    const money = (n: number | null) => (n === null ? '—' : fmt(n));

    const isEstimate = f?.profitRealized === false && adminProfit !== null;

    const handleInvoice = async () => {
        if (!orderId) return;
        setDownloading(true);
        try {
            await downloadOrderInvoice(orderId, orderNumber);
        } catch (e: any) {
            toast.error(e?.message || 'Could not download the invoice');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Invoice &amp; Financials</h2>

            <div className="space-y-4 mb-8">
                <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Customer Paid</span>
                    <span className="font-medium text-gray-900">{fmt(customerPaid)}</span>
                </div>
                {/*
                  Everything below this line is internal. The invoice shows the
                  customer only what they paid — partner cost, fees and margin
                  are not on it and must not be read as though they were.
                */}
                <div className="pt-2">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                        Internal — not shown to the customer
                    </p>
                </div>
                <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Partner Cost</span>
                    <span
                        className={`font-medium ${partnerCost === null ? 'text-gray-400 cursor-help' : 'text-gray-900'}`}
                        title={partnerCost === null ? f?.unavailableReason : undefined}
                    >
                        {money(partnerCost)}
                    </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Processing Fees</span>
                    <span
                        className={`font-medium ${processingFees === null ? 'text-gray-400 cursor-help' : 'text-gray-900'}`}
                        title={
                            processingFees === null
                                ? 'Not calculated. Card processing is not configured yet, so no fee has been worked out for this order.'
                                : undefined
                        }
                    >
                        {money(processingFees)}
                    </span>
                </div>
                <div className="flex justify-between items-center text-sm pt-4 border-t border-gray-100">
                    <span className="font-semibold text-gray-900">Admin Profit</span>
                    <span
                        className={`font-bold ${
                            adminProfit === null
                                ? 'text-gray-400 cursor-help'
                                : adminProfit >= 0
                                  ? 'text-green-600'
                                  : 'text-red-500'
                        }`}
                        title={
                            adminProfit === null
                                ? f?.unavailableReason
                                : isEstimate
                                  ? 'Estimated. The partner is not paid until the order ships, so this is not settled yet.'
                                  : undefined
                        }
                    >
                        {money(adminProfit)}
                        {isEstimate && (
                            <span className="ml-1 text-[11px] font-normal text-gray-400">est.</span>
                        )}
                    </span>
                </div>
                {processingFees === null && adminProfit !== null && (
                    <p className="text-xs text-gray-400 pt-1">
                        Before card processing fees, which are not calculated yet.
                    </p>
                )}
            </div>

            <div>
                <button
                    onClick={handleInvoice}
                    disabled={!orderId || downloading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <FiDownload className="w-4 h-4" />
                    {downloading ? 'Preparing…' : 'Download Customer Invoice'}
                </button>
                {/*
                  Says whose document this is. The panel puts a customer-facing
                  invoice next to internal margin figures, so "Invoice" alone
                  left it ambiguous whether the PDF carried them.
                */}
                <p className="text-xs text-gray-400 mt-2 text-center">
                    The same PDF the customer can download. Shows what they paid — no partner
                    cost or margin.
                </p>
            </div>
        </div>
    );
};
