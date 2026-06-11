import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiHome,
  FiSearch,
  FiX,
  FiDollarSign,
  FiSettings,
  FiUser,
  FiClock,
  FiToggleRight,
  FiBell,
  FiCreditCard,
  FiPrinter,
  FiPackage,
  FiList,
  FiArrowRight,
  FiFileText,
} from "react-icons/fi";
import { LuPrinter } from "react-icons/lu";
import { apiFetch } from "../../utils/api";

interface SearchItem {
  id: string;
  title: string;
  description: string;
  path: string;
  keywords: string[];
  icon: React.ReactNode;
  section: string;
  hash?: string;
  isLive?: boolean;
}

const ITEMS: SearchItem[] = [
  // ── Main Pages ──────────────────────────────────────────
  {
    id: "home",
    title: "Home",
    description: "Dashboard overview — stats, activity, quick actions",
    path: "/dashboard",
    keywords: ["home", "dashboard", "overview", "stats", "summary", "welcome"],
    icon: <FiHome className="w-4 h-4" />,
    section: "Pages",
  },
  {
    id: "jobs",
    title: "Jobs & Orders",
    description: "View and manage all your assigned jobs",
    path: "/orders",
    keywords: ["jobs", "orders", "assignments", "work", "list", "all jobs"],
    icon: <FiPackage className="w-4 h-4" />,
    section: "Pages",
  },
  {
    id: "print-queue",
    title: "Print Queue",
    description: "Manage your active printing queue and job statuses",
    path: "/print-queue",
    keywords: ["print queue", "queue", "printing", "active jobs", "in progress", "printer"],
    icon: <LuPrinter className="w-4 h-4" />,
    section: "Pages",
  },
  {
    id: "earnings",
    title: "Earnings & Payouts",
    description: "Track your earnings, payout history and available balance",
    path: "/earnings",
    keywords: ["earnings", "payouts", "money", "revenue", "income", "balance", "paid", "pending", "transfer"],
    icon: <FiDollarSign className="w-4 h-4" />,
    section: "Pages",
  },
  {
    id: "profile",
    title: "Profile",
    description: "Update your personal and business profile information",
    path: "/profile",
    keywords: ["profile", "account", "personal", "business", "name", "photo", "avatar", "bio", "edit profile"],
    icon: <FiUser className="w-4 h-4" />,
    section: "Pages",
  },
  {
    id: "settings",
    title: "Settings",
    description: "Configure all your printer settings",
    path: "/settings",
    keywords: ["settings", "configure", "preferences", "options", "config"],
    icon: <FiSettings className="w-4 h-4" />,
    section: "Pages",
  },

  // ── Settings Sections ─────────────────────────────────
  {
    id: "settings-business-hours",
    title: "Business Hours",
    description: "Set the days and hours you are available to accept jobs",
    path: "/settings",
    hash: "#business-hours",
    keywords: ["business hours", "availability", "schedule", "open", "closed", "hours", "days", "time", "working hours"],
    icon: <FiClock className="w-4 h-4" />,
    section: "Settings",
  },
  {
    id: "settings-job-capacity",
    title: "Job Capacity & Auto-Accept",
    description: "Control automatic job assignment and daily workload limits",
    path: "/settings",
    hash: "#job-capacity",
    keywords: ["auto accept", "job capacity", "auto assign", "limit", "max jobs", "workload", "automatic"],
    icon: <FiToggleRight className="w-4 h-4" />,
    section: "Settings",
  },
  {
    id: "settings-notifications",
    title: "Notifications",
    description: "Manage email and SMS notification preferences",
    path: "/settings",
    hash: "#notifications",
    keywords: ["notifications", "alerts", "email", "sms", "notify", "push", "reminders"],
    icon: <FiBell className="w-4 h-4" />,
    section: "Settings",
  },
  {
    id: "settings-payout",
    title: "Payout Settings",
    description: "Connect your Stripe account and manage bank transfer settings",
    path: "/settings",
    hash: "#payout-settings",
    keywords: ["payout settings", "stripe", "bank", "connect stripe", "bank transfer", "payment method"],
    icon: <FiCreditCard className="w-4 h-4" />,
    section: "Settings",
  },
  {
    id: "settings-printing",
    title: "Printing Capabilities",
    description: "Set your sheet sizes, inks, films and max resolution",
    path: "/settings",
    hash: "#printing-capabilities",
    keywords: ["printing capabilities", "sheet size", "ink", "film", "resolution", "dpi", "format", "capabilities"],
    icon: <FiPrinter className="w-4 h-4" />,
    section: "Settings",
  },

  // ── Quick Actions ──────────────────────────────────────
  {
    id: "action-view-pending",
    title: "View Pending Jobs",
    description: "See all jobs awaiting your action",
    path: "/orders?tab=Pending",
    keywords: ["pending jobs", "pending", "awaiting", "new jobs", "unread"],
    icon: <FiList className="w-4 h-4" />,
    section: "Quick Actions",
  },
  {
    id: "action-print-queue",
    title: "Go to Print Queue (Printing)",
    description: "Jump straight to your active printing jobs",
    path: "/print-queue?tab=Printing",
    keywords: ["go to print queue", "open print queue", "active printing", "printing tab"],
    icon: <LuPrinter className="w-4 h-4" />,
    section: "Quick Actions",
  },
  {
    id: "action-export-earnings",
    title: "Export Earnings Report",
    description: "Download a CSV of your payout history",
    path: "/earnings",
    keywords: ["export earnings", "download earnings", "csv", "report", "export"],
    icon: <FiDollarSign className="w-4 h-4" />,
    section: "Quick Actions",
  },
];

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-blue-100 text-blue-700 rounded px-0.5 font-semibold not-italic">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

