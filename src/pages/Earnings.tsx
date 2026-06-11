import { useCallback, useEffect, useRef, useState } from "react";
import {
  FiDownload,
  FiSearch,
  FiClock,
  FiCheckCircle,
  FiCalendar,
  FiAlertCircle,
  FiRefreshCw,
} from "react-icons/fi";
import { HiArrowTrendingUp } from "react-icons/hi2";
import { TbCurrencyDollar } from "react-icons/tb";
import toast from "react-hot-toast";

import { GenericTable } from "../components/common/GenericTable";
import { JobEarningsModal } from "../components/earnings/JobEarningsModal";
import { SpaceLoader } from "../components/common/SpaceLoader";
import { apiFetch, getApiBaseUrl } from "../utils/api";
import type { EarningsJob, EarningsJobStatus, EarningsTimeFilter } from "../types/earnings";

interface PayoutSummary {
  totalEarnings: number;
  availableBalance: number;
  pendingEarnings: number;
  paidOutAmount: number;
  nextScheduledPayoutDate: string | null;
  stripeConnected: boolean;
  stripeOnboarded: boolean;
  payoutsEnabled: boolean;
  minimumPayoutAmount: number;
}

const RANGE_MAP: Record<EarningsTimeFilter, string> = {
  Today: "today",
  "This Week": "7d",
  "This Month": "30d",
  "All Time": "all",
};

const TIME_FILTERS: EarningsTimeFilter[] = ["Today", "This Week", "This Month", "All Time"];

const formatCurrency = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

