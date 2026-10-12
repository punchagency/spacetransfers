import { useEffect, useState } from "react";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import { StatsGrid } from "../components/stats/StatsGrid";
import { RevenueChartCard } from "../components/earnings/RevenueChartCard";
import { RevenueByRegionCard } from "../components/earnings/RevenueByRegionCard";
import { currency } from "../utils/formatters";
import { apiFetch } from "../utils/api";
import toast from "react-hot-toast";
import type { StatCardItem } from "../types/dashboard";

const RANGES = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "ytd", label: "Year to date" },
] as const;

type Summary = {
  period: { range: string; label: string; priorLabel: string; orderCount: number };
  kpis: {
    revenue: Kpi;
    partnerCost: Kpi;
    /** What revenue carries that isn't the business's to keep. */
    deductions?: { tax: number; shipping: number; cardFees: number; refunds?: number; ordersWithoutFee: number };
    margin: Kpi & { pct: number };
    earned: Kpi & { orderCount: number };
  };
  uncostableOrders: number;
  chart: { points: Array<{ label: string; current: number; previous: number }> };
  byRegion: Array<{ region: string; value: number; percentage: number }>;
};

type Kpi = {
  value: number;
  trendPct: number | null;
  comparable: boolean;
  priorAmount: number;
};

export const Earnings = () => {
  const [range, setRange] = useState<string>("30d");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Summary | null>(null);
  /*
   * A failed load must not read as "no earnings". Without this the catch fired a
   * toast and left every card at $0.00 — indistinguishable from a genuinely
   * quiet month, and considerably more alarming.
   */
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await apiFetch(`/admin/earnings/summary?range=${range}`);
        if (cancelled) return;
        setData(response);
      } catch (error: any) {
        if (cancelled) return;
        const message = error?.message || "Could not load earnings";
        setLoadError(message);
        setData(null);
        toast.error(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const periodLabel = data?.period.label || RANGES.find((r) => r.key === range)?.label || "";
  const priorLabel = data?.period.priorLabel || "the previous period";

  const hint = (k: Kpi | undefined) =>
    !k
      ? undefined
      : k.comparable
        ? `${priorLabel}: ${currency(k.priorAmount)}`
        : `Nothing in ${priorLabel.toLowerCase()}, so there is nothing to compare against`;

  const orderCount = data?.period.orderCount ?? 0;
  const earnedCount = data?.kpis.earned.orderCount ?? 0;
  // Orders still in flight. While any exist, margin is a forecast — an order can
  // still be cancelled or re-costed before it leaves a partner.
  const openCount = Math.max(0, orderCount - earnedCount);
  const isForecast = openCount > 0;

  const statsCards: StatCardItem[] | undefined = data
    ? [
        {
          title: "Revenue",
          value: currency(data.kpis.revenue.value),
          trendPct: data.kpis.revenue.comparable ? data.kpis.revenue.trendPct : null,
          trendHint: hint(data.kpis.revenue),
          // Everything the customer paid — printing, shipping and tax — which is
          // what lands in the company account. The dashboard qualifies its own
          // revenue figure the same way, because an order counts here as soon as
          // it is placed rather than when the money clears.
          subtitle: isForecast
            ? `${orderCount} order${orderCount === 1 ? "" : "s"} · includes orders not yet paid or shipped`
            : `${orderCount} order${orderCount === 1 ? "" : "s"} · includes shipping and tax`,
        },
        {
          title: "Partner cost",
          value: currency(data.kpis.partnerCost.value),
          trendPct: data.kpis.partnerCost.comparable ? data.kpis.partnerCost.trendPct : null,
          trendHint: hint(data.kpis.partnerCost),
          subtitle: isForecast
            ? "What you owe print partners, including unshipped orders"
            : "What you owe print partners",
        },
        {
          /*
           * Labelled "est." only while something is unshipped. Marking a figure
           * estimated when every order has shipped would be its own small lie,
           * and would train an admin to ignore the marker.
           */
          title: isForecast ? "Margin (est.)" : "Margin",
          value: currency(data.kpis.margin.value),
          trendPct: data.kpis.margin.comparable ? data.kpis.margin.trendPct : null,
          trendHint: hint(data.kpis.margin),
          subtitle: isForecast
            ? `${data.kpis.margin.pct}% of revenue, after tax, shipping, fees and partners · ${openCount} not yet shipped`
            : `${data.kpis.margin.pct}% of revenue, after tax, shipping, fees and partners`,
        },
        {
          /*
           * Not a duplicate of margin, which is what the two old profit cards
           * were. Margin is what these orders are worth; this is the part that
           * has actually been earned, and it only counts once an order ships.
           */
          title: "Earned so far",
          value: currency(data.kpis.earned.value),
          trendPct: data.kpis.earned.comparable ? data.kpis.earned.trendPct : null,
          trendHint: hint(data.kpis.earned),
          subtitle: `Margin on ${earnedCount} of ${orderCount} order${orderCount === 1 ? "" : "s"} shipped`,
        },
      ]
    : undefined;

  return (
    <DashboardLayout>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Earnings</h1>
          <p className="text-gray-500">What came in, what it cost, and what you keep</p>
        </div>

        {/*
          The page was hardcoded to 30 days while the API already served 7d, 90d
          and year to date, so three quarters of what the server could answer was
          unreachable.
        */}
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                range === r.key
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loadError ? (
        <div className="bg-white rounded-xl border border-red-200 shadow-sm p-6">
          <p className="text-sm font-medium text-gray-900">Could not load earnings</p>
          <p className="text-sm text-gray-500 mt-1">{loadError}</p>
          <p className="text-sm text-gray-400 mt-1">
            These figures are unavailable, not zero.
          </p>
          <button
            onClick={() => setRange((r) => r)}
            className="mt-3 bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
          >
            Try again
          </button>
        </div>
      ) : (
        <StatsGrid cards={statsCards} />
      )}

      {!loadError && data?.kpis.deductions && (
        <p className="text-sm text-gray-500 -mt-2">
          Margin is revenue less tax <span className="text-gray-400">({currency(data.kpis.deductions.tax)}, for the state)</span>,
          shipping <span className="text-gray-400">({currency(data.kpis.deductions.shipping)})</span>, card fees{" "}
          <span className="text-gray-400">({currency(data.kpis.deductions.cardFees)})</span>
          {(data.kpis.deductions.refunds ?? 0) > 0 && (
            <>
              , refunds <span className="text-gray-400">({currency(data.kpis.deductions.refunds ?? 0)})</span>
            </>
          )}{" "}
          and partner cost.
          {data.kpis.deductions.ordersWithoutFee > 0 && (
            <>
              {" "}
              {data.kpis.deductions.ordersWithoutFee} card order
              {data.kpis.deductions.ordersWithoutFee === 1 ? " has" : "s have"} no recorded fee yet, so{" "}
              {data.kpis.deductions.ordersWithoutFee === 1 ? "its fee isn't" : "their fees aren't"} included.
            </>
          )}
        </p>
      )}

      {!loadError && (data?.uncostableOrders ?? 0) > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
          {data!.uncostableOrders} order{data!.uncostableOrders === 1 ? " has" : "s have"} no sheet
          dimensions, so no partner cost can be worked out.{" "}
          {data!.uncostableOrders === 1 ? "It is" : "They are"} left out of cost and margin rather
          than counted as free.
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 h-[393px] flex items-center justify-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
              <span className="ml-3 text-gray-500 text-sm">Loading revenue…</span>
            </div>
          ) : (
            <RevenueChartCard
              currentTotal={data?.kpis.revenue.value || 0}
              previousTotal={data?.kpis.revenue.priorAmount || 0}
              points={data?.chart.points || []}
              periodLabel={periodLabel}
              priorPeriodLabel={priorLabel}
            />
          )}
        </div>
        <div className="w-full lg:w-[292px] flex-shrink-0">
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 h-[393px] flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              <span className="ml-3 text-gray-500 text-sm">Loading regions…</span>
            </div>
          ) : (
            <RevenueByRegionCard rows={data?.byRegion || []} />
          )}
        </div>
      </div>

    </DashboardLayout>
  );
};
