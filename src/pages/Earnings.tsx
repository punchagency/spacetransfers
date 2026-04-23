import { useEffect, useMemo, useState } from "react";
import { FiChevronDown, FiSearch } from "react-icons/fi";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import { StatsGrid } from "../components/stats/StatsGrid";
import { GenericTable } from "../components/common/GenericTable";
import { RevenueChartCard } from "../components/earnings/RevenueChartCard";
import { RevenueByRegionCard } from "../components/earnings/RevenueByRegionCard";
import { ProfitMarginPill } from "../components/earnings/ProfitMarginPill";
import { currency } from "../utils/formatters";
import { apiFetch } from "../utils/api";
import toast from "react-hot-toast";
import type { EarningsRow } from "../types/earnings";
import type { StatCardItem } from "../types/dashboard";

export const Earnings = () => {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All Statuses");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EarningsRow[]>([]);
  const [statsCards, setStatsCards] = useState<StatCardItem[] | undefined>(
    undefined
  );
  const [revenueChart, setRevenueChart] = useState<{
    currentTotal: number;
    previousTotal: number;
    points: Array<{ label: string; current: number; previous: number }>;
  }>({ currentTotal: 0, previousTotal: 0, points: [] });
  const [revenueByRegion, setRevenueByRegion] = useState<
    Array<{ region: string; value: number; percentage: number }>
  >([]);

  useEffect(() => {
    const fetchSummary = async () => {
      setLoading(true);
      try {
        const response = await apiFetch("/admin/earnings/summary?range=30d");

        setStatsCards([
          {
            title: "Total Profits",
            value: currency(response.kpis?.totalProfits?.value || 0),
            trend:
              typeof response.kpis?.totalProfits?.trendPct === "number"
                ? `${response.kpis.totalProfits.trendPct > 0 ? "+" : ""}${response.kpis.totalProfits.trendPct}%`
                : "",
          },
          {
            title: "Total Costs",
            value: currency(response.kpis?.totalCosts?.value || 0),
            trend:
              typeof response.kpis?.totalCosts?.trendPct === "number"
                ? `${response.kpis.totalCosts.trendPct > 0 ? "+" : ""}${response.kpis.totalCosts.trendPct}%`
                : "",
          },
          {
            title: "Profit Earned",
            value: currency(response.kpis?.profitEarned?.value || 0),
            trend:
              typeof response.kpis?.profitEarned?.trendPct === "number"
                ? `${response.kpis.profitEarned.trendPct > 0 ? "+" : ""}${response.kpis.profitEarned.trendPct}%`
                : "",
          },
          {
            title: "Total Revenue",
            value: currency(response.kpis?.totalRevenue?.value || 0),
            trend:
              typeof response.kpis?.totalRevenue?.trendPct === "number"
                ? `${response.kpis.totalRevenue.trendPct > 0 ? "+" : ""}${response.kpis.totalRevenue.trendPct}%`
                : "",
          },
        ]);

        setRevenueChart({
          currentTotal: Number(response.revenueChart?.currentTotal || 0),
          previousTotal: Number(response.revenueChart?.previousTotal || 0),
          points: Array.isArray(response.revenueChart?.points)
            ? response.revenueChart.points.map((p: any) => ({
                label: String(p.label),
                current: Number(p.current || 0),
                previous: Number(p.previous || 0),
              }))
            : [],
        });

        setRevenueByRegion(
          Array.isArray(response.revenueByRegion)
            ? response.revenueByRegion.map((r: any) => ({
                region: String(r.region || "Unknown"),
                value: Number(r.value || 0),
                percentage: Number(r.percentage || 0),
              }))
            : []
        );

        const mappedRows: EarningsRow[] = Array.isArray(response.products)
          ? response.products.map((p: any) => ({
              name: String(p.name || "Custom Print"),
              sku: String(p.sku || ""),
              baseCost: Number(p.baseCost || 0),
              markupPct: Number(p.markup || 0),
              finalPrice: Number(p.finalPrice || 0),
              quantity: Number(p.quantity || 0),
              totalCost: Number(p.totalCost || 0),
              totalRevenue: Number(p.totalRevenue || 0),
              profit: Number(p.profit || 0),
              profitMarginPct: Number(p.profitMargin || 0),
            }))
          : [];
        setRows(mappedRows);
      } catch (error: any) {
        toast.error(error.message || "Failed to load earnings");
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byQuery = !q
      ? rows
      : rows.filter((r) => {
          return (
            r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)
          );
        });

    if (status === "All Statuses") return byQuery;
    if (status === "High Margin")
      return byQuery.filter((r) => r.profitMarginPct >= 40);
    if (status === "Low Margin")
      return byQuery.filter((r) => r.profitMarginPct < 40);
    return byQuery;
  }, [query, status, rows]);

  const columns = [
    {
      header: "Product Name",
      render: (row: EarningsRow) => (
        <div className="leading-tight">
          <div className="font-medium text-gray-900">{row.name}</div>
          <div className="text-xs text-gray-500 mt-1">{row.sku}</div>
        </div>
      ),
    },
    {
      header: "Base Cost",
      render: (row: EarningsRow) => currency(row.baseCost),
    },
    { header: "Markup %", render: (row: EarningsRow) => `${row.markupPct}%` },
    {
      header: "Final Price",
      render: (row: EarningsRow) => currency(row.finalPrice),
    },
    {
      header: "Quantity",
      render: (row: EarningsRow) => row.quantity.toString(),
    },
    {
      header: "Total Cost",
      render: (row: EarningsRow) => currency(row.totalCost),
    },
    {
      header: "Total Revenue",
      render: (row: EarningsRow) => currency(row.totalRevenue),
    },
    {
      header: "Profit",
      render: (row: EarningsRow) => (
        <span className="text-emerald-600 font-medium">
          {currency(row.profit)}
        </span>
      ),
    },
    {
      header: "Profit Margin",
      render: (row: EarningsRow) => (
        <ProfitMarginPill value={row.profitMarginPct} />
      ),
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Earnings Dashboard</h1>
        <p className="text-gray-500">
          Configure product pricing, markup, and profit margins
        </p>
      </div>

      <StatsGrid cards={statsCards} />

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1">
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 h-[393px] flex items-center justify-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-500 text-sm">Loading revenue...</span>
            </div>
          ) : (
            <RevenueChartCard
              currentTotal={revenueChart.currentTotal}
              previousTotal={revenueChart.previousTotal}
              points={revenueChart.points}
            />
          )}
        </div>
        <div className="w-[292px] flex-shrink-0">
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 w-[292px] h-[393px] flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-500 text-sm">Loading regions...</span>
            </div>
          ) : (
            <RevenueByRegionCard rows={revenueByRegion} />
          )}
        </div>
      </div>

      {/* Search + Filter row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="relative w-full max-w-xl">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <FiSearch className="text-gray-400" />
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or region..."
            className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-sm placeholder:text-gray-400"
          />
        </div>

        <div className="relative">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="appearance-none bg-white border border-gray-200 rounded-xl px-4 py-3 pr-10 text-sm shadow-sm outline-none"
          >
            <option>All Statuses</option>
            <option>High Margin</option>
            <option>Low Margin</option>
          </select>
          <FiChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        </div>
      </div>

      <GenericTable<EarningsRow> data={filtered} columns={columns} />
    </DashboardLayout>
  );
};