const SECTION_ORDER = ["Jobs & Orders", "Pages", "Settings", "Quick Actions"];

interface Props {
  open: boolean;
  onClose: () => void;
}

export const PortalSearch = ({ open, onClose }: Props) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [liveJobs, setLiveJobs] = useState<SearchItem[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setLiveJobs([]);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Debounced live job search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setLiveJobs([]);
      return;
    }
    setLiveLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/printer/orders?q=${encodeURIComponent(q)}&limit=5`);
        const raw = Array.isArray(res?.orders) ? res.orders : [];
        const items: SearchItem[] = raw.map((o: any) => ({
          id: `live-job-${o.id || o.actualId}`,
          title: o.displayId ? `#${o.displayId}` : `#${o.id || o.actualId}`,
          description: `${o.customerName || "Customer"} · ${o.sheetSize || ""} · ${o.status || ""}`.replace(/ · $/, ""),
          path: `/orders/${o.id || o.actualId}`,
          keywords: [],
          icon: <FiFileText className="w-4 h-4" />,
          section: "Jobs & Orders",
          isLive: true,
        }));
        setLiveJobs(items);
      } catch {
        setLiveJobs([]);
      } finally {
        setLiveLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const staticResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ITEMS;
    return ITEMS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.toLowerCase().includes(q))
    );
  }, [query]);

  const results = useMemo(() => [...liveJobs, ...staticResults], [liveJobs, staticResults]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchItem[]>();
    for (const sec of SECTION_ORDER) map.set(sec, []);
    for (const item of results) {
      const list = map.get(item.section);
      if (list) list.push(item);
    }
    return [...map.entries()].filter(([, items]) => items.length > 0);
  }, [results]);

  // Flat list for keyboard navigation
  const flatResults = useMemo(() => results, [results]);

  const handleSelect = (item: SearchItem) => {
    navigate(item.path);
    onClose();
    // Scroll to hash section after navigation settles
    if (item.hash) {
      setTimeout(() => {
        const el = document.querySelector(item.hash!);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flatResults[activeIndex]) handleSelect(flatResults[activeIndex]);
    }
  };

  // Keep active item in view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector(`[data-index="${activeIndex}"]`);
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4">
      {/* Backdrop — clicking it closes the modal */}
      <div
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[70vh]">
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <FiSearch className="w-5 h-5 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search portal..."
            className="flex-1 bg-transparent outline-none text-base text-gray-900 placeholder-gray-400"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <FiX className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:flex items-center gap-1 px-2 py-1 text-[11px] font-mono text-gray-400 bg-gray-100 rounded-md border border-gray-200">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1" ref={listRef}>
          {liveLoading && query.trim().length >= 2 && (
            <div className="px-5 py-2 text-[11px] text-gray-400 border-b border-gray-50">
              Searching jobs…
            </div>
          )}
          {flatResults.length === 0 ? (
            <div className="py-12 text-center">
              <FiSearch className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-500">No results for "{query}"</p>
              <p className="text-xs text-gray-400 mt-1">Try searching for a page, setting, or action</p>
            </div>
          ) : (
            <div className="py-2">
              {grouped.map(([section, items]) => {
                return (
                  <div key={section}>
                    <div className="px-5 py-2 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                      {section}
                    </div>
                    {items.map((item) => {
                      const flatIdx = flatResults.indexOf(item);
                      const isActive = flatIdx === activeIndex;
                      return (
                        <button
                          key={item.id}
                          data-index={flatIdx}
                          onClick={() => handleSelect(item)}
                          onMouseEnter={() => setActiveIndex(flatIdx)}
                          className={`w-full flex items-center gap-4 px-5 py-3 text-left transition-colors ${
                            isActive ? "bg-blue-50" : "hover:bg-gray-50"
                          }`}
                        >
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              isActive ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {item.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-semibold ${isActive ? "text-blue-700" : "text-gray-900"}`}>
                              {highlight(item.title, query)}
                            </div>
                            <div className="text-xs text-gray-500 truncate mt-0.5">
                              {highlight(item.description, query)}
                            </div>
                          </div>
                          <FiArrowRight
                            className={`w-4 h-4 flex-shrink-0 transition-opacity ${
                              isActive ? "opacity-100 text-blue-500" : "opacity-0"
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-gray-100 bg-gray-50 flex items-center gap-4 text-[11px] text-gray-400">
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-[10px] font-mono">↑↓</kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-[10px] font-mono">↵</kbd>
            Select
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-[10px] font-mono">Esc</kbd>
            Close
          </span>
          <span className="ml-auto">{flatResults.length} result{flatResults.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>
  );
};
