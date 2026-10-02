import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import { StatsGrid } from "../components/stats/StatsGrid";
import { OrdersTable } from "../components/orders/OrdersTable";
import { SelectInput } from "../components/common/SelectInput";
import { type StatCardItem } from "../types/dashboard";
import { useOrdersStore } from "../state/OrdersStore";

/**
 * Reporting periods the stats endpoint supports.
 *
 * The server has always accepted all four; the dashboard hard-coded "30d" and
 * offered no way to change it, so three quarters of the endpoint was
 * unreachable — and the cards said "Total Orders" while showing a 30-day count.
 */
const RANGES = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "ytd", label: "Year to date" },
] as const;

type Range = (typeof RANGES)[number]["value"];

const labelForRange = (r: Range) =>
  RANGES.find((x) => x.value === r)?.label ?? "Last 30 days";

export const Dashboard = () => {
  const [range, setRange] = useState<Range>("30d");
  const [statsCards, setStatsCards] = useState<StatCardItem[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const { recentOrders, fetchRecentOrders, loadingRecent } = useOrdersStore();

  useEffect(() => {
    let cancelled = false;

    const fetchDashboardData = async () => {
      setLoading(true);
      // Clear first: leaving the previous period's figures on screen while a
      // new one loads shows numbers that belong to a range the selector no
      // longer says is selected.
      setStatsCards(undefined);
      try {
        const { stats } = await fetchRecentOrders(range);
        if (cancelled) return;

        const period = labelForRange(range).toLowerCase();
        const rev = stats.totalRevenue || {};
        // The server sends `comparable: false` when the previous window had no
        // revenue at all — the trend is then meaningless rather than +100%.
        const comparable = rev.comparable !== false;
        const priorAmount = Number(rev.priorAmount ?? 0);
        const trendHint = comparable
          ? `Compared with the previous ${period.replace(/^last /, "")} ($${priorAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
          : `No revenue in the previous ${period.replace(/^last /, "")}, so there is nothing to compare against`;

        setStatsCards([
          {
            title: "Total Orders",
            value: stats.totalOrders?.toString() || "0",
          },
          {
            /*
              Counts PENDING, which now means "no partner attached" and nothing
              else — assignment moves an order to PROCESSING. Before that change
              PENDING covered both, so "Pending Orders" was a vague mix; it is
              now the one queue an admin has to act on, and the label says which.
            */
            title: "Unassigned Orders",
            value: stats.pendingOrders?.toString() || "0",
            subtitle: "Awaiting a print partner",
          },
          {
            title: "Total Revenue",
            value: `$${(stats.totalRevenue?.amount || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`,
            trendPct: comparable ? Number(rev.trendPct ?? 0) : null,
            trendHint,
            // The server counts every order that is not cancelled or rejected,
            // so this is money booked rather than money collected. The Profits
            // column already marks itself "est." for the same reason; without
            // this the page hedged the derived figure while stating the raw one
            // with more confidence than it has.
            subtitle: "Includes orders not yet paid or shipped",
          },
          {
            // Last, and visually separated: the server counts every partner
            // currently marked Active regardless of date, so this one does not
            // follow the period control. Sitting among the scoped metrics with
            // no distinction was what made the control ambiguous.
            title: "Active Partners",
            value: stats.activePartners?.toString() || "0",
            subtitle: "All time",
          },
        ]);
      } catch (error: any) {
        if (cancelled) return;
        toast.error(error?.message || "Could not load dashboard stats");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchDashboardData();
    return () => {
      cancelled = true;
    };
  }, [fetchRecentOrders, range]);

  return (
    <DashboardLayout>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Dashboard Overview</h1>
        <p className="text-gray-500">
          Welcome to your DTF print management admin portal
        </p>
      </div>

      {/* The control sits with the metrics it governs, and says which those
          are — it was in the page header, where nothing indicated that one of
          the four cards ignores it. */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {/* <label htmlFor="dashboard-range" className="text-sm font-medium text-gray-700">
          Period
        </label> */}
        <SelectInput
          id="dashboard-range"
          value={range}
          onChange={(e) => setRange(e.target.value as Range)}
          containerClassName="w-44"
        >
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </SelectInput>
        <span className="text-xs text-gray-400">
          Applies to Total Orders, Unassigned Orders and Total Revenue
        </span>
      </div>

      <div className="mt-4">
        <StatsGrid cards={statsCards} />
      </div>

      <div className="mt-4">
        {loading || loadingRecent ? (
          <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-100 flex justify-center items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-gray-500">Loading dashboard...</span>
          </div>
        ) : recentOrders.length > 0 ? (
          <OrdersTable orders={recentOrders} title="Recent Orders" itemsPerPage={5} />
        ) : (
          <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-100 text-center">
            <p className="text-gray-500 italic">No recent orders found.</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};
