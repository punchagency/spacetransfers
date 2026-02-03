import {
  MdClose,
  MdArrowBack,
  MdInventory,
  MdVisibility,
  MdDownload,
} from "react-icons/md";

interface OrderHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onViewDetails: () => void;
}

export default function OrderHistoryModal({
  isOpen,
  onClose,
  onViewDetails,
}: OrderHistoryModalProps) {
  if (!isOpen) return null;

  const orders = [
    {
      id: "ORD-2024-001",
      status: "Completed",
      statusBg: "bg-green-100",
      statusText: "text-green-700",
      date: "Nov 10, 2024",
      amount: "$127.50",
      sheetSize: '13" × 19"',
      tracking: "17999AA16123456784",
      showReorder: true,
    },
    {
      id: "ORD-2024-002",
      status: "Shipped",
      statusBg: "bg-purple-100",
      statusText: "text-purple-700",
      date: "Nov 8, 2024",
      amount: "$89.99",
      sheetSize: '13" × 19"',
      tracking: "17999AA16123473483",
      showReorder: false,
    },
  ];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs  "
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between   px-6 py-2">
          <div className="flex items-start gap-3">
            <button onClick={onClose} className="mt-1 text-gray-500">
              <MdArrowBack className="h-5 w-5" />
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
              <MdInventory className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Order History
              </h2>
              <p className="text-sm text-gray-500">
                View and manage your past orders
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        {/* Orders */}
        <div className="px-6 py-3">
          <div className="flex items-center justify-end mb-4">
            <button className="text-sm text-blue-600 hover:underline">
              View all
            </button>
          </div>
          <div className="space-y-4">
            {orders.map((order) => (
              <div key={order.id} className="rounded-xl bg-gray-50 p-4">
                <div className="flex items-center gap-3">
                  <p className="text-sm font-medium text-gray-900">
                    {order.id}
                  </p>
                  <span
                    className={`rounded-full ${order.statusBg} px-2 py-0.5 text-xs font-medium ${order.statusText}`}
                  >
                    {order.status}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-500">
                  <span>{order.date}</span>
                  <span>{order.amount}</span>
                </div>

                <div className="mt-3 text-sm text-gray-600">
                  Sheet Size: {order.sheetSize}
                </div>

                <div className="mt-1 text-sm">
                  Tracking:{" "}
                  <span className="text-blue-600">{order.tracking}</span>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={() => {
                      onClose();
                      onViewDetails();
                    }}
                    className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm"
                  >
                    <MdVisibility className="h-4 w-4" /> View Details
                  </button>
                  <button className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm">
                    <MdDownload className="h-4 w-4" /> Invoice
                  </button>
                  {order.showReorder && (
                    <button className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-600">
                      Reorder
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md border-gray-200 border px-4 py-2 text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
