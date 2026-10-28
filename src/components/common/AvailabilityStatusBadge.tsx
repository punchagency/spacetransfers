import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useProfileStore, type AvailabilityStatus } from "../../state/ProfileStore";
import { apiFetch } from "../../utils/api";
import { fetchAvailability } from "../../utils/availability";

/* ── Keyframe animations injected once ─────────────────────────────────── */
const STYLE_ID = "availability-badge-styles";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    @keyframes avail-glow {
      0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,.5); opacity: 1; }
      50%       { box-shadow: 0 0 0 5px rgba(34,197,94,0); opacity: .75; }
    }
    @keyframes avail-breathe {
      0%, 100% { transform: scale(1);    opacity: 1; }
      50%       { transform: scale(.7);  opacity: .45; }
    }
    @keyframes avail-dropdown {
      from { opacity: 0; transform: translateY(-8px) scale(.97); }
      to   { opacity: 1; transform: translateY(0)    scale(1);   }
    }
    .avail-dot-open    { animation: avail-glow    2s ease-in-out infinite; }
    .avail-dot-paused  { animation: avail-breathe 2.4s ease-in-out infinite; }
    .avail-dropdown    { animation: avail-dropdown .18s cubic-bezier(.16,1,.3,1) forwards; }
  `;
  document.head.appendChild(el);
}

/* ── Config ─────────────────────────────────────────────────────────────── */
type Cfg = { label: string; pill: string; pillHover: string; dotBg: string; dotClass: string; check: string };

const STATUS_CONFIG: Record<AvailabilityStatus, Cfg> = {
  open: {
    label:     "Open",
    pill:      "bg-green-50  text-green-700  border-green-200  shadow-green-100",
    pillHover: "hover:bg-green-100 hover:border-green-300",
    dotBg:     "bg-green-500",
    dotClass:  "avail-dot-open",
    check:     "text-green-600",
  },
  paused: {
    label:     "Paused",
    pill:      "bg-amber-50  text-amber-700  border-amber-200  shadow-amber-100",
    pillHover: "hover:bg-amber-100 hover:border-amber-300",
    dotBg:     "bg-amber-400",
    dotClass:  "avail-dot-paused",
    check:     "text-amber-600",
  },
};

const OPTIONS: { value: AvailabilityStatus; label: string; description: string }[] = [
  { value: "open",   label: "Open",   description: "Accepting auto-assigned orders" },
  { value: "paused", label: "Paused", description: "Not accepting new orders" },
];

/* ── Component ──────────────────────────────────────────────────────────── */
export const AvailabilityStatusBadge = () => {
  const { availabilityStatus, setAvailabilityStatus } = useProfileStore();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [capacityLocked, setCapacityLocked] = useState(false);
  const [capacityPaused, setCapacityPaused] = useState(false);
  const [maxJobs, setMaxJobs] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Shared with the sidebar's capacity meter — see `fetchAvailability`.
    fetchAvailability()
      .then((r: any) => {
        if (r?.availabilityStatus) setAvailabilityStatus(r.availabilityStatus as AvailabilityStatus);
        setCapacityLocked(Boolean(r?.capacityLocked));
        setCapacityPaused(Boolean(r?.capacityPaused));
        setMaxJobs(typeof r?.maxJobs === "number" ? r.maxJobs : null);
      })
      .catch(() => {});
  }, []);

  // Live capacity-driven status changes pushed from the server (auto-pause when
  // the max job limit is hit, auto-reopen when it clears) — no refresh needed.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.availabilityStatus) setAvailabilityStatus(detail.availabilityStatus as AvailabilityStatus);
      setCapacityLocked(Boolean(detail.capacityLocked));
      setCapacityPaused(Boolean(detail.capacityPaused));
      if (typeof detail.maxJobs === "number") setMaxJobs(detail.maxJobs);
      if (detail.reason === "capacity_reached") {
        toast(`Maximum job capacity reached — status set to Paused.`, { icon: "⏸️" });
      } else if (detail.reason === "capacity_recovered") {
        toast.success("You're available again — status set back to Open.");
      } else if (detail.reason === "admin_changed") {
        const who = typeof detail.changedBy === "string" && detail.changedBy ? detail.changedBy : "An administrator";
        if (detail.availabilityStatus === "paused") {
          toast(`${who} set your availability to Paused.`, { icon: "⏸️" });
        } else {
          toast.success(`${who} set your availability back to Open.`);
        }
      }
    };
    window.addEventListener("st:availability_changed", handler);
    return () => window.removeEventListener("st:availability_changed", handler);
  }, [setAvailabilityStatus]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && e.target instanceof Node && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const select = async (status: AvailabilityStatus) => {
    if (status === availabilityStatus || saving) return;
    // Blocked from re-opening while at max capacity — recovery is automatic.
    if (status === "open" && capacityLocked) {
      setOpen(false);
      toast.error(
        maxJobs != null
          ? `You're at your maximum of ${maxJobs} active ${maxJobs === 1 ? "job" : "jobs"}. You'll reopen automatically once your load drops.`
          : "You're at maximum capacity. You'll reopen automatically once your load drops.",
      );
      return;
    }
    setOpen(false);
    setSaving(true);
    const previous = availabilityStatus;
    setAvailabilityStatus(status);
    try {
      const res: any = await apiFetch("/printer/availability", {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setCapacityLocked(Boolean(res?.capacityLocked));
      setCapacityPaused(Boolean(res?.capacityPaused));
      toast.success(`Status set to ${STATUS_CONFIG[status].label}`);
    } catch (err: any) {
      setAvailabilityStatus(previous);
      toast.error(err?.message || "Failed to update status");
      // Re-sync from the server (authoritative) — e.g. an Open switch rejected
      // with 409 because the partner is at capacity.
      fetchAvailability()
        .then((r: any) => {
          if (r?.availabilityStatus) setAvailabilityStatus(r.availabilityStatus as AvailabilityStatus);
          setCapacityLocked(Boolean(r?.capacityLocked));
          setCapacityPaused(Boolean(r?.capacityPaused));
          if (typeof r?.maxJobs === "number") setMaxJobs(r.maxJobs);
        })
        .catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  const cfg = STATUS_CONFIG[availabilityStatus] ?? STATUS_CONFIG.open;

  return (
    <div className="relative" ref={wrapperRef}>
      {/* ── Pill trigger ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        aria-label={`Availability: ${cfg.label}`}
        className={[
          "flex items-center gap-1.5 px-2.5 h-8 max-md:h-10 max-md:px-3 rounded-full border text-xs font-semibold shadow-sm",
          "transition-all duration-300 ease-out",
          "hover:scale-[1.04] active:scale-[.97]",
          "focus:outline-none focus:ring-2 focus:ring-offset-1",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          cfg.pill,
          cfg.pillHover,
        ].join(" ")}
      >
        {/* animated dot */}
        <span
          className={["w-3 h-3 rounded-full flex-shrink-0 transition-colors duration-500", cfg.dotBg, cfg.dotClass].join(" ")}
        />
        {/* label */}
        <span className="transition-colors duration-300">{cfg.label}</span>
        {/* capacity lock indicator */}
        {capacityLocked && (
          <svg className="w-3 h-3 opacity-70 flex-shrink-0" viewBox="0 0 16 16" fill="none" aria-label="Locked at maximum capacity">
            <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        )}
        {/* chevron */}
        <svg
          className={["w-3 h-3 opacity-60 transition-transform duration-200", open ? "rotate-180" : ""].join(" ")}
          viewBox="0 0 12 12" fill="none"
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* ── Animated dropdown ── */}
      {open && (
        <div className="avail-dropdown absolute right-0 mt-2 w-60 rounded-2xl border border-gray-200 bg-white shadow-2xl z-50 overflow-hidden origin-top-right
          max-md:fixed max-md:inset-x-2 max-md:top-[calc(env(safe-area-inset-top,0px)+60px)] max-md:mt-0 max-md:w-auto">
          <div className="px-4 py-2.5 border-b border-gray-100">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Availability</span>
          </div>

          <div className="p-1.5 space-y-0.5">
            {OPTIONS.map((opt) => {
              const oc = STATUS_CONFIG[opt.value];
              const active = opt.value === availabilityStatus;
              // While capacity-locked, the partner may not switch back to Open —
              // recovery happens automatically once their load drops.
              const disabled = opt.value === "open" && capacityLocked && !active;
              return (
                <button
                  key={opt.value}
                  onClick={() => void select(opt.value)}
                  disabled={disabled}
                  className={[
                    "w-full flex items-center gap-3 px-3 py-2.5 max-md:py-3.5 rounded-xl text-left",
                    "transition-all duration-150",
                    disabled ? "opacity-50 cursor-not-allowed" : "hover:scale-[1.01]",
                    active
                      ? "bg-gray-50 ring-1 ring-gray-200"
                      : disabled ? "" : "hover:bg-gray-50/80",
                  ].join(" ")}
                >
                  {/* dot with per-status animation */}
                  <span className={["w-2.5 h-2.5 rounded-full flex-shrink-0 mt-px transition-colors duration-500", oc.dotBg, oc.dotClass].join(" ")} />

                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold leading-tight transition-colors duration-300 ${oc.check}`}>
                      {opt.label}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5 leading-tight">
                      {disabled ? "Locked — at maximum job capacity" : opt.description}
                    </div>
                  </div>

                  {active && (
                    <svg className={["w-4 h-4 flex-shrink-0", oc.check].join(" ")} viewBox="0 0 16 16" fill="none">
                      <path d="M3 8l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>

          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50/50">
            {capacityPaused ? (
              <p className="text-[10px] text-amber-600 leading-relaxed font-medium">
                Paused automatically — you've reached your maximum active job limit
                {maxJobs != null ? ` (${maxJobs})` : ""}. You'll switch back to Open automatically
                once your active job count drops below the limit.
              </p>
            ) : capacityLocked ? (
              /*
               * At the limit, but this pause was not the monitor's doing — so
               * there is no automatic reopen coming, and saying there was one
               * would have someone waiting for it.
               */
              <p className="text-[10px] text-amber-600 leading-relaxed font-medium">
                You're at your maximum active job limit{maxJobs != null ? ` (${maxJobs})` : ""}, so
                you can't switch back to Open until one of your active jobs finishes.
              </p>
            ) : (
              <p className="text-[10px] text-gray-500 leading-relaxed">
                Paused removes you from auto-assignment. Existing jobs are unaffected.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
