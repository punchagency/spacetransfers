import { useState, useEffect } from "react";
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
import { getApiBaseUrl } from "../../lib/utils/api";
import { clearAuth, getToken } from "../../lib/utils/auth";
import { apiFetch } from "../../lib/utils/api";
import toast from "react-hot-toast";
import { formatOrderNumber } from "../../lib/utils/orderNumber";

interface OrderDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string | null;
}

export default function OrderDetailsModal({
  isOpen,
  onClose,
  orderId,
}: OrderDetailsModalProps) {
  const [order, setOrder] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && orderId) {
      fetchOrderDetails();
    }
  }, [isOpen, orderId]);

  const fetchOrderDetails = async () => {
    setIsLoading(true);
    try {
      const data = await apiFetch(`/customer/orders/${orderId}`);
      setOrder(data);
    } catch (err: any) {
      toast.error(err.message || "Failed to load order details");
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadInvoice = async () => {
    if (!orderId) return;
    try {
      // Not a hard-coded localhost. This only ever worked in development.
      const token = getToken();
      const response = await fetch(
        `${getApiBaseUrl()}/customer/orders/${orderId}/invoice`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );

      if (!response.ok) {
        // A blob download bypasses `apiFetch`, so the session check has to be
        // made here too — otherwise an expired token reads as a broken invoice.
        if (response.status === 401) {
          clearAuth();
          throw new Error("Your session has expired. Please sign in again.");
        }
        let message = "Failed to download invoice";
        try { message = (await response.json())?.message || message; } catch { /* not JSON */ }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${orderId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      toast.error(err.message || "Failed to download invoice");
    }
  };

  const handleReorder = async () => {
    if (!orderId) return;
    try {
      await apiFetch(`/customer/orders/${orderId}/reorder`, {
        method: "POST",
      });
      toast.success("Order placed successfully!");
    } catch (err: any) {
      toast.error(err.message || "Failed to reorder");
    }
  };

  if (!isOpen) return null;

  if (isLoading || !order) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs">
        <div className="w-full max-w-2xl rounded-2xl bg-white p-12 flex flex-col items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
          <p className="mt-4 text-sm text-gray-500">Loading order details...</p>
        </div>
      </div>
    );
  }

  const getStatusStyles = (status: string) => {
    switch (status.toLowerCase()) {
      case "completed":
      case "paid":
        return "bg-green-100 text-green-700";
      case "shipped":
        return "bg-purple-100 text-purple-700";
      case "processing":
        return "bg-blue-100 text-blue-700";
      case "pending":
        return "bg-yellow-100 text-yellow-700";
      case "cancelled":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
              <BsBoxSeam className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900">
                  Order Details
                </h2>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${getStatusStyles(order.status)}`}>
                  {order.status}
                </span>
              </div>
              <p className="text-sm text-gray-500">
                {formatOrderNumber(order.displayId, order.orderId)} · {new Date(order.date || Date.now()).toLocaleDateString()}
              </p>
            </div>
          </div>
          <button
            className="text-gray-400 hover:text-gray-600 transition-colors"
            onClick={onClose}
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-6 overflow-y-auto flex-1">
          {/* Order Summary */}
          <div className="rounded-xl bg-gray-50 p-4 border border-gray-100">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              Order Summary
            </h3>
            <div className="grid grid-cols-2 gap-y-4 text-sm">
              <div>
                <p className="text-gray-500 text-xs">Order Number</p>
                <div className="flex items-center gap-1 font-medium text-gray-900">
                  {order.orderId}
                  <button onClick={() => {
                    navigator.clipboard.writeText(order.orderId);
                    toast.success("Copied to clipboard");
                  }}>
                    <MdContentCopy className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-pointer" />
                  </button>
                </div>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Order Date</p>
                <p className="font-medium text-gray-900">
                  {new Date(order.date || Date.now()).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
              </div>
            </div>
          </div>

          {/* Items */}
          <div>
            {(() => {
              const consolidatedItems = (order.items || []).reduce((acc: any, item: any) => {
                const key = `${item.name}-${item.description || ""}-${item.price || 0}`;
                if (!acc[key]) {
                  acc[key] = { ...item };
                } else {
                  acc[key].quantity += item.quantity;
                  acc[key].subtotal += item.subtotal;
                }
                return acc;
              }, {} as Record<string, any>);
              const displayItems = Object.values(consolidatedItems);

              return (
                <>
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">
                    Items ({displayItems.length} Unique)
                  </h3>
                  <div className="space-y-2">
                    {displayItems.map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between rounded-xl bg-gray-50 p-4 text-sm border border-gray-100">
                        <div>
                          <p className="font-semibold text-gray-900">
                            {item.name}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-gray-500 text-xs">{item.description}</span>
                            <span className="h-1 w-1 rounded-full bg-gray-300"></span>
                            <span className="text-xs font-bold text-blue-600">Qty: {item.quantity}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-gray-900">${(item.subtotal || 0).toFixed(2)}</p>
                          {item.quantity > 1 && (
                            <p className="text-[10px] text-gray-400">${((item.subtotal || 0) / item.quantity).toFixed(2)} each</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>

          {/* Addresses */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-gray-50 p-4 text-sm border border-gray-100">
              <div className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                <IoLocationOutline className="h-4 w-4 text-blue-600" /> Shipping Address
              </div>
              <p className="text-gray-700 font-medium">{order.shippingAddress?.name}</p>
              <p className="text-gray-500 mt-1">{order.shippingAddress?.street}</p>
              <p className="text-gray-500">{order.shippingAddress?.city}, {order.shippingAddress?.state} {order.shippingAddress?.postalCode}</p>
              <p className="text-gray-500">{order.shippingAddress?.country}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-4 text-sm border border-gray-100">
              <div className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                </div>
              <p className="text-gray-700 font-medium capitalize">{order.payment?.method} Payment</p>
              {order.payment?.cardBrand && (
                <p className="text-gray-500 mt-1">
                  {order.payment.cardBrand.toUpperCase()} ending in {order.payment.cardLast4}
                </p>
              )}
              <p className="text-gray-500 mt-1">Currency: {order.pricing?.currency}</p>
            </div>
          </div>

          {/* Pricing */}
          <div className="rounded-xl bg-gray-50 p-4 text-sm border border-gray-100">
            <h3 className="mb-3 font-semibold text-gray-900">Order Totals</h3>
            <div className="space-y-2">
              {order.pricing?.lineItems?.map((line: any, idx: number) => (
                <div key={idx} className="flex justify-between">
                  <span className="text-gray-500">{line.label}</span>
                  <span className="font-medium text-gray-900">${(line.amount || 0).toFixed(2)}</span>
                </div>
              ))}
              <div className="mt-3 flex justify-between border-t border-gray-200 pt-3 text-base font-bold text-gray-900">
                <span>Total</span>
                <span>${(order.pricing?.total || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <button 
            onClick={handleDownloadInvoice}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <MdDownload className="h-4 w-4" /> Invoice
          </button>
          <button 
            onClick={handleReorder}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-all shadow-sm"
          >
            <LuRefreshCw className="h-4 w-4" /> Reorder
          </button>
        </div>
      </div>
    </div>
  );
}
