/** A problem reported on an order, as the customer sees it. */

export type IssueType = "NOT_RECEIVED" | "DAMAGED" | "NEEDS_REPRINT" | "OTHER";

/** A photo sent with a report or a message. */
export interface IssuePhoto {
  url: string;
  name: string;
}

export interface IssueMessage {
  id: string;
  author: "CUSTOMER" | "ADMIN" | "PARTNER";
  authorName: string;
  body: string;
  attachments?: IssuePhoto[];
  at: string;
}

export interface OrderIssue {
  id: string;
  orderId: string;
  displayId: string;
  type: IssueType;
  typeLabel: string;
  status: "OPEN" | "RESOLVED";
  description: string;
  attachments?: IssuePhoto[];
  createdAt: string;
  messages: IssueMessage[];
  resolution: {
    outcome: "REFUND" | "REPRINT" | "NONE";
    outcomeLabel: string;
    note: string;
    refundAmount: number | null;
    reprintDisplayId: string | null;
    at: string;
  } | null;
}

/** What the order list knows about an order's reports. */
export interface OrderIssueSummary {
  status: "OPEN" | "RESOLVED";
  unread: boolean;
}

export const ISSUE_OPTIONS: { type: IssueType; label: string; hint: string }[] = [
  { type: "NOT_RECEIVED", label: "My order didn't get to me", hint: "It's late, lost, or marked delivered but isn't here." },
  { type: "DAMAGED", label: "My order arrived damaged", hint: "The package or the transfers were damaged in the post." },
  { type: "NEEDS_REPRINT", label: "My order needs to be reprinted", hint: "The print is wrong: colours, size, missing or faulty transfers." },
  { type: "OTHER", label: "Other", hint: "Anything else about this order." },
];

export const MAX_ISSUE_TEXT = 2000;
export const MAX_ISSUE_PHOTOS = 4;
export const MAX_ISSUE_PHOTO_BYTES = 15 * 1024 * 1024;
export const ISSUE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Which of the chosen files can be added, and why any were left out. Photos
 * beyond the limit are dropped, not the ones already attached.
 */
export const pickIssuePhotos = (
  files: { name: string; type: string; size: number }[],
  alreadyAttached: number,
): { accepted: number[]; problems: string[] } => {
  const accepted: number[] = [];
  const problems: string[] = [];
  let room = MAX_ISSUE_PHOTOS - alreadyAttached;
  let overLimit = 0;
  files.forEach((file, index) => {
    if (!ISSUE_PHOTO_TYPES.includes(file.type)) return void problems.push(`${file.name} isn't a JPG or PNG photo.`);
    if (file.size > MAX_ISSUE_PHOTO_BYTES) return void problems.push(`${file.name} is over 15 MB.`);
    if (room <= 0) return void (overLimit += 1);
    room -= 1;
    accepted.push(index);
  });
  if (overLimit > 0) problems.push(`You can add up to ${MAX_ISSUE_PHOTOS} photos.`);
  return { accepted, problems };
};

/** The small version stored beside each photo. */
export const issuePhotoThumb = (url: string): string => url.replace(/\.[a-z0-9]+$/i, "-thumb200.webp");

/** A cancelled order has been refunded already; there is nothing to report on it. */
export const canReportIssue = (orderStatus: string): boolean => String(orderStatus || "").toLowerCase() !== "cancelled";

/** Why the report can't be sent yet, or null when it can. */
export const reportFormError = (type: IssueType | null, description: string): string | null => {
  if (!type) return "Choose what went wrong.";
  const text = description.trim();
  if (type === "OTHER" && !text) return "Tell us what went wrong.";
  if (text.length > MAX_ISSUE_TEXT) return `Keep it under ${MAX_ISSUE_TEXT} characters.`;
  return null;
};

/** The button on an order: what it says and whether it should stand out. */
export const issueButton = (issue: OrderIssueSummary | null | undefined): { label: string; tone: "plain" | "open" | "reply" } => {
  if (!issue) return { label: "Report a problem", tone: "plain" };
  if (issue.unread) return { label: "New reply", tone: "reply" };
  return issue.status === "OPEN" ? { label: "View report", tone: "open" } : { label: "Report a problem", tone: "plain" };
};

/** How a settled report ended, in the customer's terms. */
export const resolutionSummary = (resolution: NonNullable<OrderIssue["resolution"]>): string => {
  if (resolution.outcome === "REFUND") return `We refunded $${(resolution.refundAmount ?? 0).toFixed(2)} to your card.`;
  if (resolution.outcome === "REPRINT") {
    return resolution.reprintDisplayId
      ? `We're reprinting this order free of charge as ${resolution.reprintDisplayId}.`
      : "We're reprinting this order free of charge.";
  }
  return "This report was closed.";
};
