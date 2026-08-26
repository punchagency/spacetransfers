import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl } from "../utils/api";
import { getToken } from "../utils/auth";
import { apiFetch } from "../utils/api";

export type AdminNotificationCategory = "orders" | "partners" | "system";
export type AdminNotificationPriority = "high" | "medium" | "low";

export type AdminNotificationItem = {
  id: string;
  category: AdminNotificationCategory;
  priority: AdminNotificationPriority;
  title: string;
  message: string;
  /** Context for the thing the notification is about — e.g. `{ orderId, partnerId }`. */
  meta?: Record<string, any> | null;
  readAt: string | null;
  createdAt: string;
};

type ListResponse = {
  notifications: AdminNotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
};

type NotificationsState = {
  notifications: AdminNotificationItem[];
  unreadCount: number;
  loading: boolean;
  loadingMore: boolean;
  nextCursor: string | null;
  refresh: (opts?: { status?: "all" | "unread"; category?: AdminNotificationCategory | "all"; priority?: AdminNotificationPriority | "all"; q?: string }) => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (id: string, read: boolean) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationsStoreContext = createContext<NotificationsState | null>(null);

/**
 * Was hard-coded to `http://localhost:4000/api`, so notifications could only
 * stream on a developer's machine. Same defect as the order-detail stream had.
 */
const API_BASE_URL = getApiBaseUrl();

const startSse = async ({
  endpoint,
  onEvent,
  signal,
  onOpen,
}: {
  endpoint: string;
  onEvent: (event: string, data: any) => void;
  signal: AbortSignal;
  onOpen?: () => void;
}) => {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal,
  });

  if (!res.ok || !res.body) return;
  onOpen?.();

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
  const [records, setRecords] = useState<Record<string, AdminNotificationItem>>({});
  const [ids, setIds] = useState<string[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastQuery, setLastQuery] = useState<{ status?: string; category?: string; priority?: string; q?: string }>({});
  const abortRef = useRef<AbortController | null>(null);

  const upsertMany = useCallback((rows: AdminNotificationItem[]) => {
    setRecords((prev) => {
      const next = { ...prev };
      for (const r of rows) next[r.id] = { ...next[r.id], ...r };
      return next;
    });
  }, []);

  const refresh = useCallback(
    async (opts?: { status?: "all" | "unread"; category?: AdminNotificationCategory | "all"; priority?: AdminNotificationPriority | "all"; q?: string }) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (opts?.status && opts.status !== "all") qs.set("status", opts.status);
        if (opts?.category && opts.category !== "all") qs.set("category", opts.category);
        if (opts?.priority && opts.priority !== "all") qs.set("priority", opts.priority);
        if (opts?.q) qs.set("q", opts.q);

        const query = Object.fromEntries(qs.entries());
        setLastQuery(query);

        const res = (await apiFetch(`/admin/notifications?${qs.toString()}`)) as ListResponse;
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
      const res = (await apiFetch(`/admin/notifications?${qs.toString()}`)) as ListResponse;
      const rows = Array.isArray(res.notifications) ? res.notifications : [];
      upsertMany(rows);
      setIds((prev) => [...prev, ...rows.map((n) => n.id)]);
      if (typeof res.unreadCount === "number") setUnreadCount(res.unreadCount);
      setNextCursor(res.nextCursor || null);
    } finally {
      setLoadingMore(false);
    }
  }, [lastQuery, nextCursor, upsertMany]);

  const markRead = useCallback(async (id: string, read: boolean) => {
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
      await apiFetch(`/admin/notifications/${encodeURIComponent(id)}/read`, {
        method: "PATCH",
        body: JSON.stringify({ read }),
      });
    } catch {
      refresh({ status: "unread" }).catch(() => {});
    }
  }, [records, refresh]);

  const markAllRead = useCallback(async () => {
    await apiFetch(`/admin/notifications/mark-all-read`, { method: "POST" });
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

    /**
     * Reconnect loop.
     *
     * `startSse` returns whenever the stream ends — a server restart, a proxy
     * idle timeout, a laptop waking from sleep. Without this the bell simply
     * stopped updating until someone reloaded the page, and nothing said so.
     *
     * Backoff caps at 30s so a server that is down does not get hammered, and
     * resets on a clean connect so a brief blip recovers immediately.
     */
    let attempt = 0;
    const connect = async () => {
      while (!abort.signal.aborted) {
        try {
          await startSse({
            endpoint: "/admin/notifications/stream",
            signal: abort.signal,
            onEvent: handleEvent,
            onOpen: () => {
              attempt = 0;
              // Catch up on anything missed while disconnected.
              refresh({ status: "unread" }).catch(() => {});
            },
          });
        } catch {
          // fall through to the backoff below
        }
        if (abort.signal.aborted) return;
        attempt += 1;
        const delay = Math.min(30000, 1000 * 2 ** (attempt - 1));
        await new Promise((r) => setTimeout(r, delay));
      }
    };

    const handleEvent = (event: string, data: any) => {
      {
        if (event === "notification.created" && data && data.id) {
          const n: AdminNotificationItem = {
            id: String(data.id),
            category: data.category,
            priority: data.priority,
            title: data.title,
            message: data.message,
            meta: data.meta ?? null,
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
        if (event === "notification.bulk_read") {
          refresh({ status: "unread" }).catch(() => {});
        }
        if (event === "notification.email_failed") {
          refresh({ status: "unread" }).catch(() => {});
        }
      }
    };

    connect();

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

  return <NotificationsStoreContext.Provider value={value}>{children}</NotificationsStoreContext.Provider>;
};

export const useNotificationsStore = () => {
  const ctx = useContext(NotificationsStoreContext);
  if (!ctx) throw new Error("useNotificationsStore must be used within NotificationsStoreProvider");
  return ctx;
};
