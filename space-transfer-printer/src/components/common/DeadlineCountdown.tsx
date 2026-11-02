import { getDeadlineStatus, useNow } from "../../utils/datetime";

/**
 * Renders an assignment deadline as an absolute time plus a live-updating
 * countdown ("Mar 5, 2:30 PM · 23h left"), colouring it orange when due soon
 * and red once overdue. Ticks every minute via the shared clock.
 */
export const DeadlineCountdown = ({
  iso,
  className = "",
  showAbsolute = true,
}: {
  iso: string | null | undefined;
  className?: string;
  showAbsolute?: boolean;
}) => {
  const now = useNow(60_000);
  const s = getDeadlineStatus(iso, now);

  if (!s.deadlineMs) return <span className={className}>—</span>;

  const color = s.overdue
    ? "text-red-600"
    : s.dueSoon
      ? "text-orange-600"
      : "text-gray-900";

  return (
    <span className={`${color} ${className}`}>
      {showAbsolute ? `${s.absolute} · ` : ""}
      <span className="font-medium">{s.label}</span>
    </span>
  );
};
