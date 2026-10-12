import { ISSUE_TYPES, type IssueAuthor, type IssueChannel, type IssueOutcome, type IssueType } from "../models/orderIssue.model.js";

/**
 * The rules of an order problem that do not need the database: what may be
 * reported, what each side is shown, and how it is worded.
 */

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  NOT_RECEIVED: "Order didn't arrive",
  DAMAGED: "Order arrived damaged",
  NEEDS_REPRINT: "Order needs to be reprinted",
  OTHER: "Something else",
};

export const ISSUE_OUTCOME_LABELS: Record<IssueOutcome, string> = {
  REFUND: "Refunded",
  REPRINT: "Free reprint sent",
  NONE: "Closed",
};

export const MAX_ISSUE_TEXT = 2000;
export const MAX_ISSUE_ATTACHMENTS = 4;
/** Where report photos are stored; a URL outside it is not one of ours. */
export const ISSUE_ATTACHMENT_FOLDER = "issues";

/**
 * The photos sent with a report or a message, or an error to show. Only files
 * this platform stored for reports are accepted, so a message can never carry
 * a link to somewhere else dressed up as a photo.
 */
export const cleanIssueAttachments = (
  value: unknown,
  isStored: (url: string) => boolean,
): { attachments: { url: string; name: string }[]; error: string | null } => {
  if (value === undefined || value === null) return { attachments: [], error: null };
  if (!Array.isArray(value)) return { attachments: [], error: "The photos couldn't be read. Please add them again." };
  if (value.length > MAX_ISSUE_ATTACHMENTS) return { attachments: [], error: `Add up to ${MAX_ISSUE_ATTACHMENTS} photos.` };
  const attachments: { url: string; name: string }[] = [];
  for (const entry of value) {
    const url = String((entry as any)?.url || "");
    if (!isStored(url) || !url.includes(`/${ISSUE_ATTACHMENT_FOLDER}/`)) {
      return { attachments: [], error: "One of the photos couldn't be attached. Please add it again." };
    }
    attachments.push({ url, name: String((entry as any)?.name || "").slice(0, 120) });
  }
  return { attachments, error: null };
};

export const parseIssueType = (value: unknown): IssueType | null => {
  const type = String(value || "").trim().toUpperCase();
  return (ISSUE_TYPES as readonly string[]).includes(type) ? (type as IssueType) : null;
};

/** The text of a report or a message, trimmed, or an error to show. */
export const cleanIssueText = (value: unknown, { required }: { required: boolean }): { text: string; error: string | null } => {
  const text = String(value ?? "").trim();
  if (required && !text) return { text, error: "Write a message first." };
  if (text.length > MAX_ISSUE_TEXT) return { text, error: `Keep it under ${MAX_ISSUE_TEXT} characters.` };
  return { text, error: null };
};

/**
 * Why this order can't have a problem reported, or null when it can. Whatever
 * the type, there has to be a paid order to complain about; one that was
 * cancelled and refunded has nothing left to put right.
 */
export const issueReportError = (order: any, type: IssueType, description: string): string | null => {
  if (String(order?.status || "").toUpperCase() === "CANCELLED") return "This order was cancelled, so there is nothing to report.";
  if (type === "OTHER" && !description) return "Tell us what went wrong.";
  return null;
};

const attachments = (list: any) =>
  (Array.isArray(list) ? list : []).map((a: any) => ({ url: String(a.url || ""), name: String(a.name || "") }));

const message = (m: any) => ({
  id: String(m._id || ""),
  channel: m.channel as IssueChannel,
  author: m.author as IssueAuthor,
  authorName: String(m.authorName || ""),
  body: String(m.body || ""),
  attachments: attachments(m.attachments),
  at: m.at,
});

const base = (issue: any) => ({
  id: String(issue._id),
  orderId: String(issue.order?._id || issue.order),
  displayId: String(issue.displayId || ""),
  type: issue.type as IssueType,
  typeLabel: ISSUE_TYPE_LABELS[issue.type as IssueType] || "Problem",
  status: issue.status as "OPEN" | "RESOLVED",
  createdAt: issue.createdAt,
  updatedAt: issue.updatedAt,
});

