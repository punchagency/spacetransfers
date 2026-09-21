import { useEffect, useMemo, useRef, useState } from "react";
import { AiOutlineSearch } from 'react-icons/ai';
import { GoBell } from "react-icons/go";
import { useNavigate } from "react-router-dom";
import { UserMenu } from "../common/UserMenu";
import { useNotificationsStore, type AdminNotificationCategory, type AdminNotificationPriority } from "../../state/NotificationsStore";

export const Topbar = () => {
  const {
    notifications,
    unreadCount,
    loading,
    loadingMore,
    nextCursor,
    refresh,
    loadMore,
    markRead,
    markAllRead,
  } = useNotificationsStore();

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<AdminNotificationCategory | "all">("all");
  const [priority, setPriority] = useState<AdminNotificationPriority | "all">("all");
  const [unreadOnly, setUnreadOnly] = useState(true);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  /**
   * Where a notification points, or null if it points nowhere.
   *
   * `meta` is populated at every call site on the server (orderId for order
   * events, partnerId for partner ones), so most notifications can take the
   * admin straight to the thing they are about instead of leaving them to go
   * and find it.
   */
  const targetFor = (n: { meta?: Record<string, any> | null }): string | null => {
    const meta = n.meta || {};
    if (meta.orderId) return `/dashboard/orders/${meta.orderId}`;
    if (meta.partnerId) return `/dashboard/fulfilment-partners/${meta.partnerId}`;
    return null;
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!open) return;
      const el = wrapperRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      refresh({
        status: unreadOnly ? "unread" : "all",
        category,
        priority,
        q: q.trim() || undefined,
      }).catch(() => {});
    }, 250);
    return () => window.clearTimeout(id);
  }, [open, unreadOnly, category, priority, q, refresh]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return notifications.filter((n) => {
      if (unreadOnly && n.readAt) return false;
      if (category !== "all" && n.category !== category) return false;
      if (priority !== "all" && n.priority !== priority) return false;
      if (!query) return true;
      return (
        n.title.toLowerCase().includes(query) || n.message.toLowerCase().includes(query)
      );
    });
  }, [notifications, q, unreadOnly, category, priority]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  };

  const priorityDot = (p: AdminNotificationPriority) => {
    if (p === "high") return "bg-red-500";
    if (p === "medium") return "bg-amber-500";
    return "bg-gray-400";
  };

  const categoryLabel = (c: AdminNotificationCategory) => {
    if (c === "orders") return "Orders";
    if (c === "partners") return "Partners";
    return "System";
  };

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
      {/* Left slot intentionally empty. A global search box lived here with no
          value, onChange or state — it was decoration. There is no cross-entity
          search endpoint to wire it to, so it was removed rather than left
          promising something it could not do. */}
      <div />

      <div className="flex items-center gap-6">
        <div className="relative" ref={wrapperRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/10"
            aria-label="Notifications"
          >
            <GoBell className="w-5 h-5 text-gray-600" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-600 rounded-full border border-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>

          {open && (
            <div className="absolute right-0 mt-3 w-[420px] max-w-[calc(100vw-24px)] rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div className="font-semibold text-gray-900">Notifications</div>
                <button
                  onClick={() => void markAllRead()}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-60"
                  disabled={unreadCount === 0}
                >
                  Mark all read
                </button>
              </div>

              <div className="p-4 space-y-3 border-b border-gray-100">
                <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2">
                  <AiOutlineSearch className="w-4 h-4 text-gray-400" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="w-full text-sm outline-none"
                    placeholder="Search by title or message"
                  />
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {(["all", "orders", "partners", "system"] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => setCategory(c)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-full border ${
                        category === c ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {c === "all" ? "All" : c === "orders" ? "Orders" : c === "partners" ? "Partners" : "System"}
                    </button>
                  ))}
                  <button
                    onClick={() => setUnreadOnly((v) => !v)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-full border ${
                      unreadOnly ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    Unread
                  </button>
                  {(["all", "high", "medium", "low"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPriority(p)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-full border ${
                        priority === p ? "bg-gray-50 text-gray-900 border-gray-300" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {p === "all" ? "Any priority" : p.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="max-h-[420px] overflow-y-auto">
                {loading ? (
                  <div className="p-6 text-sm text-gray-500">Loading…</div>
                ) : filtered.length === 0 ? (
                  <div className="p-6 text-sm text-gray-500">No notifications</div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {filtered.map((n) => {
                      const target = targetFor(n);
                      return (
                      <div
                        key={n.id}
                        onClick={target ? () => { setOpen(false); navigate(target); } : undefined}
                        role={target ? "link" : undefined}
                        tabIndex={target ? 0 : undefined}
                        onKeyDown={target ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setOpen(false);
                            navigate(target);
                          }
                        } : undefined}
                        className={`p-4 hover:bg-gray-50 ${target ? "cursor-pointer focus:outline-none focus:bg-gray-50" : ""}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`mt-1.5 w-2 h-2 rounded-full ${priorityDot(n.priority)}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-semibold text-sm text-gray-900 truncate">{n.title}</div>
                              <div className="text-[11px] text-gray-400 whitespace-nowrap">{formatTime(n.createdAt)}</div>
                            </div>
                            <div className="mt-1 text-xs text-gray-600">{n.message}</div>
                            <div className="mt-2 flex items-center justify-between">
                              <div className="text-[11px] font-semibold text-gray-500">
                                {categoryLabel(n.category)} • {n.priority.toUpperCase()}
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); void markRead(n.id, !n.readAt); }}
                                className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                              >
                                {n.readAt ? "Mark unread" : "Mark read"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {nextCursor && (
                <div className="p-3 border-t border-gray-100">
                  <button
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="w-full rounded-lg border border-gray-200 bg-white py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <UserMenu />
      </div>
    </header>
  );
};
