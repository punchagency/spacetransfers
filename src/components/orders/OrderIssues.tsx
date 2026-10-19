import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useLocation } from 'react-router-dom';
import { FiAlertTriangle, FiCheckCircle, FiSend } from 'react-icons/fi';
import { apiFetch } from '../../utils/api';
import { isFullRefund, issuePhotoThumb, parseRefundAmount, unansweredOn, type AdminIssue, type IssueChannel, type IssuePhoto } from '../../utils/refunds';

const when = (value: string) =>
    new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const Photo = ({ photo }: { photo: IssuePhoto }) => {
    const [src, setSrc] = useState(issuePhotoThumb(photo.url));
    return (
        <a
            href={photo.url}
            target="_blank"
            rel="noreferrer"
            title="Open full size"
            aria-label={`Open ${photo.name || 'photo'}`}
            className="block h-20 w-20 overflow-hidden rounded-lg border border-gray-200 hover:border-blue-400"
        >
            <img src={src} alt={photo.name || 'Photo from the customer'} loading="lazy" onError={() => src !== photo.url && setSrc(photo.url)} className="h-full w-full object-cover" />
        </a>
    );
};

/** Photos the customer sent, each opening full size in a new tab. */
const Photos = ({ photos }: { photos?: IssuePhoto[] }) =>
    photos?.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
            {photos.map((p) => (
                <Photo key={p.url} photo={p} />
            ))}
        </div>
    ) : null;

type Outcome = 'REFUND' | 'REPRINT' | 'NONE';

