import { useState, useEffect } from "react";
import {
  MdClose,
  MdArrowBack,
  MdInventory,
  MdVisibility,
  MdDownload,
  MdOutlineReportProblem,
} from "react-icons/md";
import { apiFetch } from "../../lib/utils/api";
import { downloadInvoice } from "../../lib/utils/invoice";
import toast from "react-hot-toast";
import { formatOrderNumber } from "../../lib/utils/orderNumber";
import { canReportIssue, issueButton, type OrderIssueSummary } from "../../lib/utils/orderIssues";
import OrderIssueModal from "./OrderIssueModal";

interface Order {
  orderId: string;
  /** Canonical order number (DTF-####); absent on pre-displayId orders. */
  displayId?: string | null;
  status: string;
  date: string;
  total: number | null;
  sheetSize: string | null;
  trackingNumber: string | null;
  /** What happened to the money, when any of it was refunded. */
  refundNote?: string | null;
  /** The order this one replaces free of charge. */
  reprintOf?: string | null;
  issue?: OrderIssueSummary | null;
}

interface OrderHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onViewDetails: (orderId: string) => void;
  /** Adds the order's sheets to the cart; reports its own outcome. */
  onReorderToCart?: (orderId: string) => Promise<unknown> | unknown;
}

export default function OrderHistoryModal({
  isOpen,
  onClose,
  onViewDetails,
  onReorderToCart,
}: OrderHistoryModalProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The list comes 20 at a time; past that, orders were simply not shown.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Which order's invoice or reorder is in flight, so a second tap waits.
  const [busy, setBusy] = useState<string | null>(null);
  const [reporting, setReporting] = useState<{ orderId: string; number: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchOrders();
    }
  }, [isOpen]);

  /** Re-reads the orders already shown, so a report made or read shows on its row. */
  const refreshOrders = async () => {
    try {
      const data = await apiFetch(`/customer/orders?limit=${Math.min(100, Math.max(20, orders.length))}`);
      setOrders(data.orders || []);
      setNextCursor(data.nextCursor || null);
    } catch {
      // The list on screen is still right apart from the badge.
    }
  };

  const fetchOrders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/customer/orders");
      setOrders(data.orders || []);
      setNextCursor(data.nextCursor || null);
    } catch (err: any) {
      console.error("Failed to fetch orders:", err);
      setError(err.message || "Failed to load order history");
      toast.error("Failed to load order history");
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await apiFetch(`/customer/orders?cursor=${encodeURIComponent(nextCursor)}`);
      setOrders((prev) => [...prev, ...(data.orders || [])]);
      setNextCursor(data.nextCursor || null);
    } catch (err: any) {
      toast.error(err.message || "Couldn't load more orders. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleDownloadInvoice = async (order: Order) => {
    if (busy) return;
    setBusy(`invoice-${order.orderId}`);
    try {
      await downloadInvoice(order.orderId, order.displayId);
    } catch (err: any) {
      toast.error(err.message || "The invoice couldn't be downloaded. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleReorder = async (orderId: string) => {
    if (busy || !onReorderToCart) return;
    setBusy(`reorder-${orderId}`);
    try {
      await onReorderToCart(orderId);
    } catch (err: any) {
      toast.error(err.message || "This order couldn't be reordered. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  if (!isOpen) return null;

  const getStatusStyles = (status: string) => {
    switch (status.toLowerCase()) {
      case "completed":
      case "paid":
        return { bg: "bg-green-100", text: "text-green-700" };
      case "shipped":
        return { bg: "bg-purple-100", text: "text-purple-700" };
      case "processing":
        return { bg: "bg-blue-100", text: "text-blue-700" };
      case "pending":
        return { bg: "bg-yellow-100", text: "text-yellow-700" };
      case "cancelled":
        return { bg: "bg-red-100", text: "text-red-700" };
      default:
        return { bg: "bg-gray-100", text: "text-gray-700" };
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs px-3 py-4 sm:p-0"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 sm:px-6 py-4 border-b border-gray-100">
          <div className="flex items-start gap-3">
            <button onClick={onClose} aria-label="Back" className="mt-1 text-gray-500 hover:text-gray-700 transition-colors">
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
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        {/* Orders */}
        <div className="px-4 sm:px-6 py-4 overflow-y-auto flex-1">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
              <p className="mt-4 text-sm text-gray-500">Loading your orders...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-500 text-sm">{error}</p>
              <button 
                onClick={fetchOrders}
                className="mt-4 text-sm text-blue-600 hover:underline"
              >
                Try again
              </button>
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 text-sm">You haven't placed any orders yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => {
                const styles = getStatusStyles(order.status);
                const report = issueButton(order.issue);
                return (
                  <div key={order.orderId} className="rounded-xl bg-gray-50 p-4 border border-gray-100 hover:border-gray-200 transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">
                          {formatOrderNumber(order.displayId, order.orderId)}
                        </p>
                        <span
                          className={`rounded-full ${styles.bg} px-2.5 py-0.5 text-xs font-medium ${styles.text}`}
                        >
                          {order.status}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">
                        {new Date(order.date).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-gray-500 text-xs">Amount</p>
                        <p className="font-medium text-gray-900">
                          {order.total ? `$${order.total.toFixed(2)}` : order.reprintOf ? "Free" : "N/A"}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-xs">Sheet Size</p>
                        <p className="font-medium text-gray-900">
                          {order.sheetSize || "N/A"}
                        </p>
                      </div>
                    </div>

                    {order.trackingNumber && (
                      <div className="mt-3 text-sm">
                        <p className="text-gray-500 text-xs">Tracking Number</p>
                        <p className="font-medium text-gray-900 break-all select-all">{order.trackingNumber}</p>
                      </div>
                    )}

                    {(order.reprintOf || order.refundNote) && (
                      <p className="mt-3 text-xs text-gray-600">
                        {[order.reprintOf ? `Free reprint of ${order.reprintOf}.` : null, order.refundNote].filter(Boolean).join(" ")}
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => onViewDetails(order.orderId)}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <MdVisibility className="h-4 w-4" /> View Details
                      </button>
                      <button
                        onClick={() => handleDownloadInvoice(order)}
                        disabled={busy !== null}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
                      >
                        <MdDownload className="h-4 w-4" />
                        {busy === `invoice-${order.orderId}` ? "Downloading…" : "Invoice"}
                      </button>
                      <button
                        onClick={() => handleReorder(order.orderId)}
                        disabled={busy !== null}
                        className="rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-600 hover:bg-blue-100 transition-colors disabled:opacity-60"
                      >
                        {busy === `reorder-${order.orderId}` ? "Adding…" : "Reorder"}
                      </button>
                      {(order.issue || canReportIssue(order.status)) && (
                        <button
                          onClick={() =>
                            setReporting({ orderId: order.orderId, number: formatOrderNumber(order.displayId, order.orderId) })
                          }
                          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                            report.tone === "reply"
                              ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
                              : report.tone === "open"
                                ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          <MdOutlineReportProblem className="h-4 w-4" /> {report.label}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {nextCursor && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="w-full rounded-lg border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Load older orders"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-gray-100 px-4 sm:px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
      <OrderIssueModal order={reporting} onClose={() => setReporting(null)} onChanged={refreshOrders} />
    </div>
  );
}
