import { FiEye, FiRefreshCw, FiCheckCircle, FiClock } from "react-icons/fi";
import { HiArrowTrendingUp } from "react-icons/hi2";
import { TbCurrencyDollar } from "react-icons/tb";
import { MdOutlinePendingActions } from "react-icons/md";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertBanner } from "../components/common/AlertBanner";
import { SpaceLoader } from "../components/common/SpaceLoader";
import { GenericTable } from "../components/common/GenericTable";
import { StatusBadge } from "../components/common/StatusBadge";
import type { DashboardJob } from "../types/dashboard";
import { apiFetch } from "../utils/api";

interface DashboardCard {
  label: string;
  value: string;
  trend: string;
  trendUp?: boolean;
}

interface PayoutSummary {
  totalEarnings: number;
  availableBalance: number;
  pendingEarnings: number;
  paidOutAmount: number;
}

// Map API card labels to icons and accent colours, matching Earnings card style.
const CARD_META: Record<string, { icon: React.ElementType; color: string }> = {
  "Today's Earnings": { icon: TbCurrencyDollar,        color: "bg-blue-50 text-blue-600"   },
  "Completed Orders": { icon: FiCheckCircle,           color: "bg-green-50 text-green-600" },
  "Pending Orders":   { icon: MdOutlinePendingActions, color: "bg-orange-50 text-orange-600" },
  "Total Revenue":    { icon: HiArrowTrendingUp,       color: "bg-purple-50 text-purple-600" },
};
const FALLBACK_META = { icon: FiClock, color: "bg-gray-50 text-gray-500" };

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cards, setCards] = useState<DashboardCard[]>([]);
  const [urgentJobs, setUrgentJobs] = useState<DashboardJob[]>([]);
  const [assignedJobs, setAssignedJobs] = useState<DashboardJob[]>([]);
  const [, setPayoutSummary] = useState<PayoutSummary | null>(null);

  const userName = useMemo(() => {
    try {
      const raw = localStorage.getItem("printer_user");
      if (!raw) return "Printer";
      const u = JSON.parse(raw);
      return String(u?.name || "Printer");
    } catch {
      return "Printer";
    }
  }, []);

  const fmtMoney = (n: number) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fetchData = useCallback(async () => {
    const [r, summary] = await Promise.all([
      apiFetch("/printer/dashboard/stats"),
      apiFetch("/payouts/printer/summary"),
    ]);

    const nextCards: DashboardCard[] = Array.isArray(r?.cards)
      ? r.cards.map((c: any) => ({
          label:   String(c.label   || ""),
          value:   String(c.value   || ""),
          trend:   String(c.trend   || "0%"),
          trendUp: c.trendUp !== false,
        }))
      : [];

    // Override "Total Revenue" with the exact payout-summary totalEarnings so both
    // pages always show the identical number from the same source of truth.
    if (summary?.totalEarnings !== undefined) {
      const idx = nextCards.findIndex((c) => c.label === "Total Revenue");
      if (idx >= 0) {
        nextCards[idx] = { ...nextCards[idx], value: fmtMoney(Number(summary.totalEarnings)) };
      }
    }

    setCards(nextCards);
    setPayoutSummary(summary ?? null);
    setUrgentJobs(Array.isArray(r?.urgentJobs)   ? r.urgentJobs   : []);
    setAssignedJobs(Array.isArray(r?.assignedJobs) ? r.assignedJobs : []);
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await fetchData(); } finally { setRefreshing(false); }
  }, [fetchData]);

  const columns = [
    {
      header: "Job ID",
      render: (job: DashboardJob) => (
        <span className="font-medium text-gray-900">{job.displayId || job.id}</span>
      ),
    },
    { header: "Customer Name", key: "customerName" as const, className: "text-gray-600" },
    { header: "Order",         key: "order"        as const, className: "text-gray-600" },
    { header: "Deadline",      key: "deadline"     as const, className: "text-gray-600" },
    {
      header: "Status",
      render: (job: DashboardJob) => <StatusBadge status={job.isUrgent ? "Urgent" : job.status} />,
    },
    {
      header: "Action",
      className: "text-center",
      render: () => (
        <div className="flex justify-center">
          <button className="text-gray-500 hover:text-gray-700 cursor-pointer">
            <FiEye className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-50 -mx-6 -mt-6 px-6 pt-6 pb-4 flex items-start justify-between border-b border-gray-200">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Welcome back, {userName}!</h1>
          <p className="text-gray-500 mt-1">
            Here's your fulfillment overview for today. You have{" "}
            <span className="text-blue-600 font-medium cursor-pointer hover:underline">
              {assignedJobs.length} jobs
            </span>{" "}
            assigned to you{urgentJobs.length ? ` • ${urgentJobs.length} urgent` : ""}.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 font-medium rounded-2xl hover:bg-gray-50 transition-colors disabled:opacity-60"
          title="Refresh"
        >
          <FiRefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Alert Banner */}
      {urgentJobs.length > 0 && (
        <AlertBanner
          title="Urgent Jobs Alert"
          message={`You have ${urgentJobs.length} urgent job${urgentJobs.length === 1 ? "" : "s"} assigned. Please review and start processing to avoid delays.`}
          variant="warning"
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <SpaceLoader />
        </div>
      ) : (
        <>
          {/* Stats Grid — Earnings card style */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {cards.map((card, index) => {
              const meta = CARD_META[card.label] ?? FALLBACK_META;
              const Icon = meta.icon;
              const isNeg = card.trend.trim().startsWith("-");
              return (
                <div key={index} className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-gray-600 font-medium text-sm">{card.label}</h3>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${meta.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>
                  <div>
                    <span className="text-3xl font-bold text-gray-900 tracking-tight">{card.value}</span>
                    <p className={`text-xs mt-1 font-medium ${isNeg ? "text-red-500" : "text-green-600"}`}>
                      {card.trend} vs yesterday
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Assigned Jobs Table */}
          <GenericTable
            title="Assigned Jobs"
            data={assignedJobs}
            columns={columns}
            itemsPerPage={10}
            onRowClick={(row) => navigate(`/print-queue?jobId=${encodeURIComponent(row.id)}`)}
          />
        </>
      )}
    </div>
  );
};

export default Dashboard;
