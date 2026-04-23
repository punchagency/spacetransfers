import { useEffect, useState } from "react";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import { StatsGrid } from "../components/stats/StatsGrid";
import { OrdersTable } from "../components/orders/OrdersTable";
import { type StatCardItem } from "../types/dashboard";
import { useOrdersStore } from "../state/OrdersStore";

export const Dashboard = () => {
  const [statsCards, setStatsCards] = useState<StatCardItem[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const { recentOrders, fetchRecentOrders, loadingRecent } = useOrdersStore();

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const { stats } = await fetchRecentOrders("30d");
        setStatsCards([
          { title: "Total Orders", value: stats.totalOrders?.toString() || "0", trend: "" },
          { title: "Pending Orders", value: stats.pendingOrders?.toString() || "0", trend: "" },
          { title: "Active Partners", value: stats.activePartners?.toString() || "0", trend: "" },
          { 
            title: "Total Revenue", 
            value: `$${(stats.totalRevenue?.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 
            trend: stats.totalRevenue?.trendPct ? `${stats.totalRevenue.trendPct > 0 ? '+' : ''}${stats.totalRevenue.trendPct}%` : "" 
          },
        ]);

      } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [fetchRecentOrders]);

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Dashboard Overview</h1>
        <p className="text-gray-500">
          Welcome to your DTF print management admin portal
        </p>
      </div>
      <StatsGrid cards={statsCards} />
      
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
    </DashboardLayout>
  );
};
