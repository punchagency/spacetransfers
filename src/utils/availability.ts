import { apiFetch } from "./api";

export interface AvailabilitySnapshot {
  availabilityStatus: "open" | "paused";
  capacityLocked: boolean;
  capacityPaused: boolean;
  activeJobs: number;
  maxJobs: number | null;
}

/**
 * One shared read of `GET /printer/availability`.
 *
 * That endpoint is not a plain read: it reconciles the partner's availability
 * with their current load and, when that changes something, saves, broadcasts
 * to the admin console and sends the partner a notification. Two callers
 * mounting together — the status pill in the top bar and the capacity meter in
 * the sidebar — could each cross the limit independently and each produce a
 * "Maximum job capacity reached" notification for one event.
 *
 * Concurrent callers share one in-flight request, so the endpoint is hit once
 * per mount however many components want the answer. The promise is released as
 * soon as it settles, so a later call still gets fresh data.
 */
let inFlight: Promise<AvailabilitySnapshot | null> | null = null;

export const fetchAvailability = (): Promise<AvailabilitySnapshot | null> => {
  const pending = inFlight;
  if (pending) return pending;

  const request: Promise<AvailabilitySnapshot | null> = apiFetch("/printer/availability")
    .then((r: any): AvailabilitySnapshot | null =>
      r
        ? {
            availabilityStatus: r.availabilityStatus === "paused" ? "paused" : "open",
            capacityLocked: Boolean(r.capacityLocked),
            capacityPaused: Boolean(r.capacityPaused),
            activeJobs: Number(r.activeJobs ?? 0),
            maxJobs: typeof r.maxJobs === "number" ? r.maxJobs : null,
          }
        : null,
    )
    .catch(() => null)
    .finally(() => {
      inFlight = null;
    });

  inFlight = request;
  return request;
};