const ResolveDialog = ({ issue, onClose, onResolved }: { issue: AdminIssue; onClose: () => void; onResolved: () => void }) => {
    const canRefund = issue.refundable > 0;
    const [outcome, setOutcome] = useState<Outcome>(canRefund ? 'REFUND' : 'REPRINT');
    const [amount, setAmount] = useState(issue.refundable.toFixed(2));
    const [note, setNote] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const parsed = parseRefundAmount(amount, issue.refundable);

    const options: { value: Outcome; label: string; hint: string; disabled?: boolean }[] = [
        {
            value: 'REFUND',
            label: 'Refund the customer',
            hint: canRefund
                ? `Part or all of the $${issue.refundable.toFixed(2)} left on this payment. The order is not cancelled.`
                : 'Nothing is left on this payment to refund.',
            disabled: !canRefund,
        },
        { value: 'REPRINT', label: 'Send a free reprint', hint: 'A new order of the same sheets to the same address, at no charge. It goes to a partner like any order.' },
        { value: 'NONE', label: 'Close without a refund or reprint', hint: 'Nothing more is needed. Tell the customer why.' },
    ];

    const submit = async () => {
        if (outcome === 'REFUND' && parsed.error) return setError(parsed.error);
        if (outcome !== 'REPRINT' && !note.trim()) {
            return setError(outcome === 'REFUND' ? 'Enter a reason for the refund.' : 'Tell the customer how this was resolved.');
        }
        setBusy(true);
        setError(null);
        try {
            const res = await apiFetch(`/admin/issues/${issue.id}/resolve`, {
                method: 'POST',
                body: JSON.stringify({ outcome, note: note.trim(), ...(outcome === 'REFUND' ? { refundAmount: parsed.amount } : {}) }),
            });
            toast.success(
                outcome === 'REFUND'
                    ? `Resolved. $${Number(res?.issue?.resolution?.refundAmount ?? 0).toFixed(2)} refunded.`
                    : outcome === 'REPRINT'
                      ? `Resolved. Free reprint created as ${res?.reprint?.displayId || 'a new order'}.`
                      : 'Report resolved.',
                { duration: 7000 },
            );
            if (res && res.customerNotified === false) toast('The customer could not be emailed about this.', { duration: 7000 });
            onResolved();
            onClose();
        } catch (e: any) {
            setError(e?.message || 'This could not be resolved. Nothing was changed.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div role="dialog" aria-modal="true" aria-label="Resolve report" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
                <h3 className="text-lg font-bold text-gray-900">Resolve this report</h3>
                <p className="mt-1 text-sm text-gray-500">
                    {issue.typeLabel} · order {issue.displayId}. The customer is told by email.
                </p>

                <div role="radiogroup" aria-label="How to resolve" className="mt-4 space-y-2">
                    {options.map((o) => {
                        const selected = outcome === o.value;
                        return (
                            <button
                                key={o.value}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                disabled={o.disabled}
                                onClick={() => {
                                    setOutcome(o.value);
                                    setError(null);
                                }}
                                className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                    selected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200 hover:border-gray-300'
                                }`}
                            >
                                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-blue-600' : 'border-gray-300'}`}>
                                    {selected && <span className="h-2 w-2 rounded-full bg-blue-600" />}
                                </span>
                                <span>
                                    <span className="block text-sm font-medium text-gray-900">{o.label}</span>
                                    <span className="block text-xs text-gray-500">{o.hint}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>

                {outcome === 'REFUND' && (
                    <div className="mt-4">
                        <label htmlFor="issue-refund-amount" className="block text-sm font-medium text-gray-700">
                            Refund amount <span className="font-normal text-gray-500">(up to ${issue.refundable.toFixed(2)})</span>
                        </label>
                        <div className="mt-1 flex gap-2">
                            <div className="relative flex-1">
                                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                                <input
                                    id="issue-refund-amount"
                                    inputMode="decimal"
                                    value={amount}
                                    onChange={(e) => {
                                        setAmount(e.target.value);
                                        setError(null);
                                    }}
                                    className="w-full rounded-lg border border-gray-200 py-2 pl-7 pr-3 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => setAmount(issue.refundable.toFixed(2))}
                                className="shrink-0 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                Full amount
                            </button>
                        </div>
                        {parsed.amount !== null && !isFullRefund(parsed.amount, issue.refundable) && (
                            <p className="mt-1 text-xs text-gray-500">A part refund. ${(issue.refundable - parsed.amount).toFixed(2)} stays with the order.</p>
                        )}
                    </div>
                )}

                <label htmlFor="issue-resolve-note" className="mt-4 block text-sm font-medium text-gray-700">
                    Message to the customer{' '}
                    <span className="font-normal text-gray-500">{outcome === 'REPRINT' ? '(optional)' : '(required)'}</span>
                </label>
                <textarea
                    id="issue-resolve-note"
                    value={note}
                    onChange={(e) => {
                        setNote(e.target.value);
                        setError(null);
                    }}
                    rows={3}
                    maxLength={2000}
                    placeholder={
                        outcome === 'REFUND'
                            ? "e.g. Sorry about the damage. We've refunded the affected sheet."
                            : outcome === 'REPRINT'
                              ? "e.g. Sorry about that. A replacement is on its way."
                              : 'e.g. The carrier shows this was delivered on Tuesday.'
                    }
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                {error && (
                    <p role="alert" className="mt-2 text-sm text-red-600">
                        {error}
                    </p>
                )}

                <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
                    <button onClick={onClose} disabled={busy} className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                        Back
                    </button>
                    <button onClick={() => void submit()} disabled={busy} className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                        {busy
                            ? 'Working…'
                            : outcome === 'REFUND'
                              ? `Refund${parsed.amount !== null ? ` $${parsed.amount.toFixed(2)}` : ''} & resolve`
                              : outcome === 'REPRINT'
                                ? 'Create reprint & resolve'
                                : 'Resolve'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const IssueCard = ({ issue, onChanged }: { issue: AdminIssue; onChanged: () => void }) => {
    const [channel, setChannel] = useState<IssueChannel>('CUSTOMER');
    const [drafts, setDrafts] = useState<Record<IssueChannel, string>>({ CUSTOMER: '', PARTNER: '' });
    const [sending, setSending] = useState(false);
    const [resolving, setResolving] = useState(false);
    const resolved = issue.status === 'RESOLVED';
    const partner = issue.partnerName;
    const thread = issue.messages.filter((m) => m.channel === channel);
    const draft = drafts[channel];

    const send = async () => {
        const body = draft.trim();
        if (!body || sending) return;
        setSending(true);
        try {
            const res = await apiFetch(`/admin/issues/${issue.id}/messages`, { method: 'POST', body: JSON.stringify({ channel, body }) });
            setDrafts((d) => ({ ...d, [channel]: '' }));
            if (channel === 'CUSTOMER' && res?.customerNotified === false) {
                toast('Sent. The customer could not be emailed, but will see it in Order History.', { duration: 7000 });
            } else {
                toast.success(channel === 'CUSTOMER' ? 'Sent to the customer' : `Sent to ${partner || 'the partner'}`);
            }
            onChanged();
        } catch (e: any) {
            toast.error(e?.message || 'The message could not be sent', { duration: 8000 });
        } finally {
            setSending(false);
        }
    };

    const tab = (value: IssueChannel, label: string, disabled = false) => {
        // Once it is settled nothing is waiting, whoever spoke last.
        const waiting = resolved ? 0 : unansweredOn(issue, value);
        const active = channel === value;
        return (
            <button
                type="button"
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={() => setChannel(value)}
                className={`flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                    active ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
                {label}
                {waiting > 0 && (
                    <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-4 text-white" aria-label={`${waiting} unanswered`}>
                        {waiting}
                    </span>
                )}
            </button>
        );
    };

    return (
        <div className="rounded-xl border border-gray-200">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{issue.typeLabel}</p>
                    <p className="text-xs text-gray-500">
                        Reported by {issue.customerName} · {when(issue.createdAt)}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${resolved ? 'bg-green-100 text-green-700' : issue.needsAdmin ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                        {resolved ? 'Resolved' : issue.needsAdmin ? 'Needs a reply' : 'Open'}
                    </span>
                    {!resolved && (
                        <button onClick={() => setResolving(true)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">
                            Resolve
                        </button>
                    )}
                </div>
            </div>

            <div className="px-4 py-3">
                {issue.description ? (
                    <p className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-800">{issue.description}</p>
                ) : (
                    <p className="text-sm text-gray-500">The customer added no details.</p>
                )}
                <Photos photos={issue.attachments} />

                {issue.resolution && (
                    <div className="mt-3 flex gap-2.5 rounded-lg bg-green-50 px-3 py-2.5 text-sm text-green-900">
                        <FiCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                        <div className="min-w-0">
                            <p className="font-semibold">
                                {issue.resolution.outcome === 'REFUND'
                                    ? `Refunded $${(issue.resolution.refundAmount ?? 0).toFixed(2)}`
                                    : issue.resolution.outcome === 'REPRINT'
                                      ? 'Free reprint sent'
                                      : 'Closed without a refund or reprint'}
                                {issue.resolution.outcome === 'REPRINT' && issue.resolution.reprintOrderId && (
                                    <>
                                        {' as '}
                                        <Link to={`/dashboard/orders/${issue.resolution.reprintOrderId}`} className="underline">
                                            {issue.resolution.reprintDisplayId}
                                        </Link>
                                    </>
                                )}
                            </p>
                            <p className="mt-0.5 text-xs text-green-800">
                                {issue.resolution.byName} · {when(issue.resolution.at)}
                            </p>
                        </div>
                    </div>
                )}

                <div role="tablist" className="mt-4 flex gap-5 border-b border-gray-100">
                    {tab('CUSTOMER', `Customer · ${issue.customerName}`)}
                    {tab('PARTNER', partner ? `Partner · ${partner}` : 'Partner', !partner)}
                </div>

                <div className="mt-3 space-y-2">
                    {thread.length === 0 && (
                        <p className="text-sm text-gray-500">
                            {channel === 'CUSTOMER' ? 'No messages with the customer yet.' : `No messages with ${partner || 'the partner'} yet.`}
                        </p>
                    )}
                    {thread.map((m) => {
                        const mine = m.author === 'ADMIN';
                        return (
                            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${mine ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                                    {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                                    <Photos photos={m.attachments} />
                                    <p className={`mt-1 text-[11px] ${mine ? 'text-blue-100' : 'text-gray-500'}`}>
                                        {m.authorName || (mine ? 'Admin' : channel === 'CUSTOMER' ? 'Customer' : 'Partner')} · {when(m.at)}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="mt-3">
                    <label htmlFor={`issue-${issue.id}-${channel}`} className="sr-only">
                        {channel === 'CUSTOMER' ? 'Message to the customer' : 'Message to the partner'}
                    </label>
                    <textarea
                        id={`issue-${issue.id}-${channel}`}
                        value={draft}
                        onChange={(e) => setDrafts((d) => ({ ...d, [channel]: e.target.value }))}
                        rows={2}
                        maxLength={2000}
                        placeholder={channel === 'CUSTOMER' ? `Write to ${issue.customerName}` : `Write to ${partner || 'the partner'}`}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-gray-500">
                            {channel === 'CUSTOMER'
                                ? 'The customer gets this by email and sees it in Order History. The partner does not see it.'
                                : `Only ${partner || 'the partner'} sees this, on the job page. The customer does not.`}
                        </p>
                        <button
                            onClick={() => void send()}
                            disabled={!draft.trim() || sending}
                            className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:bg-gray-300"
                        >
                            <FiSend className="h-3.5 w-3.5" />
                            {sending ? 'Sending…' : channel === 'CUSTOMER' ? 'Send to customer' : 'Send to partner'}
                        </button>
                    </div>
                </div>
            </div>

            {resolving && <ResolveDialog issue={issue} onClose={() => setResolving(false)} onResolved={onChanged} />}
        </div>
    );
};

/** The problems the customer reported on this order, with both conversations. Renders nothing when there are none. */
export const OrderIssues = ({
    orderId,
    refundable,
    onChanged,
}: {
    orderId: string;
    /** What is left to refund on the order; a refund made elsewhere on the page changes it. */
    refundable?: number;
    onChanged?: () => void;
}) => {
    const [issues, setIssues] = useState<AdminIssue[]>([]);
    const location = useLocation();
    const ref = useRef<HTMLDivElement>(null);
    const scrolled = useRef(false);

    const load = useCallback(async () => {
        try {
            const data = await apiFetch(`/admin/orders/${encodeURIComponent(orderId)}/issues`);
            setIssues(data?.issues || []);
        } catch {
            // The next poll tries again; the order page itself reports a dead session.
        }
    }, [orderId]);

    useEffect(() => {
        setIssues([]);
        scrolled.current = false;
        void load();
        const id = window.setInterval(() => void load(), 10000);
        return () => window.clearInterval(id);
    }, [load]);

    useEffect(() => {
        void load();
    }, [load, refundable]);

    // Arriving from the Issues page lands on the report, not the top of the order.
    useEffect(() => {
        if (scrolled.current || issues.length === 0 || location.hash !== '#issues') return;
        scrolled.current = true;
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [issues.length, location.hash]);

    if (issues.length === 0) return null;
    const open = issues.filter((i) => i.status === 'OPEN').length;

    return (
        <div ref={ref} id="issues" className="scroll-mt-40 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
                <FiAlertTriangle className={`h-5 w-5 ${open > 0 ? 'text-amber-500' : 'text-gray-500'}`} />
                <h2 className="text-lg font-semibold text-gray-900">Reported problems</h2>
                {open > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{open} open</span>}
            </div>
            <div className="space-y-4">
                {issues.map((issue) => (
                    <IssueCard
                        key={issue.id}
                        issue={issue}
                        onChanged={() => {
                            void load();
                            onChanged?.();
                        }}
                    />
                ))}
            </div>
        </div>
    );
};
