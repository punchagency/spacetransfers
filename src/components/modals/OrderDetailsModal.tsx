import {
  MdClose,
  MdContentCopy,
  MdCreditCard,
  MdDownload,
} from "react-icons/md";
import { BsBoxSeam } from "react-icons/bs";
import { CiDeliveryTruck } from "react-icons/ci";
import { IoLocationOutline } from "react-icons/io5";
import { LuFileText, LuRefreshCw } from "react-icons/lu";
interface OrderDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function OrderDetailsModal({
  isOpen,
  onClose,
}: OrderDetailsModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#DDECFE]">
              <BsBoxSeam className="h-5 w-5 text-[#155DFC]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900">
                  Order Details
                </h2>
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                  Completed
                </span>
              </div>
              <p className="text-sm text-gray-500">
                ORD-2024-001 · Nov 10, 2024
              </p>
            </div>
          </div>
          <button
            className="text-gray-400 hover:text-gray-600"
            onClick={onClose}
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 pb-6 max-h-[70vh] overflow-y-auto">
          {/* Order Summary */}
          <div className="rounded-xl bg-gray-50 p-4">
            <h3 className="mb-3 text-sm font-medium text-gray-900">
              Order Summary
            </h3>
            <div className="grid grid-cols-2 gap-y-4 text-sm">
              <div>
                <p className="text-gray-500">Order Number</p>
                <div className="flex items-center gap-1 font-medium text-gray-900">
                  ORD-2024-001
                  <MdContentCopy className="h-4 w-4 text-gray-400" />
                </div>
              </div>
              <div>
                <p className="text-gray-500">Order Date</p>
                <p className="font-medium text-gray-900">Nov 10, 2024</p>
              </div>
              <div>
                <p className="text-gray-500">Sheet Size</p>
                <p className="font-medium text-gray-900">13" × 19"</p>
              </div>
              <div>
                <p className="text-gray-500">Square Feet</p>
                <p className="font-medium text-gray-900">2.14 sq ft</p>
              </div>
            </div>
          </div>

          {/* Tracking */}
          <div className="rounded-xl bg-blue-50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#DDECFE]">
                  <CiDeliveryTruck className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-900">
                    Tracking Information
                  </h3>
                  <div className="mt-1 flex items-center gap-1">
                    <span className="text-sm font-medium text-[#155DFC]">
                      17999AA16123456784
                    </span>
                    <MdContentCopy className="h-4 w-4 text-blue-500" />
                  </div>
                </div>
              </div>

              <button className="flex items-center gap-1 rounded-md border border-blue-200 bg-white px-3 py-1.5 text-sm font-medium text-blue-600">
                <CiDeliveryTruck className="h-4 w-4" /> Track Package
              </button>
            </div>
          </div>

          {/* Items */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-900">
              Items (2)
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3 text-sm">
                <div>
                  <p className="font-medium text-gray-900">
                    Custom DTF Transfer
                  </p>
                  <p className="text-gray-500">4" × 4" · Image: 6</p>
                </div>
                <p className="font-medium text-gray-900">$51.00</p>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3 text-sm">
                <div>
                  <p className="font-medium text-gray-900">
                    Custom DTF Transfer
                  </p>
                  <p className="text-gray-500">6" × 6" · Image: 3</p>
                </div>
                <p className="font-medium text-gray-900">$51.00</p>
              </div>
            </div>
          </div>

          {/* Addresses */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-gray-50 p-4 text-sm">
              <div className="mb-2 flex items-center gap-2 font-medium text-gray-800">
                <IoLocationOutline className="h-4 w-4" /> Shipping Address
              </div>
              <p className="text-gray-500">Brandon Smith</p>
              <p className="text-gray-500">123 Main Street</p>
              <p className="text-gray-500">Los Angeles, CA 90001</p>
              <p className="text-gray-500">United States</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-4 text-sm">
              <div className="mb-2 flex items-center gap-2 font-medium text-gray-900">
                <LuFileText className="h-4 w-4" /> Billing Address
              </div>
              <p className="text-gray-500">Brandon Smith</p>
              <p className="text-gray-500">123 Main Street</p>
              <p className="text-gray-500">Los Angeles, CA 90001</p>
              <p className="text-gray-500">United States</p>
            </div>
          </div>

          {/* Payment */}
          <div className="rounded-xl bg-gray-50 p-4 text-sm">
            <div className="mb-2 flex items-center gap-2 font-medium text-gray-900">
              <MdCreditCard className="h-4 w-4" /> Payment Method
            </div>
            <p className="text-gray-500">Visa ending in 4242</p>
          </div>

          {/* Pricing */}
          <div className="rounded-xl bg-gray-50 p-4 text-sm">
            <h3 className="mb-3 font-medium text-gray-900">Pricing</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">Gang Sheet x2</span>
                <span>$108.38</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tax (8%)</span>
                <span>$10.20</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Shipping</span>
                <span>$8.93</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 font-medium text-gray-900">
                <span>Total</span>
                <span>$127.50</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3   px-6 py-4">
          <button className="flex items-center gap-1 rounded-md border border-gray-200 px-4 py-2 text-sm">
            <MdDownload className="h-4 w-4" /> Download Invoice
          </button>
          <button className="flex items-center gap-1 rounded-md bg-blue-600 px-4 py-2 text-sm text-white">
            <LuRefreshCw className="h-4 w-4" /> Reorder
          </button>
        </div>
      </div>
    </div>
  );
}
