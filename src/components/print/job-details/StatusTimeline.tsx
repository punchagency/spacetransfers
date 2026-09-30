import { FiBox, FiCheck, FiInbox, FiMapPin, FiPrinter, FiTruck, FiXCircle } from "react-icons/fi";
import type { PrintJob } from "../../../types/printQueue";

interface StatusTimelineProps {
  job: PrintJob;
  timeline?: { status: string; time: string; message?: string | null }[];
  /** The job's stored status — the source of truth for where it is. */
  backendStatus?: string;
  /** When the job was assigned to this partner. */
  assignedAt?: string | null;
}

/*
 * One step per real status, named as the rest of the app names them.
 *
 * This was six steps shifted one place from the statuses behind them: an
 * accepted-but-unstarted job lit "Printing", a job actually printing lit
 * "Curing" — a stage no order records and neither the admin nor the customer
 * ever sees — and the fallback read "In Progress - Printing" as not started.
 */
const STEPS = [
  { key: "RECEIVED", label: "Received", icon: FiInbox, statuses: ["PENDING", "PROCESSING"] },
  { key: "PRINTING", label: "Printing", icon: FiPrinter, statuses: ["PRINTING"] },
  { key: "LABEL", label: "Shipping Label", icon: FiBox, statuses: ["QUALITY_CHECK"] },
  { key: "SHIPPED", label: "Shipped", icon: FiTruck, statuses: ["SHIPPED"] },
  { key: "DELIVERED", label: "Delivered", icon: FiMapPin, statuses: ["COMPLETED"] },
] as const;

export const StatusTimeline = ({ job, timeline, backendStatus, assignedAt }: StatusTimelineProps) => {
  const entries = Array.isArray(timeline) ? timeline : [];
  const status = String(backendStatus || entries[entries.length - 1]?.status || "PROCESSING").toUpperCase();
  const cancelled = status === "CANCELLED";

  const formatTime = (d: Date) =>
    d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  /** When the job first reached a step, from its timeline. */
  const reachedAt = (idx: number): Date | null => {
    if (idx === 0) {
      const t = new Date(assignedAt || job.createdAt || "");
      return Number.isNaN(t.getTime()) ? null : t;
    }
    const wanted = STEPS[idx].statuses as readonly string[];
    for (const e of entries) {
      if (wanted.includes(String(e?.status || "").toUpperCase())) {
        const d = new Date(String(e?.time || ""));
        if (!Number.isNaN(d.getTime())) return d;
      }
    }
    return null;
  };

  const currentIdx = Math.max(
    0,
    STEPS.findIndex((s) => (s.statuses as readonly string[]).includes(status)),
  );
  const delivered = status === "COMPLETED";
  const progressPct = cancelled ? 0 : Math.round((currentIdx / (STEPS.length - 1)) * 100);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 font-bold text-gray-900 border-b border-gray-100">Production Timeline</div>

      <div className="p-4">
        {cancelled ? (
          <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            <FiXCircle className="h-4 w-4 shrink-0" /> This job was cancelled.
          </div>
        ) : (
          <div className="relative px-1">
            <div className="absolute left-5 right-5 top-5 h-1 rounded-full bg-gray-200" />
            <div
              className="absolute left-5 top-5 h-1 rounded-full bg-blue-600"
              style={{ width: `calc((100% - 2.5rem) * ${progressPct / 100})` }}
            />
            <ol className="relative z-10 flex items-start justify-between" aria-label="Production timeline">
              {STEPS.map((s, idx) => {
                const done = idx < currentIdx || (delivered && idx === currentIdx);
                const active = idx === currentIdx && !delivered;
                const Icon = done ? FiCheck : s.icon;
                const t = idx <= currentIdx ? reachedAt(idx) : null;
                return (
                  <li key={s.key} className="flex min-w-0 flex-1 flex-col items-center" aria-current={active ? "step" : undefined}>
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full border ${
                        done
                          ? "border-blue-600 bg-blue-600 text-white"
                          : active
                            ? "border-blue-600 bg-white text-blue-600 ring-4 ring-blue-50"
                            : "border-gray-200 bg-white text-gray-400"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="mt-2 text-center">
                      <div className={`text-xs font-semibold sm:text-sm ${idx <= currentIdx ? "text-gray-900" : "text-gray-400"}`}>
                        {s.label}
                      </div>
                      <div className="mt-0.5 text-[10px] text-gray-500 sm:text-xs">{t ? formatTime(t) : "—"}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
};
