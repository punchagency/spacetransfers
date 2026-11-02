export type DueStage = "ACCEPT" | "PRINT" | null | undefined;

export interface JobDue {
  /** "Accept by", "Print by", or "Due" when nothing is due. */
  label: string;
  /** When it is due, or null when nothing is. */
  at: Date | null;
  overdue: boolean;
  /** Due within the next 24 hours. */
  soon: boolean;
}

/** What a job is due for next: accept by, then print by, then nothing. */
export const jobDue = (deadline: string | null | undefined, stage: DueStage, now: number = Date.now()): JobDue => {
  const at = deadline && stage ? new Date(deadline) : null;
  if (!at || Number.isNaN(at.getTime())) return { label: "Due", at: null, overdue: false, soon: false };
  const msLeft = at.getTime() - now;
  return {
    label: stage === "PRINT" ? "Print by" : "Accept by",
    at,
    overdue: msLeft < 0,
    soon: msLeft >= 0 && msLeft < 24 * 60 * 60 * 1000,
  };
};
