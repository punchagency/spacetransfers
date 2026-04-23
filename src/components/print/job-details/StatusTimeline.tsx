import { FiBox, FiCheck, FiDroplet, FiPrinter } from "react-icons/fi";
import type { PrintJob } from "../../../types/printQueue";

interface StatusTimelineProps {
  job: PrintJob;
  timeline?: { status: string; time: string; message?: string | null }[];
}

export const StatusTimeline = ({ job, timeline }: StatusTimelineProps) => {
  const created = new Date(job.deadline);
  const createdAt = Number.isNaN(created.getTime()) ? null : created;

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const currentBackendStatus = (() => {
    const last = Array.isArray(timeline) && timeline.length ? timeline[timeline.length - 1] : null;
    const fromTimeline = String(last?.status || "").toUpperCase();
    if (fromTimeline) return fromTimeline;

    const label = String(job.status || "");
    if (label === "Pending Review") return "PENDING";
    if (label === "In Progress") return "PROCESSING";
    if (label === "Ready") return "QUALITY_CHECK";
    if (label === "Completed") return "COMPLETED";
    if (label === "Cancelled") return "CANCELLED";
    return "PENDING";
  })();

  const steps = [
    { key: "CREATED", label: "Created", icon: FiCheck, match: new Set(["PENDING"]) },
    { key: "PRINTING", label: "Printing", icon: FiPrinter, match: new Set(["PROCESSING"]) },
    { key: "CURING", label: "Curing", icon: FiDroplet, match: new Set(["PRINTING"]) },
    { key: "PACKED", label: "Packed", icon: FiBox, match: new Set(["QUALITY_CHECK", "SHIPPED", "COMPLETED"]) },
  ] as const;

  const currentStepIndex = (() => {
    if (currentBackendStatus === "CANCELLED") return 0;
    const idx = steps.findIndex((s) => s.match.has(currentBackendStatus as any));
    return idx >= 0 ? idx : 0;
  })();

  const stepTime = (idx: number) => {
    if (idx === 0) return createdAt;
    const match = steps[idx]?.match;
    if (!match) return null;
    const entries = Array.isArray(timeline) ? timeline : [];
    for (const t of entries) {
      if (match.has(String(t?.status || "").toUpperCase())) {
        const d = new Date(String(t?.time || ""));
        if (!Number.isNaN(d.getTime())) return d;
      }
    }
    return null;
  };

  const progressPct =
    steps.length <= 1 ? 0 : Math.round((currentStepIndex / (steps.length - 1)) * 100);
     
  const isOverallComplete = new Set(["SHIPPED", "COMPLETED"]).has(currentBackendStatus);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 font-bold text-gray-900 border-b border-gray-100">Production Timeline</div>

      <div className="p-4">
        <div className="relative px-1">
          <div className="absolute left-0 right-0 top-5 h-1 rounded-full bg-gray-200" />
          <div className="absolute left-0 top-5 h-1 rounded-full bg-blue-600" style={{ width: `${progressPct}%` }} />

          <ol className="relative z-10 flex items-start justify-between" aria-label="Production timeline">
            {steps.map((s, idx) => {
              const isCompleted =
                currentBackendStatus !== "CANCELLED" &&
                (idx < currentStepIndex || (isOverallComplete && idx === steps.length - 1 && idx === currentStepIndex));
              const isActive = idx === currentStepIndex && currentBackendStatus !== "CANCELLED";
              const Icon = isCompleted ? FiCheck : s.icon;
              const circleCls = isCompleted
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-white border-gray-200 text-gray-400";

              const t = stepTime(idx);
              const showCompletedPill = idx === steps.length - 1 && isOverallComplete;

              return (
                <li
                  key={s.key}
                  className="flex flex-col items-center min-w-0"
                  aria-current={isActive ? "step" : undefined}
                >
                  <div className={`w-11 h-11 rounded-full border flex items-center justify-center ${circleCls}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="mt-3 flex flex-col items-center justify-start">
                    <div className="text-sm font-semibold text-gray-900">{s.label}</div>
                    <div className="mt-1 text-xs text-gray-500">{t ? formatTime(t) : "—"}</div>
                    {showCompletedPill ? (
                      <div className="mt-2 px-3 py-1 rounded-full bg-green-50 text-green-700 border border-green-100 text-[11px] font-semibold">
                        Completed
                      </div>
                    ) : null} 
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
};
