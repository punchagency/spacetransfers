import { FiDownload, FiFileText } from 'react-icons/fi';

interface OrderFinancialsProps {
    order: {
        financials?: {
            customerPaid: number;
            partnerCost: number;
            processingFees: number;
            adminProfit: number;
            currency: string;
        };
        pricing?: {
            total: number;
            currency: string;
            partnerCost?: number;
        };
    };
}

export const OrderFinancials = ({ order }: OrderFinancialsProps) => {
    // Support admin endpoint shape (financials) or fallback to pricing
    const currency = order.financials?.currency || order.pricing?.currency || 'USD';
    const customerPaid = order.financials?.customerPaid ?? order.pricing?.total ?? 0;
    const partnerCost = order.financials?.partnerCost ?? (order.pricing?.partnerCost || customerPaid * 0.6);
    const processingFees = order.financials?.processingFees ?? 0;
    const adminProfit = order.financials?.adminProfit ?? (customerPaid - partnerCost);

    const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Invoice &amp; Financials</h2>

            <div className="space-y-4 mb-8">
                <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Customer Paid</span>
                    <span className="font-medium text-gray-900">{fmt(customerPaid)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Partner Cost</span>
                    <span className="font-medium text-gray-900">{fmt(partnerCost)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Processing Fees</span>
                    <span className="font-medium text-gray-900">{fmt(processingFees)}</span>
                </div>
                <div className="flex justify-between items-center text-sm pt-4 border-t border-gray-100">
                    <span className="font-semibold text-gray-900">Admin Profit</span>
                    <span className={`font-bold ${adminProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {fmt(adminProfit)}
                    </span>
                </div>
            </div>

            <div className="space-y-3">
                <button className="w-full flex items-center justify-center gap-2 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors">
                    <FiDownload className="w-4 h-4" />
                    Download Invoice
                </button>
                <button className="w-full flex items-center justify-center gap-2 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors">
                    <FiFileText className="w-4 h-4" />
                    Production Sheet
                </button>
            </div>
        </div>
    );
};
