import { useState, useEffect } from "react";
import { MdClose, MdContentCopy, MdCreditCard, MdDownload } from "react-icons/md";
import { BsBoxSeam } from "react-icons/bs";
import { CiDeliveryTruck } from "react-icons/ci";
import { IoLocationOutline } from "react-icons/io5";
import { LuRefreshCw } from "react-icons/lu";
import { apiFetch } from "../../lib/utils/api";
import { downloadInvoice } from "../../lib/utils/invoice";
import toast from "react-hot-toast";
import { formatOrderNumber } from "../../lib/utils/orderNumber";
import CancelOrderDialog from "./CancelOrderDialog";
import CancellationNote from "../orders/CancellationNote";

interface OrderDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string | null;
  /** Fills the cart from a past order and opens checkout; reports its own outcome. */
  onReorderToCart?: (orderId: string) => Promise<unknown> | unknown;
}

const getStatusStyles = (status: string) => {
  switch (String(status || "").toLowerCase()) {
    case "completed":
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

const money = (n: unknown) => `${Number(n) < 0 ? "−" : ""}$${Math.abs(Number(n) || 0).toFixed(2)}`;

export default function OrderDetailsModal({
  isOpen,
  onClose,
  orderId,
  onReorderToCart,
}: OrderDetailsModalProps) {
  const [order, setOrder] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [busy, setBusy] = useState<"invoice" | "reorder" | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (isOpen && orderId) {
      fetchOrderDetails();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, orderId]);

  const fetchOrderDetails = async () => {
    setIsLoading(true);
    setOrder(null);
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

  /** Re-reads the order in place after a change, without the loading flash. */
  const reloadOrder = async () => {
    try {
      setOrder(await apiFetch(`/customer/orders/${orderId}`));
    } catch {
      // What is on screen is still right apart from the change just made.
    }
  };

  const handleDownloadInvoice = async () => {
    if (!orderId || busy) return;
    setBusy("invoice");
    try {
      await downloadInvoice(orderId, order?.displayId);
    } catch (err: any) {
      toast.error(err.message || "The invoice couldn't be downloaded. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleReorder = async () => {
    if (!orderId || busy || !onReorderToCart) return;
    setBusy("reorder");
    try {
      await onReorderToCart(orderId);
    } catch (err: any) {
      toast.error(err.message || "This order couldn't be reordered. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  if (!isOpen) return null;

  if (isLoading || !order) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs px-3 sm:p-0"
        onClick={onClose}
      >
        <div className="w-full max-w-2xl rounded-2xl bg-white p-12 flex flex-col items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
          <p className="mt-4 text-sm text-gray-500">Loading order details...</p>
        </div>
      </div>
    );
  }

  const orderNumber = formatOrderNumber(order.displayId, order.orderId);
  const orderDate = order.date ? new Date(order.date) : null;
  const express = order.shippingMethod === "express";
  const items: any[] = Array.isArray(order.items) ? order.items : [];

  const copyOrderNumber = async () => {
    try {
      await navigator.clipboard.writeText(orderNumber);
      toast.success("Order number copied");
    } catch {
      toast.error("Couldn't copy — select the number instead.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs px-3 py-4 sm:p-0"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50">
              <BsBoxSeam className="h-5 w-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900">Order Details</h2>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${getStatusStyles(order.status)}`}>
                  {order.status}
                </span>
              </div>
              <p className="text-sm text-gray-500">
                {orderNumber}
                {orderDate ? ` · ${orderDate.toLocaleDateString()}` : ""}
              </p>
            </div>
          </div>
          <button
            className="text-gray-400 hover:text-gray-600 transition-colors"
            onClick={onClose}
            aria-label="Close"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-4 sm:px-6 py-5 overflow-y-auto flex-1">
          {/* Order Summary */}
          <div className="rounded-xl bg-gray-50 p-4 border border-gray-100">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">Order Summary</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500 text-xs">Order Number</p>
                <div className="flex items-center gap-1 font-medium text-gray-900">
                  <span className="select-all">{orderNumber}</span>
                  <button onClick={copyOrderNumber} aria-label="Copy order number">
                    <MdContentCopy className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-pointer" />
                  </button>
                </div>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Order Date</p>
                <p className="font-medium text-gray-900">
                  {orderDate
                    ? orderDate.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
                    : "—"}
                </p>
              </div>
            </div>
            {orderId && <CancellationNote orderId={orderId} cancellation={order.cancellation} onChanged={() => void reloadOrder()} />}
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              {items.length === 1 ? "1 sheet" : `${items.length} sheets`}
            </h3>
            <div className="space-y-2">
              {items.map((item: any, idx: number) => (
                <div key={idx} className="flex items-center gap-3 rounded-xl bg-gray-50 p-3 sm:p-4 text-sm border border-gray-100">
                  {item.previewImage ? (
                    <img
                      src={item.previewImage}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded border border-gray-200 bg-[#E9F2F1] object-contain"
                      // A stored picture can be gone; hide it rather than show a broken image.
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 truncate">{item.name}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      {item.description ? <span className="text-gray-500 text-xs">{item.description}</span> : null}
                      {item.description ? <span className="h-1 w-1 rounded-full bg-gray-300"></span> : null}
                      <span className="text-xs font-bold text-blue-600">Qty: {item.quantity}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold text-gray-900">{money(item.subtotal)}</p>
                    {item.quantity > 1 && (
                      <p className="text-[10px] text-gray-400">{money((item.subtotal || 0) / item.quantity)} each</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Addresses, delivery and payment */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-gray-50 p-4 text-sm border border-gray-100">
              <div className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                <IoLocationOutline className="h-4 w-4 text-blue-600" /> Shipping Address
              </div>
              <p className="text-gray-700 font-medium">{order.shippingAddress?.name}</p>
              <p className="text-gray-500 mt-1">{order.shippingAddress?.street}</p>
              <p className="text-gray-500">
                {order.shippingAddress?.city}, {order.shippingAddress?.state} {order.shippingAddress?.postalCode}
              </p>
              <p className="text-gray-500">{order.shippingAddress?.country}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-4 text-sm border border-gray-100">
              <div className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                <CiDeliveryTruck className="h-4 w-4 text-blue-600" /> Delivery
              </div>
              <p className="text-gray-700 font-medium">
                {express ? "Express shipping (urgent order)" : "Standard shipping"}
              </p>
              {order.trackingNumber ? (
                <>
                  <p className="text-gray-500 text-xs mt-2">
                    Tracking number{order.carrier ? ` · ${order.carrier}` : ""}
                  </p>
                  <p className="font-medium text-gray-900 break-all select-all">{order.trackingNumber}</p>
                </>
              ) : (
                <p className="text-gray-500 mt-1">
                  {order.status === "Cancelled"
                    ? order.refundNote || "This order was cancelled."
                    : "Tracking appears here once it ships."}
                </p>
              )}
            </div>
            <div className="rounded-xl bg-gray-50 p-4 text-sm border border-gray-100 md:col-span-2">
              {/* This heading was an empty row: its icon and title were missing. */}
              <div className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                <MdCreditCard className="h-4 w-4 text-blue-600" /> Payment
              </div>
              <p className="text-gray-700 font-medium">
                {order.reprintOf
                  ? `No charge. Free reprint of ${order.reprintOf}.`
                  : `${order.payment?.method === "card" ? "Card" : order.payment?.method || "—"}${
                      order.payment?.cardBrand && order.payment?.cardLast4
                        ? ` · ${String(order.payment.cardBrand).toUpperCase()} ending in ${order.payment.cardLast4}`
                        : ""
                    }`}
              </p>
              {order.refundNote && order.status !== "Cancelled" && <p className="mt-1 text-gray-500">{order.refundNote}</p>}
            </div>
          </div>

          {/* Pricing — the same lines as the invoice, adding up to the total. */}
          <div className="rounded-xl bg-gray-50 p-4 text-sm border border-gray-100">
            <h3 className="mb-3 font-semibold text-gray-900">Order Totals</h3>
            <div className="space-y-2">
              {order.pricing?.lineItems?.map((line: any, idx: number) => (
                <div key={idx} className="flex justify-between gap-3">
                  <span className="text-gray-500">{line.label}</span>
                  <span className="font-medium text-gray-900 tabular-nums">{money(line.amount)}</span>
                </div>
              ))}
              <div className="mt-3 flex justify-between border-t border-gray-200 pt-3 text-base font-bold text-gray-900">
                <span>Total</span>
                <span className="tabular-nums">{money(order.pricing?.total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap justify-end gap-3 px-4 sm:px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          {order.cancellation?.option && (
            <button
              onClick={() => setCancelling(true)}
              disabled={busy !== null}
              className="mr-auto rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-60"
            >
              Cancel order
            </button>
          )}
          <button
            onClick={handleDownloadInvoice}
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            <MdDownload className="h-4 w-4" /> {busy === "invoice" ? "Downloading…" : "Invoice"}
          </button>
          <button
            onClick={handleReorder}
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 sm:px-6 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-all shadow-sm disabled:opacity-60"
          >
            <LuRefreshCw className="h-4 w-4" /> {busy === "reorder" ? "Adding…" : "Reorder"}
          </button>
        </div>
      </div>
      <CancelOrderDialog
        order={cancelling && orderId && order.cancellation?.option ? { orderId, number: orderNumber, option: order.cancellation.option } : null}
        onClose={() => setCancelling(false)}
        onDone={() => void reloadOrder()}
      />
    </div>
  );
}
