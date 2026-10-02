import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { apiFetch } from "../utils/api";
import type { Order as OrderRow } from "../data/orders";
import { mapAdminOrderToRow } from "../utils/orderMappers";

type OrdersState = {
  recentOrders: OrderRow[];
  ordersList: OrderRow[];
  nextCursor: string | null;
  loadingRecent: boolean;
  loadingList: boolean;
  fetchRecentOrders: (range?: string) => Promise<{ stats: any }>;
  fetchOrdersList: (params?: { status?: string; cursor?: string | null; append?: boolean; search?: string }) => Promise<void>;
  /**
   * Set when the last list fetch failed.
   *
   * `fetchOrdersList` had no catch — only a `finally` — and every caller invokes
   * it un-awaited, so a failed load became an unhandled rejection and the orders
   * table rendered "No data found." with no toast and no error. The console's
   * most important table failed completely silently.
   */
  listError: string | null;
  upsertOrderRow: (actualId: string, patch: Partial<OrderRow>) => void;
};

const OrdersStoreContext = createContext<OrdersState | null>(null);

export const OrdersStoreProvider = ({ children }: { children: ReactNode }) => {
  const [records, setRecords] = useState<Record<string, OrderRow>>({});
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [listIds, setListIds] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const upsertMany = useCallback((rows: OrderRow[]) => {
    setRecords((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const key = r.actualId || r.id.toLowerCase();
        next[key] = { ...next[key], ...r };
      }
      return next;
    });
  }, []);

  const fetchRecentOrders = useCallback(async (range: string = "30d") => {
    setLoadingRecent(true);
    try {
      const response = await apiFetch(`/admin/dashboard/stats?range=${encodeURIComponent(range)}`);
      const rows: OrderRow[] = Array.isArray(response.recentOrders)
        ? response.recentOrders.map((o: any) => mapAdminOrderToRow(o))
        : [];
      upsertMany(rows);
      setRecentIds(rows.map((r) => r.actualId || ""));
      return { stats: response.stats };
    } finally {
      setLoadingRecent(false);
    }
  }, [upsertMany]);

  const fetchOrdersList = useCallback(
    async ({
      status,
      cursor = null,
      append = false,
      search,
    }: { status?: string; cursor?: string | null; append?: boolean; search?: string } = {}) => {
      setLoadingList(true);
      try {
        const statusParam = status && status !== "All" ? `&status=${encodeURIComponent(status)}` : "";
        const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const searchParam = search && search.trim() ? `&search=${encodeURIComponent(search.trim())}` : "";
        /**
         * `/admin/orders`, not the generic `/orders` feed.
         *
         * `mapAdminOrderToRow` reads `region`, `assignedPartner` and `profits`,
         * and the generic feed returns none of them — so every row fell back to
         * region "West", partner "Unassigned" and profit $0.00 regardless of
         * the truth. The admin endpoint returns those fields, and is also the
         * only one that supports `search`.
         */
        const response = await apiFetch(`/admin/orders?limit=15${statusParam}${cursorParam}${searchParam}`);
        const rows: OrderRow[] = Array.isArray(response.orders)
          ? response.orders.map((o: any) => mapAdminOrderToRow(o))
          : [];

        upsertMany(rows);
        setNextCursor(response.nextCursor || null);
        setListIds((prev) => (append ? [...prev, ...rows.map((r) => r.actualId || "")] : rows.map((r) => r.actualId || "")));
        setRecentIds((prev) => {
          if (prev.length > 0) return prev;
          const sorted = [...rows].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
          return sorted.slice(0, 5).map((r) => r.actualId || "");
        });
        setListError(null);
      } catch (error: any) {
        const message = error?.message || "Could not load orders";
        setListError(message);
        toast.error(message);
        // Rows from an earlier successful load are kept on an append —
        // losing them would be a worse outcome than a stale page.
        if (!append) setListIds([]);
      } finally {
        setLoadingList(false);
      }
    },
    [upsertMany],
  );

  const upsertOrderRow = useCallback((actualId: string, patch: Partial<OrderRow>) => {
    setRecords((prev) => ({
      ...prev,
      [actualId]: { ...(prev[actualId] || ({} as any)), ...patch, actualId },
    }));
  }, []);

  const recentOrders = useMemo(() => recentIds.map((id) => records[id]).filter(Boolean), [recentIds, records]);
  const ordersList = useMemo(() => listIds.map((id) => records[id]).filter(Boolean), [listIds, records]);

  const value: OrdersState = {
    recentOrders,
    ordersList,
    nextCursor,
    loadingRecent,
    loadingList,
    listError,
    fetchRecentOrders,
    fetchOrdersList,
    upsertOrderRow,
  };

  return <OrdersStoreContext.Provider value={value}>{children}</OrdersStoreContext.Provider>;
};

export const useOrdersStore = () => {
  const ctx = useContext(OrdersStoreContext);
  if (!ctx) throw new Error("useOrdersStore must be used within OrdersStoreProvider");
  return ctx;
};

