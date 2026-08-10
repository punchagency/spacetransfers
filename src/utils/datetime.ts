import { useEffect, useState } from "react";

/**
 * Centralised date/time formatting so every screen renders timestamps the same
 * way, in the viewer's local timezone. All backend timestamps are ISO 8601
 * (UTC); these helpers turn them into consistent, human-readable strings.
 */

type DateInput = string | number | Date | null | undefined;

const toDate = (value: DateInput): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "Mar 5, 2025, 2:30 PM" */
export const formatDateTime = (value: DateInput): string => {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

/** "Mar 5, 2025" */
export const formatDate = (value: DateInput): string => {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** "2:30 PM" */
export const formatTime = (value: DateInput): string => {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

export interface DeadlineStatus {
  /** Deadline as ms since epoch, or null when there is no deadline. */
  deadlineMs: number | null;
  /** Milliseconds remaining (negative when overdue), or null. */
  msLeft: number | null;
  overdue: boolean;
  /** Less than 4 hours remain (and not overdue). */
  dueSoon: boolean;
  /** Short remaining-time label: "23h left", "1h 5m left", "Overdue by 2h", "—". */
  label: string;
  /** Absolute deadline, formatted: "Mar 5, 2025, 2:30 PM". */
  absolute: string;
}

const DUE_SOON_MS = 4 * 60 * 60 * 1000;

const humanizeDuration = (ms: number): string => {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

/**
 * Derive the countdown/expiration state for a deadline ISO string. `now` is a
 * parameter so a live component can pass a ticking clock and stay pure/testable.
 */
export const getDeadlineStatus = (
  iso: DateInput,
  now: number = Date.now(),
): DeadlineStatus => {
  const d = toDate(iso);
  if (!d) {
    return { deadlineMs: null, msLeft: null, overdue: false, dueSoon: false, label: "—", absolute: "—" };
  }
  const deadlineMs = d.getTime();
  const msLeft = deadlineMs - now;
  const overdue = msLeft <= 0;
  const dueSoon = !overdue && msLeft <= DUE_SOON_MS;
  const label = overdue
    ? `Overdue by ${humanizeDuration(Math.abs(msLeft))}`
    : `${humanizeDuration(msLeft)} left`;
  return { deadlineMs, msLeft, overdue, dueSoon, label, absolute: formatDateTime(d) };
};

/**
 * A clock that re-renders the calling component on an interval (default every
 * minute) so live countdowns stay current without per-component timers.
 */
export const useNow = (intervalMs = 60_000): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};
