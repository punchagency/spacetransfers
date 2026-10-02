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
            /** True once the order is cancelled; `refunded` is what went back to the customer. */
            cancelled?: boolean;
            refunded?: number;
            /** Collected for the state; not the business's money. */
            tax?: number;
            shippingCharged?: number;
            /** What shipping costs the business, and where that figure came from. */
            shippingCost?: number;
            shippingCostSource?: 'label' | 'quote' | 'at-cost';
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

    const partnerCost = f?.partnerCost ?? null;
    const adminProfit = f?.adminProfit ?? null;

    // Stripe's actual fee for this payment. Null means it was never recorded
    // (not "no fee"), so profit is shown before it and says so.
    const processingFees = f?.processingFees ?? null;
    // A cancelled order has no tax, shipping or partner cost to count: only the refund and the fee.
    const cancelled = Boolean(f?.cancelled);
    const tax = cancelled ? null : f?.tax ?? null;
    const shippingCost = cancelled ? null : f?.shippingCost ?? null;
    const shippingNote =
        f?.shippingCostSource === 'label'
            ? 'What the label cost'
            : f?.shippingCostSource === 'quote'
              ? "The carrier's quote at checkout; replaced by the label's cost once one is bought"
              : 'No carrier cost known yet, so shipping is counted as passed through at what the customer paid';
    const minus = (n: number | null) => (n === null ? '—' : `−${fmt(n)}`);

    const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
    const money = (n: number | null) => (n === null ? '—' : fmt(n));

    const isEstimate = !f?.cancelled && f?.profitRealized === false && adminProfit !== null;

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
                {tax !== null && (
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">Tax <span className="text-gray-400">(for the state)</span></span>
                        <span className="font-medium text-gray-900">{minus(tax)}</span>
                    </div>
                )}
                {shippingCost !== null && (
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600 cursor-help" title={shippingNote}>
                            Shipping{' '}
                            <span className="text-gray-400">
                                ({f?.shippingCostSource === 'label' ? 'label' : f?.shippingCostSource === 'quote' ? 'quoted' : 'at cost'})
                            </span>
                        </span>
                        <span className="font-medium text-gray-900">{minus(shippingCost)}</span>
                    </div>
                )}
                {cancelled && (
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">Refunded to customer</span>
                        <span className="font-medium text-gray-900">{minus(f?.refunded ?? 0)}</span>
                    </div>
                )}
                {!cancelled && (
                <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Partner Cost</span>
                    <span
                        className={`font-medium ${partnerCost === null ? 'text-gray-400 cursor-help' : 'text-gray-900'}`}
                        title={partnerCost === null ? f?.unavailableReason : undefined}
                    >
                        {minus(partnerCost)}
                    </span>
                </div>
                )}
                <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Card Processing Fee</span>
                    <span
                        className={`font-medium ${processingFees === null ? 'text-gray-400 cursor-help' : 'text-gray-900'}`}
                        title={
                            processingFees === null
                                ? "Stripe's fee for this payment isn't recorded, so it isn't taken off the profit below."
                                : undefined
                        }
                    >
                        {processingFees === null ? 'Not recorded' : minus(processingFees)}
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
                        Before the card processing fee, which isn't recorded for this order.
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
