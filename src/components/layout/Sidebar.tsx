import { useEffect, useState } from "react";
import { MdClose } from "react-icons/md";
import { useNavigate, useLocation } from "react-router-dom";
import {
  AiOutlineDollar,
  AiOutlineUser,
  AiOutlineSetting,
} from "react-icons/ai";
import { FiHome } from "react-icons/fi";
import { fetchAvailability } from "../../utils/availability";
const nav = [
  { label: "Home", icon: FiHome, path: "/dashboard" },
  { label: "Jobs & Orders", iconSrc: "/menu.svg", path: "/orders" },
  // { label: "Print Queue", icon: LuPrinter, path: "/print-queue" },
  { label: "Earnings & Payouts", icon: AiOutlineDollar, path: "/earnings" },
];

const bottomNav = [
  { label: "Profile", icon: AiOutlineUser, path: "/profile" },
  { label: "Settings", icon: AiOutlineSetting, path: "/settings" },
];

/**
 * How much work the partner is currently carrying.
 *
 * Replaces an avatar and a name that sat directly beneath nav items already
 * labelled Profile and Settings, and repeated what the top bar shows. This is
 * the number that decides whether more work reaches them: at the limit the
 * capacity monitor pauses them, and auto-assignment skips them until a job
 * finishes. It was visible nowhere in this app.
 *
 * No new endpoint — `GET /printer/availability` already returns both figures,
 * and it self-heals the capacity state on read. The same `st:availability_changed`
 * event the status pill listens to keeps this in step, so pausing in another
 * tab, an admin change, or hitting the limit all land here without a refresh.
 */
const CapacityFooter = () => {
  const [activeJobs, setActiveJobs] = useState<number | null>(null);
  const [maxJobs, setMaxJobs] = useState<number | null>(null);
  const [status, setStatus] = useState<"open" | "paused">("open");
  const [capacityPaused, setCapacityPaused] = useState(false);

  const apply = (r: any) => {
    if (!r) return;
    if (typeof r.activeJobs === "number") setActiveJobs(r.activeJobs);
    setMaxJobs(typeof r.maxJobs === "number" ? r.maxJobs : null);
    if (r.availabilityStatus === "paused" || r.availabilityStatus === "open") setStatus(r.availabilityStatus);
    setCapacityPaused(Boolean(r.capacityPaused));
  };

  useEffect(() => {
    // Shared with the status pill: the endpoint reconciles capacity on read and
    // can notify, so it must not be called twice for one page load.
    void fetchAvailability().then(apply);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => apply((e as CustomEvent).detail || {});
    window.addEventListener("st:availability_changed", handler);
    return () => window.removeEventListener("st:availability_changed", handler);
  }, []);

  // Nothing is claimed until the first read lands — an empty bar reading "0"
  // would say they are idle when it only means the request has not returned.
  if (activeJobs === null) {
    return (
      <div className="mt-auto px-4 py-4 border-t border-gray-100">
        <div className="h-2 rounded-full bg-gray-100 animate-pulse" />
      </div>
    );
  }

  const atCapacity = maxJobs != null && activeJobs >= maxJobs;
  const pct = maxJobs && maxJobs > 0 ? Math.min(100, Math.round((activeJobs / maxJobs) * 100)) : 0;

  return (
    <div className="mt-auto px-4 py-4 border-t border-gray-100">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Active jobs</span>
        <span className={`text-sm font-bold ${atCapacity ? "text-amber-600" : "text-gray-900"}`}>
          {activeJobs}
          {maxJobs != null && <span className="text-gray-400 font-semibold"> / {maxJobs}</span>}
        </span>
      </div>

      {/* Only drawn when there is a limit to draw against. */}
      {maxJobs != null && (
        <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${atCapacity ? "bg-amber-500" : "bg-blue-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <p className="mt-2 text-[11px] text-gray-400 leading-snug">
        {status === "paused"
          ? capacityPaused
            ? "At capacity — you'll reopen automatically once a job finishes"
            : "Paused — not receiving new auto-assigned jobs"
          : atCapacity
            ? "At your limit — no new jobs will be auto-assigned"
            : "Accepting new jobs"}
      </p>
    </div>
  );
};

/**
 * The menu: a fixed column on a laptop, a drawer on a phone.
 *
 * It used to be the same 260px column at every width. On a 390px phone that is
 * two thirds of the screen, leaving 130px for the page itself — every table,
 * heading and button ran off the side. `open`/`onClose` are only read below
 * `md`, so the desktop layout is untouched.
 */
export const Sidebar = ({ open = false, onClose }: { open?: boolean; onClose?: () => void }) => {
  const navigate = useNavigate();
  const location = useLocation();

  /** Following a link on a phone closes the drawer; on desktop there is nothing to close. */
  const go = (path: string) => {
    navigate(path);
    onClose?.();
  };

  return (
    <aside
      className={`w-65 max-w-[85vw] bg-white border-r border-gray-200 h-full flex flex-col py-2
        max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:shadow-xl
        max-md:transition-transform max-md:duration-200 ${open ? "max-md:translate-x-0" : "max-md:-translate-x-full"}`}
      aria-hidden={undefined}
    >
      <div className="flex items-center justify-center gap-2 border-b border-gray-200 mb-6 relative">
        <span className="font-semibold text-lg">spacetransfers</span>
        <img src="/space.svg" alt="logo" className="w-15 h-15 -scale-x-100" />
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="md:hidden absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
        >
          <MdClose size={22} />
        </button>
      </div>

      <nav className="space-y-2 border-b mb-6 border-gray-200 px-3">
        {nav.map(({ label, icon: Icon, iconSrc, path }, index) => (
          <div
            key={label}
            onClick={() => go(path)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer text-sm
              ${
                location.pathname === path ||
                (path === "/orders" &&
                  (location.pathname.startsWith("/orders") ||
                    location.pathname.startsWith("/dashboard/orders"))) ||
                (path === "/fulfilment-partners" &&
                  location.pathname.startsWith(
                    "/dashboard/fulfilment-partners",
                  ))
                  ? "bg-blue-50 text-blue-600 border-l-4 border-blue-600"
                  : "text-gray-600 hover:bg-gray-50"
              }
              ${index === nav.length - 1 ? "mb-2" : ""}
            `}
          >
            {Icon ? (
              <Icon size={18} />
            ) : (
              <img src={iconSrc} alt={label} className="w-[18px] h-[18px]" />
            )}
            <span>{label}</span>
          </div>
        ))}
      </nav>

      <div className="space-y-2 px-3">
        {bottomNav.map(({ label, icon: Icon, path }) => (
          <div
            key={label}
            onClick={() => go(path)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm cursor-pointer
              ${
                location.pathname === path
                  ? "bg-blue-50 text-blue-600 border-l-4 border-blue-600"
                  : "text-gray-600 hover:bg-gray-50"
              }
            `}
          >
            <Icon size={18} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      <CapacityFooter />

    </aside>
  );
};
