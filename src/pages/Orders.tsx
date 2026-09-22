import { useEffect, useMemo, useRef, useState } from "react";
import { getToken } from "../utils/auth";
import { FiAlertTriangle, FiX } from "react-icons/fi";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Modal } from "../components/common/Modal";
import { SearchInput } from "../components/common/SearchInput";
import { SpaceLoader } from "../components/common/SpaceLoader";
import { JobCard } from "../components/orders/JobCard";
import { ShippingLabelModal } from "../components/orders/ShippingLabelModal";
import type { OrdersTab, OrdersTabLabel, Order } from "../types/orders";
import { apiFetch, getApiBaseUrl } from "../utils/api";
import toast from "react-hot-toast";

const Orders = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<OrdersTabLabel>(() => {
    const tab = searchParams.get("tab") as OrdersTabLabel | null;
    const valid: OrdersTabLabel[] = ["All Jobs", "Pending Review", "In Progress - Printing", "Print Shipping Label", "Order Shipped", "Completed", "Cancelled"];
    return tab && valid.includes(tab) ? tab : "All Jobs";
  });
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Order[]>([]);
  const [urgentCount, setUrgentCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [bulkExporting, setBulkExporting] = useState(false);
  const [bulkExportProgress, setBulkExportProgress] = useState<{ current: number; total: number } | null>(null);
  const [showBulkExportProgress, setShowBulkExportProgress] = useState(false);
  const [labelModal, setLabelModal] = useState<{ jobId: string; displayId: string; triggerUpdate: boolean } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);
  const cancelReasonRef = useRef<HTMLTextAreaElement>(null);
  const [tabs, setTabs] = useState<OrdersTab[]>([
    { label: "All Jobs", count: 0 },
    { label: "Pending Review", count: 0 },
    { label: "In Progress - Printing", count: 0 },
    { label: "Print Shipping Label", count: 0 },
    { label: "Order Shipped", count: 0 },
    { label: "Completed", count: 0 },
    { label: "Cancelled", count: 0 },
  ]);

  const mapOrder = (o: any): Order => {
    const actualId = String(o.actualId || o.id || "");
    const displayId = typeof o.displayId === "string" && o.displayId ? String(o.displayId) : actualId;
    const status = String(o.status || "Pending Review") as any;
    const customerName = String(o.customerName || "");
    return {
      id: actualId,
      actualId,
      displayId,
      customerName,
      isUrgent: Boolean(o.isUrgent),
      thumbnail: typeof o.thumbnail === "string" ? o.thumbnail : "/space.svg",
      sheetSize: String(o.sheetSize || ""),
      filmType: String(o.filmType || "DTF"),
      dueDate: String(o.dueDate || ""),
      location: String(o.location || ""),
      status,
      statusDescription: String(o.statusDescription || ""),
    };
  };

  const statusParam = useMemo(() => {
    if (activeTab === "All Jobs") return null;
    // The tab labels ARE the server's labels now, so no translation step.
    return activeTab;
  }, [activeTab]);

  const refreshSummary = async () => {
    const summaryRes = await apiFetch("/printer/orders/summary");
    const c = summaryRes?.counts || {};
    setUrgentCount(Number(c.urgent || 0));
    setTabs([
      { label: "All Jobs", count: Number(c.all || 0) },
      { label: "Pending Review", count: Number(c.pending || 0) },
      { label: "In Progress - Printing", count: Number(c.inProgress || 0) },
      { label: "Print Shipping Label", count: Number(c.ready || 0) },
      { label: "Order Shipped", count: Number(c.shipped || 0) },
      { label: "Completed", count: Number(c.completed || 0) },
      { label: "Cancelled", count: Number(c.cancelled || 0) },
    ]);
  };

  const fetchOrders = async ({ cursor, append }: { cursor?: string | null; append?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (statusParam) qs.set("status", statusParam);
    if (query.trim()) qs.set("q", query.trim());
    if (cursor) qs.set("cursor", cursor);
    qs.set("limit", "30");

    const listRes = await apiFetch(`/printer/orders?${qs.toString()}`);
    const raw = Array.isArray(listRes?.orders) ? listRes.orders : [];
    const mapped = raw.map(mapOrder);
    setJobs((prev) => (append ? [...prev, ...mapped] : mapped));
    setNextCursor(listRes?.nextCursor || null);
  };

  useEffect(() => {
    setSelectedJobs([]);
    setLoading(true);
    const id = window.setTimeout(() => {
      Promise.all([fetchOrders({ append: false }), refreshSummary()])
        .catch((e: any) => toast.error(e?.message || "Failed to load orders"))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(id);
  }, [statusParam, query]);

  const filteredOrders = useMemo(() => jobs, [jobs]);

  const getDisplayIdFor = (id: string) => {
    const found = jobs.find((j) => j.id === id);
    return found?.displayId || id;
  };

  const downloadExport = async (exportId: string, fileName: string) => {
    const token = getToken();
    const res = await fetch(`${getApiBaseUrl()}/printer/exports/${encodeURIComponent(exportId)}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const updateStatus = async (orderId: string, to: string) => {
    await apiFetch(`/printer/orders/${encodeURIComponent(orderId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: to }),
    });
    await Promise.all([fetchOrders({ append: false }), refreshSummary()]);
  };

  const handlePrimaryAction = async (id: string, current: Order["status"]) => {
    try {
      if (current === "Pending Review") {
        await updateStatus(id, "In Progress - Printing");
        navigate(`/orders/${encodeURIComponent(id)}`);
        return;
      }
      if (current === "In Progress - Printing") {
        const found = jobs.find((j) => j.id === id);
        setLabelModal({ jobId: id, displayId: found?.displayId || id, triggerUpdate: true });
        return;
      }
      if (current === "Print Shipping Label") {
        const found = jobs.find((j) => j.id === id);
        setLabelModal({ jobId: id, displayId: found?.displayId || id, triggerUpdate: false });
        return;
      }
    } catch (e: any) {
      toast.error(e?.message || "Action failed");
    }
  };

  const handleCancelClick = (id: string) => {
    setCancelTarget(id);
    setCancelReason("");
    setTimeout(() => cancelReasonRef.current?.focus(), 50);
  };

  const handleCancelConfirm = async () => {
    if (!cancelTarget) return;
    setCancelLoading(true);
    try {
      await apiFetch(`/printer/orders/${encodeURIComponent(cancelTarget)}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });
      toast.success("Job cancelled");
      setCancelTarget(null);
      setCancelReason("");
      await Promise.all([fetchOrders({ append: false }), refreshSummary()]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to cancel job");
    } finally {
      setCancelLoading(false);
    }
  };

  const handleBulkComplete = async () => {
    try {
      for (const id of selectedJobs) {
        await apiFetch(`/printer/orders/${encodeURIComponent(id)}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: "Completed" }),
        });
      }
      toast.success("Updated selected jobs");
      setSelectedJobs([]);
      await Promise.all([fetchOrders({ append: false }), refreshSummary()]);
    } catch (e: any) {
      toast.error(e?.message || "Bulk update failed");
    }
  };

  const handleBulkExport = async () => {
    if (bulkExporting) return;
    setBulkExporting(true);
    setBulkExportProgress({ current: 0, total: selectedJobs.length });
    setShowBulkExportProgress(false);
    const timer = window.setTimeout(() => setShowBulkExportProgress(true), 1000);
    try {
      for (let i = 0; i < selectedJobs.length; i += 1) {
        const id = selectedJobs[i];
        setBulkExportProgress({ current: i + 1, total: selectedJobs.length });
        const r = await apiFetch(`/printer/jobs/${encodeURIComponent(id)}/gangsheet/export`, {
          method: "POST",
          body: JSON.stringify({ format: "PNG", toDrive: false }),
        });
        const exportJobId = String(r?.exportJobId || "");
        if (!exportJobId) throw new Error("Export failed");

        let exportId = "";
        while (true) {
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
          const statusRes = await apiFetch(`/printer/jobs/export-status/${encodeURIComponent(exportJobId)}`);
          if (statusRes.status === "done") {
            exportId = String(statusRes.result?.exportId || "");
            break;
          } else if (statusRes.status === "failed") {
            throw new Error(statusRes.error || "Export failed");
          }
        }

        if (exportId) {
          await downloadExport(exportId, `gangsheet_${getDisplayIdFor(id)}_300dpi.png`);
        }
      }
      toast.success("Export started");
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    } finally {
      window.clearTimeout(timer);
      setShowBulkExportProgress(false);
      setBulkExportProgress(null);
      setBulkExporting(false);
    }
  };

  const handleToggleJob = (id: string) => {
    setSelectedJobs((prev) =>
      prev.includes(id) ? prev.filter((jobId) => jobId !== id) : [...prev, id],
    );
  };

  const handleSelectAll = () => {
    const visibleIds = filteredOrders.map((job) => job.id);
    const allVisibleSelected = visibleIds.every((id) =>
      selectedJobs.includes(id),
    );

    if (allVisibleSelected) {
      // Deselect all visible
      setSelectedJobs((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      // Select all visible (merge with existing non-visible selections)
      setSelectedJobs((prev) => {
        const newSelection = new Set([...prev, ...visibleIds]);
        return Array.from(newSelection);
      });
    }
  };

  const isAllVisibleSelected =
    filteredOrders.length > 0 &&
    filteredOrders.every((job) => selectedJobs.includes(job.id));

  const isSomeVisibleSelected =
    filteredOrders.some((job) => selectedJobs.includes(job.id)) &&
    !isAllVisibleSelected;

  const getTabActiveStyles = (label: string) => {
    switch (label) {
      case "Pending Review":
        return {
          text: "text-orange-600",
          border: "border-orange-600",
          bg: "bg-orange-100",
          badgeText: "text-orange-600",
        };
      case "In Progress":
        return {
          text: "text-blue-600",
          border: "border-blue-600",
          bg: "bg-blue-100",
          badgeText: "text-blue-600",
        };
      case "Ready":
        return {
          text: "text-purple-600",
          border: "border-purple-600",
          bg: "bg-purple-100",
          badgeText: "text-purple-600",
        };
      case "Completed":
        return {
          text: "text-green-600",
          border: "border-green-600",
          bg: "bg-green-100",
          badgeText: "text-green-600",
        };
      default:
        return {
          text: "text-blue-600",
          border: "border-blue-600",
          bg: "bg-blue-100",
          badgeText: "text-blue-600",
        };
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-50 -mx-6 -mt-6 px-6 pt-6 pb-4    ">
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Jobs & Orders</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Manage and track all your fulfillment jobs.
              {!loading && (tabs.find((t) => t.label === "Pending Review")?.count || urgentCount) ? (
                <span className="text-red-600 font-medium">
                  {" "}{tabs.find((t) => t.label === "Pending Review")?.count || 0} jobs awaiting your action •{" "}
                  {urgentCount} urgent
                </span>
              ) : null}
            </p>
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-200">
            <div className="flex items-center gap-8 overflow-x-auto">
              {tabs.map((tab) => {
                const styles = getTabActiveStyles(tab.label);
                const isActive = activeTab === tab.label;
                return (
                  <button
                    key={tab.label}
                    onClick={() => setActiveTab(tab.label)}
                    className={`pb-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-2 ${
                      isActive
                        ? `${styles.border} ${styles.text}`
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        isActive
                          ? `${styles.bg} ${styles.badgeText}`
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search */}
          <div>
            <SearchInput
              placeholder="Search by order ID or customer name..."
              className="w-full bg-white border-gray-200 py-2.5"
              containerClassName="w-full max-w-lg"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* Bulk Action Bar */}
          {selectedJobs.length > 0 && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center gap-4">
                <span className="text-blue-700 font-medium text-sm pl-2">
                  {selectedJobs.length} job
                  {selectedJobs.length !== 1 ? "s" : ""} selected
                </span>
                <div className="h-4 w-px bg-blue-200" />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleBulkComplete()}
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Mark as Complete
                  </button>
                  <button
                    disabled={bulkExporting}
                    onClick={() => void handleBulkExport()}
                    className="px-3 py-1.5 bg-white text-gray-700 border border-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Export Selected
                  </button>
                </div>
              </div>
              <button
                onClick={() => setSelectedJobs([])}
                className="p-1 hover:bg-blue-100 rounded-full text-blue-500 transition-colors"
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>
          )}

          {bulkExporting && showBulkExportProgress && bulkExportProgress && (
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <SpaceLoader label={`Exporting selected… ${bulkExportProgress.current}/${bulkExportProgress.total}`} />
            </div>
          )}

          {/* Select All Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={isAllVisibleSelected}
                ref={(input) => {
                  if (input) {
                    input.indeterminate = isSomeVisibleSelected;
                  }
                }}
                onChange={handleSelectAll}
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span className="text-sm text-gray-700 font-medium">
                Select All
              </span>
            </div>
            <div className="text-sm text-gray-500 font-medium">
              Showing{" "}
              <span className="text-gray-900 font-bold">
                {filteredOrders.length}
              </span>{" "}
              jobs
            </div>
          </div>
        </div>
      </div>

      {/* Jobs List */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <SpaceLoader />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-14 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-gray-900 font-semibold">No jobs found</p>
            <p className="text-gray-400 text-sm">
              {query ? `No results for "${query}"` : activeTab === "All Jobs" ? "You have no jobs yet." : `No ${activeTab.toLowerCase()} jobs at the moment.`}
            </p>
          </div>
        ) : (
          filteredOrders.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              selected={selectedJobs.includes(job.id)}
              onToggle={handleToggleJob}
              onPrimaryAction={(id, status) => void handlePrimaryAction(id, status)}
              onSecondaryAction={(id) => navigate(`/orders/${encodeURIComponent(id)}`)}
              onCancel={handleCancelClick}
            />
          ))
        )}
      </div>

      {nextCursor && !loading && (
        <div className="flex justify-center">
          <button
            onClick={() => void fetchOrders({ cursor: nextCursor, append: true })}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Load more
          </button>
        </div>
      )}

      {/* Shipping Label Modal */}
      {labelModal && (
        <ShippingLabelModal
          jobId={labelModal.jobId}
          displayId={labelModal.displayId}
          triggerUpdate={labelModal.triggerUpdate}
          onClose={() => setLabelModal(null)}
          onShipped={() => {
            setLabelModal(null);
            void Promise.all([fetchOrders({ append: false }), refreshSummary()]);
          }}
        />
      )}

      {/* Cancel Confirmation Modal */}
      <Modal
        isOpen={cancelTarget !== null}
        onClose={() => { if (!cancelLoading) { setCancelTarget(null); setCancelReason(""); } }}
        title={
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
              <FiAlertTriangle className="w-4 h-4 text-red-500" />
            </div>
            <span className="text-base font-bold text-gray-900">Cancel Job</span>
          </div>
        }
        className="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to cancel{" "}
            <span className="font-semibold text-gray-900">
              {cancelTarget ? (jobs.find((j) => j.id === cancelTarget)?.displayId || cancelTarget) : ""}
            </span>
            ? This action cannot be undone.
          </p>
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
              Reason <span className="text-gray-400 font-normal normal-case tracking-normal">(optional)</span>
            </label>
            <textarea
              ref={cancelReasonRef}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Customer requested cancellation, artwork issues..."
              rows={3}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 transition-all resize-none"
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => { setCancelTarget(null); setCancelReason(""); }}
              disabled={cancelLoading}
              className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              Keep Job
            </button>
            <button
              onClick={() => void handleCancelConfirm()}
              disabled={cancelLoading}
              className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              {cancelLoading ? "Cancelling…" : "Cancel Job"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Orders;
