/**
 * Reading a refund amount an admin typed. The server checks it again; this is
 * so the mistake is named next to the field instead of after a round trip.
 */
export const parseRefundAmount = (
    input: string,
    max: number,
    { allowZero = false }: { allowZero?: boolean } = {},
): { amount: number | null; error: string | null } => {
    const text = input.trim().replace(/^\$/, '');
    if (!text) return { amount: null, error: 'Enter an amount.' };
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return { amount: null, error: 'Enter the amount in dollars and cents, like 12.50.' };
    const amount = Number(text);
    if (amount === 0 && !allowZero) return { amount: null, error: 'Enter an amount greater than zero.' };
    if (amount > max + 0.0001) return { amount: null, error: `The most that can be refunded is $${max.toFixed(2)}.` };
    return { amount, error: null };
};

export const isFullRefund = (amount: number, max: number) => Math.abs(amount - max) < 0.005;

export const ISSUE_TYPE_LABEL: Record<string, string> = {
    NOT_RECEIVED: "Order didn't arrive",
    DAMAGED: 'Order arrived damaged',
    NEEDS_REPRINT: 'Order needs to be reprinted',
    OTHER: 'Something else',
};

export type IssueChannel = 'CUSTOMER' | 'PARTNER';

export interface IssuePhoto {
    url: string;
    name: string;
}

/** The small version stored beside each photo. */
export const issuePhotoThumb = (url: string): string => url.replace(/\.[a-z0-9]+$/i, '-thumb200.webp');

export interface AdminIssueMessage {
    id: string;
    channel: IssueChannel;
    author: 'CUSTOMER' | 'ADMIN' | 'PARTNER';
    authorName: string;
    body: string;
    attachments?: IssuePhoto[];
    at: string;
}

export interface AdminIssue {
    id: string;
    orderId: string;
    displayId: string;
    type: string;
    typeLabel: string;
    status: 'OPEN' | 'RESOLVED';
    description: string;
    attachments?: IssuePhoto[];
    needsAdmin: boolean;
    partnerId: string | null;
    partnerName: string | null;
    customerName: string;
    customerEmail: string;
    orderStatus: string;
    orderTotal: number;
    refundable: number;
    createdAt: string;
    updatedAt: string;
    messages: AdminIssueMessage[];
    resolution: {
        outcome: 'REFUND' | 'REPRINT' | 'NONE';
        outcomeLabel: string;
        note: string;
        refundAmount: number | null;
        reprintOrderId: string | null;
        reprintDisplayId: string | null;
        at: string;
        byName: string;
    } | null;
}

/** The latest thing said on a report, for a one-line preview in the list. */
export const issuePreview = (issue: Pick<AdminIssue, 'description' | 'messages'>): string => {
    const last = issue.messages[issue.messages.length - 1];
    const photos = last ? last.attachments?.length || 0 : 0;
    const text = (last ? last.body : issue.description || '').replace(/\s+/g, ' ').trim();
    return text || (photos > 0 ? `${photos} photo${photos === 1 ? '' : 's'}` : (issue.description || '').replace(/\s+/g, ' ').trim());
};

/** How many messages on a channel came after the admin last wrote on it. */
export const unansweredOn = (issue: Pick<AdminIssue, 'messages'>, channel: IssueChannel): number => {
    let count = 0;
    for (const m of issue.messages) {
        if (m.channel !== channel) continue;
        count = m.author === 'ADMIN' ? 0 : count + 1;
    }
    return count;
};
