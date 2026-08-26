import { FiArrowLeft } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { formatOrderNumber } from '../../utils/orderNumber';
import { formatOrderStatus, orderStatusBadgeClass } from '../../utils/orderStatus';

interface OrderHeaderProps {
    orderId: string;
    /** Canonical order number (DTF-####). Falls back to a slice of the raw id. */
    displayId?: string | null;
    status: string;
}

export const OrderHeader = ({ orderId, displayId, status }: OrderHeaderProps) => {
    const navigate = useNavigate();

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
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Order {formatOrderNumber(displayId, orderId)}</h1>
                <p className="text-gray-500">View and manage order details</p>
            </div>
        </div>
    );
};
