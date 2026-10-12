/** A problem on a job that the admin has asked this partner about. */
export interface JobIssueMessage {
  id: string;
  author: "ADMIN" | "PARTNER" | "CUSTOMER";
  authorName: string;
  body: string;
  at: string;
}

export interface JobIssue {
  id: string;
  orderId: string;
  displayId: string;
  typeLabel: string;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
  messages: JobIssueMessage[];
}

/** True when the admin wrote last, so the partner owes an answer. */
export const awaitingPartnerReply = (issue: Pick<JobIssue, "status" | "messages">): boolean => {
  if (issue.status !== "OPEN") return false;
  const last = issue.messages[issue.messages.length - 1];
  return Boolean(last) && last.author === "ADMIN";
};

/** What a job list knows about a question on a job. */
export interface JobIssueFlag {
  open: true;
  awaitingReply: boolean;
}

export const readJobIssueFlag = (value: unknown): JobIssueFlag | null => {
  const v = value as { open?: unknown; awaitingReply?: unknown } | null;
  return v && v.open ? { open: true, awaitingReply: Boolean(v.awaitingReply) } : null;
};

/** The tag a job carries in a list: red while it waits on the partner, amber once they have answered. */
export const jobIssueTag = (flag: JobIssueFlag | null | undefined): { label: string; tone: "red" | "amber" } | null =>
  !flag ? null : flag.awaitingReply ? { label: "Reply needed", tone: "red" } : { label: "Problem reported", tone: "amber" };

/** One open question, as the lists across the app show it. */
export interface OpenJobIssue {
  id: string;
  orderId: string;
  displayId: string;
  typeLabel: string;
  awaitingReply: boolean;
  lastMessage: string;
}
