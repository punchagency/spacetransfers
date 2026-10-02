interface OrderDetailsProps {
  orderId: string;
  createdAt: string;
  /** "Accept by" / "Print by", or null once nothing is due. */
  dueLabel?: string | null;
  dueDate?: string | null;
  sheetCount: number;
}

/*
 * "Due Date" here was the accept-by deadline, shown in red for the life of the
 * job — after it was accepted, and on shipped and delivered jobs. It now names
 * what is due next, and disappears once nothing is.
 */
export const OrderDetails = ({ orderId, createdAt, dueLabel, dueDate, sheetCount }: OrderDetailsProps) => {
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
      <h3 className="text-base font-bold text-gray-900 mb-3">Order Details</h3>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span className="text-gray-500 text-xs">Order ID</span>
          <span className="font-medium text-gray-900 text-xs">{orderId}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 text-xs">Placed</span>
          <span className="font-medium text-gray-900 text-xs">{createdAt}</span>
        </div>
        {dueLabel && dueDate ? (
          <div className="flex justify-between">
            <span className="text-gray-500 text-xs">{dueLabel}</span>
            <span className="font-medium text-orange-600 text-xs">{dueDate}</span>
          </div>
        ) : null}
        <div className="flex justify-between pt-2 border-t border-gray-100">
          <span className="text-gray-500 text-xs">{sheetCount === 1 ? "Sheet" : "Sheets"}</span>
          <span className="font-bold text-gray-900 text-xs">{sheetCount}</span>
        </div>
      </div>
    </div>
  );
};
