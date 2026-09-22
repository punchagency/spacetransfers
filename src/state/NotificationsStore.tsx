import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getToken } from "../utils/auth";
import { apiFetch, getApiBaseUrl } from "../utils/api";

export type PrinterNotificationCategory = "jobs" | "orders" | "system";
export type PrinterNotificationPriority = "high" | "medium" | "low";

export type PrinterNotificationItem = {
  id: string;
  category: PrinterNotificationCategory;
  priority: PrinterNotificationPriority;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
  meta?: Record<string, unknown>;
};

type ListResponse = {
  notifications: PrinterNotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
};

type NotificationsState = {
  notifications: PrinterNotificationItem[];
  unreadCount: number;
  loading: boolean;
  loadingMore: boolean;
  nextCursor: string | null;
  refresh: (opts?: {
    status?: "all" | "unread";
    category?: PrinterNotificationCategory | "all";
    priority?: PrinterNotificationPriority | "all";
    q?: string;
  }) => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (id: string, read: boolean) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationsStoreContext = createContext<NotificationsState | null>(null);

const startSse = async ({
  endpoint,
  onEvent,
  signal,
}: {
  endpoint: string;
  onEvent: (event: string, data: any) => void;
  signal: AbortSignal;
}) => {
  const token = getToken();
  const res = await fetch(`${getApiBaseUrl()}${endpoint}`, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });

  if (!res.ok || !res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleChunk = (text: string) => {
    buffer += text;
    while (true) {
      const idx = buffer.indexOf("\n\n");
      if (idx === -1) break;
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const lines = raw.split("\n");
      let event = "message";
      let dataStr = "";
      for (const l of lines) {
        if (l.startsWith("event:")) event = l.slice(6).trim();
        if (l.startsWith("data:")) dataStr += l.slice(5).trim();
      }
      if (!dataStr) continue;
      try {
        const data = JSON.parse(dataStr);
        onEvent(event, data);
      } catch {
        onEvent(event, dataStr);
      }
    }
  };

  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    handleChunk(decoder.decode(value, { stream: true }));
  }
};

export const NotificationsStoreProvider = ({ children }: { children: any }) => {
  const [records, setRecords] = useState<Record<string, PrinterNotificationItem>>({});
  const [ids, setIds] = useState<string[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastQuery, setLastQuery] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);

  const upsertMany = useCallback((rows: PrinterNotificationItem[]) => {
    setRecords((prev) => {
      const next = { ...prev };
      for (const r of rows) next[r.id] = { ...next[r.id], ...r };
      return next;
    });
  }, []);

  const refresh = useCallback(
    async (opts?: {
      status?: "all" | "unread";
      category?: PrinterNotificationCategory | "all";
      priority?: PrinterNotificationPriority | "all";
      q?: string;
    }) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (opts?.status && opts.status !== "all") qs.set("status", opts.status);
        if (opts?.category && opts.category !== "all") qs.set("category", opts.category);
        if (opts?.priority && opts.priority !== "all") qs.set("priority", opts.priority);
        if (opts?.q) qs.set("q", opts.q);

        setLastQuery(Object.fromEntries(qs.entries()));

        const res = (await apiFetch(`/printer/notifications?${qs.toString()}`)) as ListResponse;
        const rows = Array.isArray(res.notifications) ? res.notifications : [];
        upsertMany(rows);
        setIds(rows.map((n) => n.id));
        setUnreadCount(typeof res.unreadCount === "number" ? res.unreadCount : 0);
        setNextCursor(res.nextCursor || null);
      } finally {
        setLoading(false);
      }
    },
    [upsertMany],
  );

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(lastQuery)) {
        if (v) qs.set(k, v);
      }
      qs.set("cursor", nextCursor);
      const res = (await apiFetch(`/printer/notifications?${qs.toString()}`)) as ListResponse;
      const rows = Array.isArray(res.notifications) ? res.notifications : [];
      upsertMany(rows);
      setIds((prev) => [...prev, ...rows.map((n) => n.id)]);
      if (typeof res.unreadCount === "number") setUnreadCount(res.unreadCount);
      setNextCursor(res.nextCursor || null);
    } finally {
      setLoadingMore(false);
    }
  }, [lastQuery, nextCursor, upsertMany]);

  const markRead = useCallback(
    async (id: string, read: boolean) => {
      const prev = records[id];
      setRecords((p) => ({
        ...p,
        [id]: { ...(p[id] || prev), readAt: read ? new Date().toISOString() : null },
      }));
      setUnreadCount((c) => {
        const wasRead = Boolean(prev?.readAt);
        if (read && !wasRead) return Math.max(0, c - 1);
        if (!read && wasRead) return c + 1;
        return c;
      });
      try {
        await apiFetch(`/printer/notifications/${encodeURIComponent(id)}/read`, {
          method: "PATCH",
          body: JSON.stringify({ read }),
        });
      } catch {
        refresh({ status: "unread" }).catch(() => {});
      }
    },
    [records, refresh],
  );

  const markAllRead = useCallback(async () => {
    await apiFetch(`/printer/notifications/mark-all-read`, { method: "POST" });
    refresh({ status: "all" }).catch(() => {});
  }, [refresh]);

  const notifications = useMemo(
    () =>
      ids
        .map((id) => records[id])
        .filter(Boolean)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [ids, records],
  );

  useEffect(() => {
    refresh({ status: "unread" }).catch(() => {});

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    startSse({
      endpoint: "/printer/notifications/stream",
      signal: abort.signal,
      onEvent: (event, data) => {
        if (event === "notification.created" && data && data.id) {
          const n: PrinterNotificationItem = {
            id: String(data.id),
            category: data.category,
            priority: data.priority,
            title: data.title,
            message: data.message,
            readAt: data.readAt || null,
            createdAt: new Date(data.createdAt || Date.now()).toISOString(),
          };
          upsertMany([n]);
          setIds((prev) => [n.id, ...prev.filter((x) => x !== n.id)]);
          setUnreadCount((c) => c + (n.readAt ? 0 : 1));
          return;
        }
        if (event === "notification.updated" && data && data.id) {
          const id = String(data.id);
          const readAt = data.readAt || null;
          setRecords((prev) => ({ ...prev, [id]: { ...(prev[id] as any), readAt } }));
          refresh({ status: "unread" }).catch(() => {});
          return;
        }
        if (event === "notification.bulk_read" || event === "notification.email_failed") {
          refresh({ status: "unread" }).catch(() => {});
        }
        // Capacity-driven availability change pushed by the server — re-broadcast
        // as a window event so the AvailabilityStatusBadge updates without a refresh.
        if (event === "availability.changed" && data) {
          window.dispatchEvent(new CustomEvent("st:availability_changed", { detail: data }));
        }
      },
    }).catch(() => {});

    return () => {
      abort.abort();
    };
  }, [refresh, upsertMany]);

  const value: NotificationsState = {
    notifications,
    unreadCount,
    loading,
    loadingMore,
    nextCursor,
    refresh,
    loadMore,
    markRead,
    markAllRead,
  };

  return (
    <NotificationsStoreContext.Provider value={value}>
      {children}
    </NotificationsStoreContext.Provider>
  );
};

export const useNotificationsStore = () => {
  const ctx = useContext(NotificationsStoreContext);
  if (!ctx) throw new Error("useNotificationsStore must be used within NotificationsStoreProvider");
  return ctx;
};
