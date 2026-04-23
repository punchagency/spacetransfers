import { FiArrowLeft } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';

interface OrderHeaderProps {
    orderId: string;
    status: string;
}

export const OrderHeader = ({ orderId, status }: OrderHeaderProps) => {
    const navigate = useNavigate();

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'PENDING': return 'bg-amber-100 text-amber-700 border-amber-200';
            case 'PROCESSING': return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'PRINTING': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
            case 'SHIPPED': return 'bg-purple-100 text-purple-700 border-purple-200';
            case 'COMPLETED': return 'bg-green-100 text-green-700 border-green-200';
            case 'REJECTED': return 'bg-red-100 text-red-700 border-red-200';
            default: return 'bg-gray-100 text-gray-700 border-gray-200';
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
                <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getStatusColor(status)}`}>
                    {status}
                </span>
            </div>
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Order #{orderId.toString().slice(-6).toUpperCase()}</h1>
                <p className="text-gray-500">View and manage order details</p>
            </div>
        </div>
    );
};