const parseMoney = (value: string) => {
  const n = Number(String(value || "").replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const Earnings = () => {
  const [timeFilter, setTimeFilter] = useState<EarningsTimeFilter>("All Time");
  const [selectedJob, setSelectedJob] = useState<EarningsJob | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [summary, setSummary] = useState<PayoutSummary | null>(null);
  const [jobs, setJobs] = useState<EarningsJob[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Track whether the initial load has completed so filter changes
  // don't trigger the full-page loader.
  const didInitialLoad = useRef(false);

  const fetchSummary = useCallback(async () => {
    const res = await apiFetch("/payouts/printer/summary");
    setSummary(res);
  }, []);

  const fetchJobs = useCallback(async (range: string) => {
    const res = await apiFetch(`/printer/earnings/jobs?range=${range}`);
    const mapped: EarningsJob[] = (res.jobs || []).map((j: any) => ({
      id: j.id,
      customer: j.customer || "—",
      details: { title: j.details?.title || "Print Job", sub: j.details?.sub || "" },
      completed: j.completed,
      earning: `$${Number(j.earning).toFixed(2)}`,
      status: j.status as EarningsJobStatus,
    }));
    setJobs(mapped);
  }, []);

  // Initial load — both summary and jobs together.
  useEffect(() => {
    const init = async () => {
      try {
        await Promise.all([fetchSummary(), fetchJobs(RANGE_MAP["All Time"])]);
      } catch (err: any) {
        toast.error(err.message || "Failed to load earnings");
      } finally {
        setInitialLoading(false);
        didInitialLoad.current = true;
      }
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter changes after initial load — only re-fetch jobs.
  useEffect(() => {
    if (!didInitialLoad.current) return;
    setJobsLoading(true);
    fetchJobs(RANGE_MAP[timeFilter])
      .catch((err: any) => toast.error(err.message || "Failed to load jobs"))
      .finally(() => setJobsLoading(false));
  }, [timeFilter, fetchJobs]);

  // Manual refresh — re-fetches both summary and jobs.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchSummary(), fetchJobs(RANGE_MAP[timeFilter])]);
    } catch (err: any) {
      toast.error(err.message || "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }, [fetchSummary, fetchJobs, timeFilter]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem("printer_token");
      const res = await fetch(`${getApiBaseUrl()}/payouts/printer/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `earnings-export-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (err: any) {
      toast.error(err.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const filteredJobs = jobs.filter((j) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      j.id.toLowerCase().includes(q) ||
      j.customer.toLowerCase().includes(q) ||
      j.details.title.toLowerCase().includes(q)
    );
  });

  const totalEarnings = filteredJobs.reduce((sum, job) => sum + parseMoney(job.earning), 0);

  const stats = summary
    ? [
        { title: "Total Earnings",    value: formatCurrency(summary.totalEarnings),    sub: "All time",         icon: TbCurrencyDollar,  color: "blue"   },
        { title: "Available Balance", value: formatCurrency(summary.availableBalance), sub: "Ready for payout", icon: FiCheckCircle,     color: "green"  },
        { title: "Pending Earnings",  value: formatCurrency(summary.pendingEarnings),  sub: "Jobs in progress", icon: FiClock,           color: "orange" },
        { title: "Paid Out",          value: formatCurrency(summary.paidOutAmount),    sub: "Total transferred",icon: HiArrowTrendingUp, color: "purple" },
      ]
    : [];

  const colorMap: Record<string, string> = {
    blue:   "bg-blue-50 text-blue-600",
    green:  "bg-green-50 text-green-600",
    orange: "bg-orange-50 text-orange-600",
    purple: "bg-purple-50 text-purple-600",
  };

  const columns = [
    { header: "Order ID",     key: "id" as const,       className: "font-bold text-gray-900" },
    { header: "Customer",     key: "customer" as const,  className: "text-gray-600"           },
    {
      header: "Job Details",
      render: (job: EarningsJob) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium text-gray-900">{job.details.title}</span>
          <span className="text-xs text-gray-500">{job.details.sub}</span>
        </div>
      ),
    },
    { header: "Completed",    key: "completed" as const, className: "text-gray-600"           },
    { header: "Your Earning", key: "earning" as const,   className: "font-bold text-blue-600" },
    {
      header: "Payout Status",
      render: (job: EarningsJob) => (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
            job.status === "Paid"
              ? "bg-green-50 text-green-700"
              : job.status === "Pending"
                ? "bg-orange-50 text-orange-700"
                : "bg-purple-50 text-purple-700"
          }`}
        >
          {job.status === "Paid"      && <FiCheckCircle className="w-3.5 h-3.5" />}
          {job.status === "Pending"   && <FiClock       className="w-3.5 h-3.5" />}
          {job.status === "Scheduled" && <FiCalendar    className="w-3.5 h-3.5" />}
          {job.status}
        </span>
      ),
    },
    {
      header: "Actions",
      className: "text-right",
      render: (job: EarningsJob) => (
        <button
          onClick={() => { setSelectedJob(job); setIsModalOpen(true); }}
          className="text-sm font-medium text-gray-500 hover:text-gray-900 cursor-pointer"
        >
          View
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Header — always visible */}
      <div className="sticky top-0 z-20 bg-gray-50 -mx-6 -mt-6 px-6 pt-6 pb-4 flex justify-between items-start border-b border-gray-200">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Earnings & Payouts</h1>
          <p className="text-gray-500 mt-1">Track your earnings and payout history</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing || initialLoading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 font-medium rounded-2xl hover:bg-gray-50 transition-colors disabled:opacity-60"
            title="Refresh data"
          >
            <FiRefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || initialLoading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 font-medium rounded-2xl hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            {exporting ? <FiRefreshCw className="w-4 h-4 animate-spin" /> : <FiDownload className="w-4 h-4" />}
            Export
          </button>
        </div>
      </div>

      {initialLoading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <SpaceLoader />
        </div>
      ) : (
        <>
          {/* Payout info banner */}
          {summary && (
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-5 py-4">
              <FiCalendar className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-blue-900">
                  Automatic Weekly Payouts via Stripe Connect
                </p>
                <p className="text-xs text-blue-700 mt-0.5">
                  Payouts are processed automatically every Friday via Stripe Connect (test mode).
                  {summary.nextScheduledPayoutDate && (
                    <> Next scheduled: <strong>{formatDate(summary.nextScheduledPayoutDate)}</strong>.</>
                  )}{" "}
                  Minimum payout threshold: <strong>{formatCurrency(summary.minimumPayoutAmount)}</strong>.
                </p>
              </div>
              {!summary.stripeOnboarded && (
                <span className="flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-50 px-2 py-1 rounded-full border border-orange-200 whitespace-nowrap">
                  <FiAlertCircle className="w-3.5 h-3.5" />
                  Stripe not connected
                </span>
              )}
            </div>
          )}

          {/* Stats Cards */}
          <div className="grid grid-cols-4 gap-6">
            {stats.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <div key={index} className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-gray-600 font-medium text-sm">{stat.title}</h3>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colorMap[stat.color]}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>
                  <div>
                    <span className="text-3xl font-bold text-gray-900 tracking-tight">{stat.value}</span>
                    <p className="text-xs text-gray-500 mt-1">{stat.sub}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Filter & Search */}
          <div className="flex items-center p-2 bg-white rounded-2xl border border-gray-200 shadow-sm h-[72px]">
            <div className="flex items-center p-1.5 bg-[#F3F4F6] rounded-xl ml-2">
              {TIME_FILTERS.map((filter) => (
                <button
                  key={filter}
                  onClick={() => setTimeFilter(filter)}
                  className={`px-6 py-2 text-sm font-semibold rounded-lg transition-all cursor-pointer ${
                    timeFilter === filter
                      ? "bg-[#3B82F6] text-white shadow-sm"
                      : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>

            <div className="h-8 w-px bg-gray-200 mx-6" />

            <div className="relative flex-1 mr-2">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <FiSearch className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors hover:border-gray-300"
                placeholder="Search by order, customer, or job type..."
              />
            </div>
          </div>

          {/* Job Earnings Table */}
          <div className="relative">
            {jobsLoading && (
              <div className="absolute inset-0 bg-white/60 rounded-xl z-10 flex items-center justify-center">
                <FiRefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
              </div>
            )}
            <GenericTable
              title="Job Earnings"
              data={filteredJobs}
              columns={columns}
              showFooterInfo={true}
              footerLabel="jobs"
              itemsPerPage={10}
              onRowClick={(job) => { setSelectedJob(job); setIsModalOpen(true); }}
              footerRightContent={
                <div className="flex items-center gap-6">
                  <div className="text-sm">
                    <span className="text-gray-500">Total Earnings: </span>
                    <span className="font-bold text-blue-600 text-lg">
                      {`$${totalEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    </span>
                  </div>
                </div>
              }
            />
          </div>

          <JobEarningsModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            job={selectedJob}
          />
        </>
      )}
    </div>
  );
};

export default Earnings;
