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
import { DeadlineCountdown } from "../components/common/DeadlineCountdown";
import type { DashboardJob } from "../types/dashboard";
import { apiFetch } from "../utils/api";
import { useProfileStore } from "../state/ProfileStore";
import toast from "react-hot-toast";

interface DashboardCard {
  label: string;
  value: string;
  /** What the figure covers, in place of the "vs yesterday" trend that measured nothing. */
  note: string;
  /** Whether this card follows the period control, or is current-state. */
  scoped: boolean;
}

/** The same four periods the admin dashboard offers, so the two compare. */
const RANGES = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "ytd", label: "Year to date" },
] as const;

type Range = (typeof RANGES)[number]["value"];

// Map API card labels to icons and accent colours, matching Earnings card style.
const CARD_META: Record<string, { icon: React.ElementType; color: string }> = {
  "Earnings":         { icon: TbCurrencyDollar,        color: "bg-blue-50 text-blue-600"   },
  "Jobs Completed":   { icon: FiCheckCircle,           color: "bg-green-50 text-green-600" },
  "Pending Orders":   { icon: MdOutlinePendingActions, color: "bg-orange-50 text-orange-600" },
  // "Total Earned", not "Total Revenue" — revenue is what the company takes;
  // this is the partner's own page and their own money.
  "Total Earned":     { icon: HiArrowTrendingUp,       color: "bg-purple-50 text-purple-600" },
};
const FALLBACK_META = { icon: FiClock, color: "bg-gray-50 text-gray-500" };

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cards, setCards] = useState<DashboardCard[]>([]);
  const [assignedJobs, setAssignedJobs] = useState<DashboardJob[]>([]);
  /*
   * No separate urgent list. Urgent jobs are already in the assigned table —
   * the server now sorts them to the top so they can never be the rows the cap
   * cuts off — and they carry an Urgent badge there. A second list of the same
   * jobs was one more place to disagree with the first.
   */
  /*
   * The true totals, which are not the lengths of the lists above — the server
   * caps those for the page. Rendering `assignedJobs.length` told a partner with
   * 20 live jobs that they had 12.
   */
  const [assignedTotal, setAssignedTotal] = useState(0);
  const [urgentTotal, setUrgentTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Whether the stats have ever arrived, so a failure before then isn't shown as zeros.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [range, setRange] = useState<Range>("30d");

  const { name: storeName } = useProfileStore();
  const userName = useMemo(() => {
    if (storeName?.trim()) return storeName.trim();
    try {
      const raw = localStorage.getItem("printer_user");
      if (!raw) return "";
      const u = JSON.parse(raw);
      return String(u?.companyName || u?.name || "");
    } catch {
      return "";
    }
  }, [storeName]);

  const fetchData = useCallback(async (forRange: Range) => {
    const r = await apiFetch(`/printer/dashboard/stats?range=${forRange}`);

    setCards(
      Array.isArray(r?.cards)
        ? r.cards.map((c: any) => ({
            label: String(c.label || ""),
            value: String(c.value || ""),
            note: String(c.note || ""),
            scoped: c.scoped !== false,
          }))
        : [],
    );
    setAssignedJobs(Array.isArray(r?.assignedJobs) ? r.assignedJobs : []);
    setAssignedTotal(Number(r?.assignedTotal ?? 0));
    setUrgentTotal(Number(r?.urgentTotal ?? 0));
    setLoadError(null);
    setHasLoaded(true);
  }, []);

  useEffect(() => {
    fetchData(range)
      .catch((e: any) => setLoadError(e?.message || "Could not load your dashboard"))
      .finally(() => setLoading(false));
  }, [fetchData, range]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchData(range);
    } catch (e: any) {
      setLoadError(e?.message || "Could not refresh your dashboard");
      toast.error(e?.message || "Could not refresh your dashboard");
    } finally {
      setRefreshing(false);
    }
  }, [fetchData, range]);

  const columns = [
    {
      header: "Job ID",
      render: (job: DashboardJob) => (
        <span className="font-medium text-gray-900">{job.displayId || job.id}</span>
      ),
    },
    { header: "Customer Name", key: "customerName" as const, className: "text-gray-600" },
    { header: "Order",         key: "order"        as const, className: "text-gray-600" },
    {
      header: "Next deadline",
      render: (job: DashboardJob) =>
        job.deadline && job.dueStage ? (
          <span>
            <span className="text-gray-500">{job.dueStage === "PRINT" ? "Print by " : "Accept by "}</span>
            <DeadlineCountdown iso={job.deadline} />
          </span>
        ) : (
          <span className="text-gray-400" title="Nothing is due from you on this job right now.">None</span>
        ),
    },
    {
      header: "Status",
      // The job's stage, with Urgent as its own tag: urgent is the order's
      // type, not a stage, and it used to replace the stage in this column.
      render: (job: DashboardJob) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <StatusBadge status={job.status} />
          {job.isUrgent && <StatusBadge status="Urgent" />}
        </span>
      ),
    },
    {
      header: "Action",
      className: "text-center",
      /*
       * A span, not a button. It never had an onClick — it worked only because
       * the click bubbled to the row's navigate handler, so it looked
       * interactive while being inert on its own. The row is the control.
       */
      render: () => (
        <div className="flex justify-center">
          <FiEye className="w-4 h-4 text-gray-400 group-hover:text-gray-600" aria-hidden />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-50 -mx-4 md:-mx-6 -mt-4 md:-mt-6 px-4 md:px-6 pt-4 md:pt-6 pb-4 flex flex-col md:flex-row gap-3 md:gap-0 md:items-start md:justify-between border-b border-gray-200">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Welcome back{userName ? `, ${userName}` : ""}!</h1>
          {!hasLoaded && loadError ? (
            <p className="text-gray-500 mt-1">Your jobs couldn't be loaded right now.</p>
          ) : (
          <p className="text-gray-500 mt-1">
            Here's your fulfillment overview for today. You have{" "}
            {/*
              A real link. It was styled as one — blue, underlined on hover,
              cursor-pointer — with no handler at all, so it invited a click and
              did nothing. And it rendered the length of the capped list rather
              than the true total.
            */}
            <button
              type="button"
              onClick={() => navigate("/orders")}
              className="text-blue-600 font-medium hover:underline focus:outline-none focus:underline"
            >
              {assignedTotal} job{assignedTotal === 1 ? "" : "s"}
            </button>{" "}
            assigned to you{urgentTotal ? ` • ${urgentTotal} urgent` : ""}.
          </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
            disabled={loading}
            aria-label="Reporting period"
            className="px-3 py-2 bg-white border border-gray-200 text-gray-700 font-medium rounded-2xl text-sm outline-none focus:border-blue-500 disabled:opacity-60"
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 font-medium rounded-2xl hover:bg-gray-50 transition-colors disabled:opacity-60"
          title="Refresh"
        >
          <FiRefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
        </div>
      </div>

      {/* Counts the true total, not the five the list is capped to. */}
      {urgentTotal > 0 && (
        <AlertBanner
          title="Urgent Jobs Alert"
          message={`You have ${urgentTotal} urgent job${urgentTotal === 1 ? "" : "s"} assigned. Please review and start processing to avoid delays.`}
          variant="warning"
        />
      )}

      {loadError && (
        <AlertBanner
          title="Could not load your dashboard"
          message={`${loadError} — the figures below may be missing or out of date. Try Refresh.`}
          variant="error"
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
              return (
                <div key={index} className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-gray-600 font-medium text-sm">{card.label}</h3>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${meta.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>
                  <div>
                    <span className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">{card.value}</span>
                    {card.note && (
                      <p className="text-xs mt-1 text-gray-400">
                        {card.note}
                        {/* Set apart so the period control is never ambiguous:
                            two of these four are current-state, not period figures. */}
                        {!card.scoped && (
                          <span className="ml-1 text-gray-300">· not filtered by period</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Assigned Jobs Table */}
          <div className="space-y-3">
            <GenericTable
              title="Assigned Jobs"
              data={assignedJobs}
              columns={columns}
              itemsPerPage={10}
              onRowClick={(row) => navigate(`/orders/${encodeURIComponent(row.id)}`)}
            />
            {/* Says so when there is more than this page holds, rather than
                letting the table read as the whole workload. */}
            {assignedTotal > assignedJobs.length && (
              <p className="text-xs text-gray-500 text-center">
                Showing your {assignedJobs.length} most recent of {assignedTotal} active jobs.{" "}
                <button
                  type="button"
                  onClick={() => navigate("/orders")}
                  className="text-blue-600 font-medium hover:underline"
                >
                  See all
                </button>
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;
