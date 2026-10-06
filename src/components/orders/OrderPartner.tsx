import { FiAlertTriangle, FiMail, FiMapPin, FiPrinter, FiZap } from 'react-icons/fi';

/**
 * Who is printing this order.
 *
 * `assignedPartner` and `regionInfo` were already returned by
 * `GET /admin/orders/:id` and rendered nowhere — the server worked out the
 * partner, the region match and whether assignment crossed a region, and the
 * page dropped all of it. The Orders table showed a partner name; opening the
 * order showed less than the list it came from.
 *
 * Cross-region matters enough to call out: it means no partner in the
 * customer's own region could take the job, so it travelled further than
 * intended. That is a fulfilment cost and a delivery-time problem, and it was
 * invisible here.
 */
interface OrderPartnerProps {
    order: {
        status?: string;
        priority?: string;
        assignedPartner?: {
            id: string;
            name?: string | null;
            email?: string | null;
        } | null;
        regionInfo?: {
            customerRegion?: string | null;
            printerRegion?: string | null;
            crossRegion?: boolean;
        } | null;
        financials?: {
            partnerCost: number | null;
            rushFee?: number | null;
            profitRealized?: boolean;
            cancelled?: boolean;
            partnerPaidOnCancel?: boolean;
            unavailableReason?: string;
            currency: string;
        };
    };
}

export const OrderPartner = ({ order }: OrderPartnerProps) => {
    const priority = String(order.priority || 'NORMAL').toUpperCase();
    const isUrgent = priority === 'URGENT';
    const rushFee = order.financials?.rushFee ?? null;

    const partner = order.assignedPartner;
    const region = order.regionInfo;
    const currency = order.financials?.currency || 'USD';
    const partnerCost = order.financials?.partnerCost ?? null;
    const isEstimate = order.financials?.profitRealized === false;
    // Cancelled without paying the partner: nothing is owed for this job.
    const notPaid = Boolean(order.financials?.cancelled) && !order.financials?.partnerPaidOnCancel;

    const fmt = (n: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-start justify-between mb-6 gap-3">
                <h2 className="text-lg font-semibold text-gray-900">Print Partner</h2>
                {isUrgent && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-600 border border-red-200 shrink-0">
                        <FiZap className="w-3 h-3" /> Urgent
                    </span>
                )}
            </div>

            <div className="flex items-center justify-between gap-3 mb-6 pb-6 border-b border-gray-100">
                <div>
                    <p className="text-sm text-gray-600">Priority</p>
                    {isUrgent && rushFee !== null && rushFee > 0 && (
                        <p className="text-xs text-gray-400 mt-0.5">
                            Adds {fmt(rushFee)} to the partner&rsquo;s payout
                        </p>
                    )}
                </div>
                <span
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 ${
                        isUrgent
                            ? 'bg-red-50 text-red-700 border border-red-100'
                            : 'bg-gray-100 text-gray-600'
                    }`}
                    title={
                        isUrgent
                            ? 'Set by the customer choosing express shipping at checkout.'
                            : 'Set by the customer choosing standard shipping at checkout.'
                    }
                >
                    {isUrgent ? 'Urgent' : 'Normal'}
                </span>
            </div>

            {!partner ? (
                /*
                 * Unassigned is a real state, not an error: assignment can be
                 * left to an admin under manual mode, and auto-assignment is
                 * blocked outright when the address maps to no US region.
                 */
                <div className="flex items-start gap-3 text-sm">
                    <FiAlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                    <div>
                        <p className="font-medium text-gray-900">Not assigned yet</p>
                        <p className="text-gray-500 mt-0.5">
                            No print partner has taken this order. Check Fulfilment Partners for
                            availability in {region?.customerRegion || 'the customer’s region'}.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center gap-3 text-gray-600">
                        <FiPrinter className="w-4 h-4 shrink-0" />
                        <span className="font-semibold text-gray-900">{partner.name || 'Unnamed partner'}</span>
                    </div>

                    {partner.email && (
                        <div className="flex items-center gap-3 text-gray-600 text-sm">
                            <FiMail className="w-4 h-4 shrink-0" />
                            <span className="break-all">{partner.email}</span>
                        </div>
                    )}

                    {region?.printerRegion && (
                        <div className="flex items-center gap-3 text-gray-600 text-sm">
                            <FiMapPin className="w-4 h-4 shrink-0" />
                            <span>
                                {region.printerRegion}
                                {region.customerRegion && region.customerRegion !== region.printerRegion && (
                                    <span className="text-gray-400"> · customer in {region.customerRegion}</span>
                                )}
                            </span>
                        </div>
                    )}

                    {region?.crossRegion && (
                        <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm">
                            <FiAlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                            <div>
                                <p className="font-medium text-gray-900">Cross-region assignment</p>
                                <p className="text-gray-600 mt-0.5">
                                    No partner in {region.customerRegion || 'the customer’s region'} could take
                                    this, so it went to {region.printerRegion}. Expect longer transit and
                                    higher shipping cost.
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="flex justify-between items-center text-sm pt-3 border-t border-gray-100">
                        {/*
                          "Partner is paid" read as a statement of fact — that
                          the money had already gone out. It has not: partners
                          are only paid once a job ships, and payouts are drawn
                          separately. "Payout" is the term the rest of the
                          system uses (Earnings, the Payout model, payout
                          eligibility), so it also matches what an admin will
                          search for.
                        */}
                        <span className="text-gray-600">Payout</span>
                        <span
                            className={`font-medium ${partnerCost === null || notPaid ? 'text-gray-400 cursor-help' : 'text-gray-900'}`}
                            title={
                                notPaid
                                    ? 'This order was cancelled and the partner is not paid for it.'
                                    : partnerCost === null
                                    ? order.financials?.unavailableReason
                                    : isEstimate
                                      ? 'Estimated — not yet owed. Partners become payable once the order ships.'
                                      : undefined
                            }
                        >
                            {notPaid ? 'Not paid' : partnerCost === null ? '—' : fmt(partnerCost)}
                            {!notPaid && partnerCost !== null && isEstimate && (
                                <span className="ml-1 text-[11px] font-normal text-gray-400">est.</span>
                            )}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};
