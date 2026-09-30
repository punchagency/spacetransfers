import { useEffect, useMemo, useRef, useState } from "react";
import { FiAlertTriangle } from "react-icons/fi";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Modal } from "../components/common/Modal";
import { SearchInput } from "../components/common/SearchInput";
import { SpaceLoader } from "../components/common/SpaceLoader";
import { JobCard } from "../components/orders/JobCard";
import { ShippingLabelModal } from "../components/orders/ShippingLabelModal";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { confirmCopy, type ConfirmableStep } from "../utils/statusActions";
import type { OrdersTab, OrdersTabLabel, Order } from "../types/orders";
import { apiFetch } from "../utils/api";
import toast from "react-hot-toast";

const Orders = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<OrdersTabLabel>(() => {
    const tab = searchParams.get("tab") as OrdersTabLabel | null;
    const valid: OrdersTabLabel[] = ["All Jobs", "Pending Review", "In Progress - Printing", "Print Shipping Label", "Order Shipped", "Completed", "Cancelled"];
    return tab && valid.includes(tab) ? tab : "All Jobs";
  });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  // A failed load used to fall through to "You have no jobs yet" and zero
  // counts — read as fact by a partner. Kept so the page says it didn't load.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [jobs, setJobs] = useState<Order[]>([]);
  const [urgentCount, setUrgentCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // A step waiting for the partner to confirm it (Accept & Start, Print Shipping Label).
  const [pendingStep, setPendingStep] = useState<{ id: string; step: ConfirmableStep } | null>(null);
  const [stepBusy, setStepBusy] = useState(false);
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
      deadline: typeof o.deadline === "string" ? o.deadline : null,
      dueStage: o.dueStage === "ACCEPT" || o.dueStage === "PRINT" ? o.dueStage : null,
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
    setLoading(true);
    const id = window.setTimeout(() => {
      Promise.all([fetchOrders({ append: false }), refreshSummary()])
        .then(() => setLoadError(null))
        .catch((e: any) => setLoadError(e?.message || "Failed to load orders"))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(id);
  }, [statusParam, query, reloadKey]);

  const filteredOrders = useMemo(() => jobs, [jobs]);

  const updateStatus = async (orderId: string, to: string) => {
    await apiFetch(`/printer/orders/${encodeURIComponent(orderId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: to }),
    });
    await Promise.all([fetchOrders({ append: false }), refreshSummary()]);
  };

  /*
   * Moves that change the job for the customer and the admin ask first: every
   * move is forward-only, and these fired on the first click.
   */
  const handlePrimaryAction = (id: string, current: Order["status"]) => {
    if (current === "Pending Review") {
      setPendingStep({ id, step: "In Progress - Printing" });
      return;
    }
    if (current === "In Progress - Printing") {
      setPendingStep({ id, step: "Print Shipping Label" });
      return;
    }
    if (current === "Print Shipping Label") {
      // Viewing the label changes nothing, so it doesn't ask.
      const found = jobs.find((j) => j.id === id);
      setLabelModal({ jobId: id, displayId: found?.displayId || id, triggerUpdate: false });
      return;
    }
    // Shipped, completed and cancelled jobs open their details.
    navigate(`/orders/${encodeURIComponent(id)}`);
  };

  const confirmPendingStep = async () => {
    if (!pendingStep) return;
    const { id, step } = pendingStep;
    if (step === "Print Shipping Label") {
      // The label dialog makes the move and follows the label being bought.
      const found = jobs.find((j) => j.id === id);
      setPendingStep(null);
      setLabelModal({ jobId: id, displayId: found?.displayId || id, triggerUpdate: true });
      return;
    }
    setStepBusy(true);
    try {
      await updateStatus(id, step);
      setPendingStep(null);
      navigate(`/orders/${encodeURIComponent(id)}`);
    } catch (e: any) {
      toast.error(e?.message || "Action failed");
    } finally {
      setStepBusy(false);
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
      <div className="sticky top-0 z-10 bg-gray-50 -mx-4 md:-mx-6 -mt-4 md:-mt-6 px-4 md:px-6 pt-4 md:pt-6 pb-4    ">
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Jobs & Orders</h1>
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

          {/*
            The selection checkboxes and their bulk bar are gone. "Mark as
            Complete" skipped printing and shipping and made jobs payable (the
            server now refuses it), and "Export Selected" pulled full-size print
            files one after another; exporting from each job, sheet by sheet,
            is the way to do it.
          */}
          <div className="flex items-center justify-end">
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
        ) : loadError && filteredOrders.length === 0 ? (
          <div role="alert" className="bg-white border border-red-200 rounded-xl p-14 flex flex-col items-center gap-3 text-center">
            <p className="text-gray-900 font-semibold">Your jobs couldn't be loaded</p>
            <p className="text-gray-500 text-sm max-w-md">{loadError}</p>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="mt-1 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800"
            >
              Try again
            </button>
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
              onPrimaryAction={(id, status) => handlePrimaryAction(id, status)}
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

      <ConfirmDialog
        isOpen={pendingStep !== null}
        busy={stepBusy}
        {...(pendingStep
          ? confirmCopy(pendingStep.step, jobs.find((j) => j.id === pendingStep.id)?.displayId || "this job")
          : { title: "", body: "", confirmLabel: "" })}
        onConfirm={() => void confirmPendingStep()}
        onCancel={() => setPendingStep(null)}
      />

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
