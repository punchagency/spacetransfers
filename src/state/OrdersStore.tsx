import { createContext, useCallback, useContext, useMemo, useState } from "react";
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
  fetchOrdersList: (params?: { status?: string; cursor?: string | null; append?: boolean }) => Promise<void>;
  upsertOrderRow: (actualId: string, patch: Partial<OrderRow>) => void;
};

const OrdersStoreContext = createContext<OrdersState | null>(null);

export const OrdersStoreProvider = ({ children }: { children: any }) => {
  const [records, setRecords] = useState<Record<string, OrderRow>>({});
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [listIds, setListIds] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [loadingList, setLoadingList] = useState(false);

  const upsertMany = useCallback((rows: OrderRow[]) => {
    setRecords((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const key = r.actualId || r.id.replace("#ORD-", "").toLowerCase();
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
    }: { status?: string; cursor?: string | null; append?: boolean } = {}) => {
      setLoadingList(true);
      try {
        const statusParam = status && status !== "All" ? `&status=${encodeURIComponent(status)}` : "";
        const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const response = await apiFetch(`/orders?limit=15${statusParam}${cursorParam}`);
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

