import { FiCheck } from 'react-icons/fi';
import { ORDER_STATUS_LABEL, formatOrderStatus } from '../../utils/orderStatus';

interface TimelineEntry {
    status: string;
    time?: string;
    message?: string;
}

interface OrderTimelineProps {
    order: {
        status: string;
        createdAt: string;
        statusTimeline?: TimelineEntry[];
        history?: Array<{
            status: string;
            timestamp: string;
            note?: string;
        }>;
    };
}

const STATUS_STEPS = [
    { key: 'PENDING',       label: ORDER_STATUS_LABEL.PENDING },
    { key: 'PROCESSING',    label: ORDER_STATUS_LABEL.PROCESSING },
    { key: 'PRINTING',      label: ORDER_STATUS_LABEL.PRINTING },
    { key: 'QUALITY_CHECK', label: ORDER_STATUS_LABEL.QUALITY_CHECK },
    { key: 'SHIPPED',       label: ORDER_STATUS_LABEL.SHIPPED },
    { key: 'COMPLETED',     label: ORDER_STATUS_LABEL.COMPLETED },
];

export const OrderTimeline = ({ order }: OrderTimelineProps) => {
    const formatDate = (dateStr: string) =>
        new Date(dateStr).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',     
            minute: '2-digit',
            hour12: true
        });

    // Use statusTimeline from admin endpoint if available, otherwise fall back to static steps
    const hasTimeline = Array.isArray(order.statusTimeline) && order.statusTimeline.length > 0;

    if (hasTimeline) {
        return (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-6">Order Status Timeline</h2>
                <div className="relative pl-4 border-l-2 border-gray-100 space-y-6 ml-2">
                    {order.statusTimeline!.map((entry, index) => (
                        <div key={index} className="relative">
                            <div className="absolute -left-[29px] rounded-full p-1 bg-green-100">
                              
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-900">
                                    {formatOrderStatus(entry.status)}
                                </p>
                                {entry.message && (
                                    <p className="text-xs text-gray-500 mt-0.5">{entry.message}</p>
                                )}
                                {entry.time && (
                                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(entry.time)}</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Fallback: static progress steps
    const currentStatusIndex = STATUS_STEPS.findIndex(s => s.key === order.status);

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Order Status Timeline</h2>
            <div className="relative pl-4 border-l-2 border-gray-100 space-y-8 ml-2">
                {STATUS_STEPS.map((step, index) => {
                    const isCompleted = index <= currentStatusIndex;
                    const isCurrent = index === currentStatusIndex;

                    return (
                        <div key={step.key} className="relative">
                            <div className={`absolute -left-[29px] rounded-full p-1 ${
                                isCompleted ? 'bg-green-100' : isCurrent ? 'bg-blue-100' : 'bg-gray-100'
                            }`}>
                                {isCompleted ? (
                                    <div className="bg-green-500 rounded-full p-0.5 text-white">
                                        <FiCheck size={12} />
                                    </div>
                                ) : (
                                    <div className={`rounded-full w-4 h-4 border-2 border-white ${
                                        isCurrent ? 'bg-blue-500' : 'bg-gray-300'
                                    }`}></div>
                                )}
                            </div>
                            <div>
                                <p className={`text-sm font-medium ${
                                    isCurrent ? 'text-blue-600' : isCompleted ? 'text-gray-900' : 'text-gray-400'
                                }`}>
                                    {step.label}
                                </p>
                                <p className="text-xs text-gray-500">
                                    {isCompleted ? formatDate(order.createdAt) : '-'}
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
