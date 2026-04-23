interface OrderDetailsProps {
  orderId: string;
  createdAt: string;
  dueDate: string;
  itemsCount: number;
}

export const OrderDetails = ({ orderId, createdAt, dueDate, itemsCount }: OrderDetailsProps) => {
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
      <h3 className="text-base font-bold text-gray-900 mb-3">Order Details</h3>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span className="text-gray-500 text-xs">Order ID</span>
          <span className="font-medium text-gray-900 text-xs">
            {orderId}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 text-xs">Created</span>
          <span className="font-medium text-gray-900 text-xs">
            {createdAt}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 text-xs">Due Date</span>
          <span className="font-medium text-red-600 text-xs">{dueDate}</span>
        </div>
        <div className="flex justify-between pt-2 border-t border-gray-100">
          <span className="text-gray-500 text-xs">Items</span>
          <span className="font-bold text-gray-900 text-xs">{itemsCount}</span>
        </div>
      </div>
    </div>
  );
};