const resolution = (issue: any) =>
  issue.resolution?.outcome
    ? {
        outcome: issue.resolution.outcome as IssueOutcome,
        outcomeLabel: ISSUE_OUTCOME_LABELS[issue.resolution.outcome as IssueOutcome],
        note: String(issue.resolution.note || ""),
        refundAmount: issue.resolution.refundAmount ?? null,
        reprintOrderId: issue.resolution.reprintOrderId ?? null,
        reprintDisplayId: issue.resolution.reprintDisplayId ?? null,
        at: issue.resolution.at,
        byName: String(issue.resolution.byName || ""),
      }
    : null;

/** Everything: both conversations and who settled it. */
export const issueForAdmin = (issue: any) => ({
  ...base(issue),
  description: String(issue.description || ""),
  attachments: attachments(issue.attachments),
  needsAdmin: Boolean(issue.needsAdmin),
  partnerId: issue.partner ? String(issue.partner) : null,
  messages: (issue.messages || []).map(message),
  resolution: resolution(issue),
});

/** The customer's own report, their conversation with us, and how it ended. */
export const issueForCustomer = (issue: any) => {
  const settled = resolution(issue);
  return {
    ...base(issue),
    description: String(issue.description || ""),
    attachments: attachments(issue.attachments),
    unread: Boolean(issue.customerUnread),
    messages: (issue.messages || [])
      .filter((m: any) => m.channel === "CUSTOMER")
      .map(message)
      // A customer talks to Space Transfers, not to a named member of staff.
      .map((m: ReturnType<typeof message>) => (m.author === "ADMIN" ? { ...m, authorName: "Space Transfers" } : m)),
    resolution: settled && {
      outcome: settled.outcome,
      outcomeLabel: settled.outcomeLabel,
      note: settled.note,
      refundAmount: settled.refundAmount,
      reprintDisplayId: settled.reprintDisplayId,
      at: settled.at,
    },
  };
};

/**
 * What the partner is shown: what kind of problem it is and their own
 * conversation with the admin. Not the customer's words, and not the outcome,
 * which is between the business and the customer.
 */
export const issueForPartner = (issue: any) => ({
  ...base(issue),
  awaitingReply: partnerOwesReply(issue),
  messages: (issue.messages || [])
    .filter((m: any) => m.channel === "PARTNER")
    .map(message)
    .map((m: ReturnType<typeof message>) => (m.author === "ADMIN" ? { ...m, authorName: "Space Transfers" } : m)),
});

/** A partner sees a problem only once the admin has written to them about it. */
export const partnerCanSeeIssue = (issue: any, partnerId: string): boolean =>
  Boolean(issue?.partner) &&
  String(issue.partner) === String(partnerId) &&
  (issue.messages || []).some((m: any) => m.channel === "PARTNER");

/**
 * What the customer is told when a report is settled. It goes into their
 * conversation as well as onto the report, so a report that is reopened and
 * settled again still reads in order.
 */
export const resolutionMessage = (
  outcome: IssueOutcome,
  note: string,
  detail: { refundAmount?: number; reprintDisplayId?: string } = {},
): string => {
  const lead =
    outcome === "REFUND"
      ? `We've refunded $${(detail.refundAmount ?? 0).toFixed(2)} to your card.`
      : outcome === "REPRINT"
        ? `We're reprinting your order free of charge${detail.reprintDisplayId ? ` as ${detail.reprintDisplayId}` : ""}.`
        : "";
  return [lead, note].filter(Boolean).join("\n\n");
};

/** The admin wrote last on the partner's side of an open report, so the partner owes an answer. */
export const partnerOwesReply = (issue: any): boolean => {
  if (issue?.status !== "OPEN") return false;
  const thread = (issue.messages || []).filter((m: any) => m.channel === "PARTNER");
  return thread.length > 0 && thread[thread.length - 1].author === "ADMIN";
};

/**
 * What a partner's job list shows for each order: whether a question is open
 * on it, and whether it is waiting on them. Settled reports show nothing.
 */
export const partnerIssueFlags = (issues: any[], partnerId: string): Map<string, { open: true; awaitingReply: boolean }> => {
  const flags = new Map<string, { open: true; awaitingReply: boolean }>();
  for (const issue of issues) {
    if (issue?.status !== "OPEN" || !partnerCanSeeIssue(issue, partnerId)) continue;
    const key = String(issue.order?._id || issue.order);
    flags.set(key, { open: true, awaitingReply: partnerOwesReply(issue) || Boolean(flags.get(key)?.awaitingReply) });
  }
  return flags;
};
