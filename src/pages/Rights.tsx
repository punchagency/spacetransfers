import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { apiFetch } from '../utils/api';

/**
 * The rights check from the admin's side: customers' disputes and the
 * decisions on them, partners' concerns about jobs, and the rules applied on
 * top of the automatic checks.
 *
 * Decisions follow the policy the API enforces: a written reason every time,
 * recorded with the admin's name; an approval names exactly what it clears and
 * holds for that customer only; a rejection blocks the image for everyone
 * unless unticked.
 */

type Finding = { id: string; label: string; kind?: string; severity: 'block' | 'review' | 'info'; sources?: string[]; score?: number; detail?: string };
type Message = { author: 'CUSTOMER' | 'ADMIN'; authorName: string; body: string; attachments: { url: string; name: string }[]; at: string };
type Dispute = {
    id: string;
    status: 'open' | 'approved' | 'rejected' | 'withdrawn';
    awaitingAdmin: boolean;
    imageUrl: string;
    imageName: string | null;
    findings: Finding[];
    customer: { id: string; email: string; name: string; status: string };
    lastMessage: Message | null;
    decision: { byName: string; at: string; note: string; approvedFindings: string[] } | null;
    createdAt: string;
    updatedAt: string;
    messages?: Message[];
    rejections?: number;
    screen?: { checks: string[]; failed: string[]; findings: Finding[] } | null;
};
type Concern = { orderId: string; displayId: string; status: string; concern: { note: string; reportedByName: string; at: string } };
type Rule = { id: string; kind: 'image' | 'term'; term?: string; imageUrl?: string; note: string; addedByName: string; createdAt: string };
type Summary = { checks: Record<string, boolean>; openDisputes: number; waiting: number; openConcerns: number; rules: number };
type Tab = 'open' | 'decided' | 'concerns' | 'rules';

const CHECK_NAMES: Record<string, string> = {
    metadata: 'File details',
    imageMatching: 'Blocked-image matching',
    vision: 'Google Vision',
    claude: 'Claude',
};

const STATUS: Record<Dispute['status'], { label: string; className: string }> = {
    open: { label: 'Open', className: 'bg-amber-100 text-amber-900' },
    approved: { label: 'Approved', className: 'bg-green-100 text-green-800' },
    rejected: { label: 'Rejected', className: 'bg-red-100 text-red-800' },
    withdrawn: { label: 'Withdrawn', className: 'bg-gray-100 text-gray-700' },
};

const SEVERITY: Record<Finding['severity'], string> = {
    block: 'bg-red-100 text-red-800',
    review: 'bg-amber-100 text-amber-900',
    info: 'bg-gray-100 text-gray-700',
};

const when = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

const Badge = ({ className, children }: { className: string; children: React.ReactNode }) => (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}>{children}</span>
);

const FindingRow = ({ f }: { f: Finding }) => (
    <li className="flex items-start justify-between gap-3 py-2">
        <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">{f.label}</p>
            {f.detail && <p className="text-xs text-gray-500 break-words">{f.detail}</p>}
            <p className="text-xs text-gray-400">
                {(f.sources || []).map((s) => CHECK_NAMES[s] || s).join(', ')}
                {typeof f.score === 'number' ? ` · ${Math.round(f.score * 100)}% confident` : ''}
            </p>
        </div>
        <Badge className={SEVERITY[f.severity]}>{f.severity === 'block' ? 'Blocks' : f.severity === 'review' ? 'Review' : 'Info'}</Badge>
    </li>
);

/** One dispute, in full: the evidence, the conversation and the decision. */
const DisputeDrawer = ({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) => {
    const [d, setD] = useState<Dispute | null>(null);
    const [reply, setReply] = useState('');
    const [reason, setReason] = useState('');
    const [approve, setApprove] = useState<string[]>([]);
    const [blockImage, setBlockImage] = useState(true);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const data = await apiFetch(`/admin/rights/disputes/${id}`);
        setD(data.dispute);
        setApprove((data.dispute.findings || []).filter((f: Finding) => f.severity !== 'info').map((f: Finding) => f.id));
    }, [id]);

    useEffect(() => {
        load().catch((e) => toast.error(e?.message || 'The dispute could not be loaded.'));
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [load, onClose]);

    const act = async (path: string, body: object, done: string) => {
        setBusy(true);
        try {
            const data = await apiFetch(`/admin/rights/disputes/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) });
            setD(data.dispute);
            setReply('');
            setReason('');
            toast.success(done);
            onChanged();
        } catch (e: any) {
            toast.error(e?.message || 'That didn’t work. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    const disputable = (d?.findings || []).filter((f) => f.severity !== 'info');

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
            <aside
                role="dialog"
                aria-modal="true"
                aria-label="Rights dispute"
                onClick={(e) => e.stopPropagation()}
                className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white shadow-2xl"
            >
                <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                    <h2 className="text-lg font-bold text-gray-900">Rights dispute</h2>
                    <button onClick={onClose} className="text-sm font-medium text-gray-500 hover:text-gray-800">
                        Close
                    </button>
                </div>
                {!d ? (
                    <div className="flex flex-1 items-center justify-center">
                        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
                    </div>
                ) : (
                    <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
                        <div className="grid gap-5 md:grid-cols-[240px_1fr]">
                            <a href={d.imageUrl} target="_blank" rel="noopener noreferrer" className="block">
                                <img
                                    src={d.imageUrl}
                                    alt={d.imageName || 'Disputed image'}
                                    className="aspect-square w-full rounded-xl border border-gray-200 bg-[repeating-conic-gradient(#f3f4f6_0_25%,#fff_0_50%)] bg-[length:16px_16px] object-contain"
                                />
                            </a>
                            <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge className={STATUS[d.status].className}>{STATUS[d.status].label}</Badge>
                                    <span className="text-sm text-gray-500">opened {when(d.createdAt)}</span>
                                </div>
                                <div className="text-sm">
                                    <p className="font-semibold text-gray-900">{d.customer.name || d.customer.email}</p>
                                    <p className="text-gray-500">{d.customer.email}</p>
                                    {(d.rejections || 0) > 0 && (
                                        <p className={`mt-1 text-xs font-semibold ${(d.rejections || 0) >= 3 ? 'text-red-700' : 'text-amber-700'}`}>
                                            {d.rejections} earlier dispute{d.rejections === 1 ? '' : 's'} rejected
                                            {(d.rejections || 0) >= 3 ? ': consider suspending the account under the repeat infringer policy' : ''}
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">What the check found</h3>
                                    <ul className="divide-y divide-gray-100">
                                        {(d.screen?.findings?.length ? d.screen.findings : d.findings).map((f) => (
                                            <FindingRow key={f.id} f={f} />
                                        ))}
                                    </ul>
                                    {d.screen && (
                                        <p className="mt-1 text-xs text-gray-400">
                                            Checks that ran: {d.screen.checks.map((c) => CHECK_NAMES[c === 'hash' ? 'imageMatching' : c] || c).join(', ')}
                                            {d.screen.failed.length ? ` · failed: ${d.screen.failed.join(', ')}` : ''}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        <section aria-label="Conversation" className="space-y-3">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Conversation</h3>
                            <ol className="space-y-3">
                                {(d.messages || []).map((m, i) => (
                                    <li key={i} className={`flex ${m.author === 'ADMIN' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.author === 'ADMIN' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                                            {m.attachments.map((a) => (
                                                <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xs underline underline-offset-2">
                                                    {a.name}
                                                </a>
                                            ))}
                                            <p className={`mt-1 text-xs ${m.author === 'ADMIN' ? 'text-blue-100' : 'text-gray-500'}`}>
                                                {m.author === 'ADMIN' ? m.authorName || 'Admin' : 'Customer'} · {when(m.at)}
                                            </p>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                            {d.status === 'open' && (
                                <div className="flex gap-2">
                                    <label htmlFor="rights-reply" className="sr-only">
                                        Reply to the customer
                                    </label>
                                    <textarea
                                        id="rights-reply"
                                        value={reply}
                                        onChange={(e) => setReply(e.target.value)}
                                        rows={2}
                                        placeholder="Ask for a licence, or explain what you need"
                                        className="min-h-[44px] flex-1 resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                    />
                                    <button
                                        disabled={busy || !reply.trim()}
                                        onClick={() => void act('messages', { message: reply.trim() }, 'Reply sent')}
                                        className="h-[44px] shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
                                    >
                                        Send
                                    </button>
                                </div>
                            )}
                        </section>

                        {d.status === 'open' && (
                            <section aria-label="Decision" className="space-y-3 rounded-xl border border-gray-200 p-4">
                                <h3 className="text-sm font-semibold text-gray-900">Decision</h3>
                                <fieldset className="space-y-1.5">
                                    <legend className="text-xs text-gray-500">Approving clears these for this customer only, in any of their artwork:</legend>
                                    {disputable.map((f) => (
                                        <label key={f.id} className="flex items-center gap-2 text-sm text-gray-800">
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 accent-blue-600"
                                                checked={approve.includes(f.id)}
                                                onChange={(e) => setApprove((list) => (e.target.checked ? [...list, f.id] : list.filter((x) => x !== f.id)))}
                                            />
                                            {f.label}
                                        </label>
                                    ))}
                                </fieldset>
                                <label htmlFor="rights-reason" className="block text-xs text-gray-500">
                                    Reason (required, kept with the decision and sent to the customer)
                                </label>
                                <textarea
                                    id="rights-reason"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    rows={3}
                                    placeholder="e.g. Licence agreement with Nike attached, valid to Dec 2027."
                                    className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                />
                                <label className="flex items-center gap-2 text-sm text-gray-700">
                                    <input type="checkbox" className="h-4 w-4 accent-red-600" checked={blockImage} onChange={(e) => setBlockImage(e.target.checked)} />
                                    On rejection, also block this image for every customer
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        disabled={busy || reason.trim().length < 10 || !approve.length}
                                        onClick={() => void act('approve', { note: reason.trim(), findings: approve }, 'Approved')}
                                        className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:bg-gray-300"
                                    >
                                        Approve
                                    </button>
                                    <button
                                        disabled={busy || reason.trim().length < 10}
                                        onClick={() => void act('reject', { note: reason.trim(), blockImage }, 'Rejected')}
                                        className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                                    >
                                        Reject
                                    </button>
                                </div>
                            </section>
                        )}

                        {d.decision && d.status !== 'open' && (
                            <section className={`space-y-2 rounded-xl border p-4 text-sm ${d.status === 'approved' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                                <p className="font-semibold text-gray-900">
                                    {STATUS[d.status].label} by {d.decision.byName} · {when(d.decision.at)}
                                </p>
                                <p className="text-gray-800">{d.decision.note}</p>
                                {d.status === 'approved' && (
                                    <div className="space-y-2 pt-2">
                                        <label htmlFor="rights-revoke" className="block text-xs text-gray-600">
                                            Revoke the approval, for instance if the licence lapsed (reason required)
                                        </label>
                                        <textarea
                                            id="rights-revoke"
                                            value={reason}
                                            onChange={(e) => setReason(e.target.value)}
                                            rows={2}
                                            className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                        />
                                        <button
                                            disabled={busy || reason.trim().length < 10}
                                            onClick={() => void act('revoke', { note: reason.trim() }, 'Approval revoked')}
                                            className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                                        >
                                            Revoke approval
                                        </button>
                                    </div>
                                )}
                            </section>
                        )}
                    </div>
                )}
            </aside>
        </div>
    );
};

export const Rights = () => {
    const [tab, setTab] = useState<Tab>('open');
    const [summary, setSummary] = useState<Summary | null>(null);
    const [disputes, setDisputes] = useState<Dispute[] | null>(null);
    const [concerns, setConcerns] = useState<Concern[] | null>(null);
    const [rules, setRules] = useState<Rule[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [openId, setOpenId] = useState<string | null>(null);
    const [term, setTerm] = useState('');
    const [termNote, setTermNote] = useState('');
    const [concernNotes, setConcernNotes] = useState<Record<string, string>>({});

    const load = useCallback(async () => {
        try {
            setSummary(await apiFetch('/admin/rights/summary'));
            if (tab === 'open' || tab === 'decided') setDisputes((await apiFetch(`/admin/rights/disputes?status=${tab}`)).disputes || []);
            if (tab === 'concerns') setConcerns((await apiFetch('/admin/rights/concerns')).concerns || []);
            if (tab === 'rules') setRules((await apiFetch('/admin/rights/rules')).rules || []);
            setError(null);
        } catch (e: any) {
            setError(e?.message || 'This page could not be loaded.');
        }
    }, [tab]);

    useEffect(() => {
        setDisputes(null);
        setConcerns(null);
        setRules(null);
        void load();
        const id = window.setInterval(() => void load(), 15000);
        return () => window.clearInterval(id);
    }, [load]);

    const addTerm = async () => {
        try {
            await apiFetch('/admin/rights/rules', { method: 'POST', body: JSON.stringify({ term: term.trim(), note: termNote.trim() }) });
            setTerm('');
            setTermNote('');
            toast.success('Watch term added');
            void load();
        } catch (e: any) {
            toast.error(e?.message || 'The term could not be added.');
        }
    };

    const removeRule = async (id: string) => {
        try {
            await apiFetch(`/admin/rights/rules/${id}`, { method: 'DELETE' });
            toast.success('Rule removed');
            void load();
        } catch (e: any) {
            toast.error(e?.message || 'The rule could not be removed.');
        }
    };

    const clearConcern = async (orderId: string) => {
        try {
            await apiFetch(`/admin/orders/${orderId}/rights-concern/resolve`, { method: 'POST', body: JSON.stringify({ note: (concernNotes[orderId] || '').trim() }) });
            toast.success('Concern cleared; the partner can carry on');
            void load();
        } catch (e: any) {
            toast.error(e?.message || 'The concern could not be cleared.');
        }
    };

    const TABS: { value: Tab; label: string; count?: number }[] = [
        { value: 'open', label: 'Open disputes', count: summary?.openDisputes },
        { value: 'decided', label: 'Decided' },
        { value: 'concerns', label: 'Partner concerns', count: summary?.openConcerns },
        { value: 'rules', label: 'Blocked images & watch terms', count: summary?.rules },
    ];

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="space-y-2">
                    <h1 className="text-2xl font-bold text-gray-900">Rights</h1>
                    <p className="text-gray-500">
                        Artwork the rights check held, customers’ disputes, and partners’ concerns.
                        {summary && summary.waiting > 0 ? ` ${summary.waiting} customer${summary.waiting === 1 ? ' is' : 's are'} waiting on a reply.` : ''}
                    </p>
                    {summary && (
                        <div className="flex flex-wrap gap-2 text-xs">
                            {Object.entries(summary.checks).map(([k, on]) => (
                                <Badge key={k} className={on ? 'bg-green-50 text-green-800' : 'bg-gray-100 text-gray-500'}>
                                    {CHECK_NAMES[k] || k}: {on ? 'on' : 'off'}
                                </Badge>
                            ))}
                            {(!summary.checks.vision || !summary.checks.claude) && (
                                <span className="text-gray-500">Checks marked off need their API key on the server.</span>
                            )}
                        </div>
                    )}
                </div>

                <div role="tablist" className="flex flex-wrap gap-2">
                    {TABS.map((t) => (
                        <button
                            key={t.value}
                            role="tab"
                            aria-selected={tab === t.value}
                            onClick={() => setTab(t.value)}
                            className={`rounded-lg px-4 py-2 text-sm font-medium ${
                                tab === t.value ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                            }`}
                        >
                            {t.label}
                            {t.count ? ` (${t.count})` : ''}
                        </button>
                    ))}
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    {error ? (
                        <p className="p-8 text-center text-sm text-red-600">{error}</p>
                    ) : (tab === 'open' || tab === 'decided') ? (
                        disputes === null ? (
                            <div className="flex justify-center p-12">
                                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
                            </div>
                        ) : disputes.length === 0 ? (
                            <p className="p-12 text-center text-sm text-gray-500">
                                {tab === 'open' ? 'No open disputes. Customers open them from Rights reviews in the store.' : 'No decided disputes yet.'}
                            </p>
                        ) : (
                            <ul className="divide-y divide-gray-100">
                                {disputes.map((d) => (
                                    <li key={d.id}>
                                        <button onClick={() => setOpenId(d.id)} className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-gray-50">
                                            <img src={d.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-gray-200 bg-gray-50 object-contain" loading="lazy" />
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-semibold text-gray-900">{d.findings.filter((f) => f.severity !== 'info').map((f) => f.label).join(', ') || 'Image'}</p>
                                                <p className="truncate text-sm text-gray-500">
                                                    {d.customer.email}
                                                    {d.lastMessage ? ` · “${d.lastMessage.body.slice(0, 80)}”` : ''}
                                                </p>
                                            </div>
                                            <div className="flex shrink-0 flex-col items-end gap-1">
                                                {d.status === 'open' && d.awaitingAdmin ? (
                                                    <Badge className="bg-red-100 text-red-800">Reply needed</Badge>
                                                ) : (
                                                    <Badge className={STATUS[d.status].className}>{STATUS[d.status].label}</Badge>
                                                )}
                                                <span className="text-xs text-gray-400">{when(d.updatedAt)}</span>
                                            </div>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )
                    ) : tab === 'concerns' ? (
                        concerns === null ? (
                            <div className="flex justify-center p-12">
                                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
                            </div>
                        ) : concerns.length === 0 ? (
                            <p className="p-12 text-center text-sm text-gray-500">No partner has a concern open. Partners raise them from a job’s page.</p>
                        ) : (
                            <ul className="divide-y divide-gray-100">
                                {concerns.map((c) => (
                                    <li key={c.orderId} className="space-y-3 px-5 py-4">
                                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                                            <Link to={`/dashboard/orders/${c.orderId}`} className="text-sm font-semibold text-blue-700 hover:underline">
                                                Order {c.displayId}
                                            </Link>
                                            <span className="text-xs text-gray-400">
                                                {c.concern.reportedByName} · {when(c.concern.at)}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-800">{c.concern.note}</p>
                                        <div className="flex flex-wrap gap-2">
                                            <label htmlFor={`concern-${c.orderId}`} className="sr-only">
                                                Reason for clearing
                                            </label>
                                            <input
                                                id={`concern-${c.orderId}`}
                                                value={concernNotes[c.orderId] || ''}
                                                onChange={(e) => setConcernNotes((n) => ({ ...n, [c.orderId]: e.target.value }))}
                                                placeholder="Why it can be printed (sent to the partner)"
                                                className="min-w-[240px] flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                            />
                                            <button
                                                disabled={(concernNotes[c.orderId] || '').trim().length < 10}
                                                onClick={() => void clearConcern(c.orderId)}
                                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
                                            >
                                                Clear concern
                                            </button>
                                            <Link
                                                to={`/dashboard/orders/${c.orderId}`}
                                                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                            >
                                                Open order to cancel
                                            </Link>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )
                    ) : rules === null ? (
                        <div className="flex justify-center p-12">
                            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            <div className="flex flex-wrap items-end gap-2 px-5 py-4">
                                <div className="min-w-[180px] flex-1">
                                    <label htmlFor="watch-term" className="block text-xs text-gray-500">
                                        Watch for a name (holds images whose text or recognised content includes it)
                                    </label>
                                    <input
                                        id="watch-term"
                                        value={term}
                                        onChange={(e) => setTerm(e.target.value)}
                                        placeholder="e.g. Dallas Cowboys"
                                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                                <div className="min-w-[180px] flex-1">
                                    <label htmlFor="watch-note" className="block text-xs text-gray-500">
                                        Note (optional)
                                    </label>
                                    <input
                                        id="watch-note"
                                        value={termNote}
                                        onChange={(e) => setTermNote(e.target.value)}
                                        placeholder="e.g. Takedown notice, Oct 2026"
                                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                                <button
                                    disabled={term.trim().length < 3}
                                    onClick={() => void addTerm()}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
                                >
                                    Add
                                </button>
                            </div>
                            {rules.length === 0 ? (
                                <p className="p-8 text-center text-sm text-gray-500">
                                    No rules yet. Rejecting a dispute blocks its image here; watch terms add to the built-in list of major brands and characters.
                                </p>
                            ) : (
                                <ul className="divide-y divide-gray-100">
                                    {rules.map((r) => (
                                        <li key={r.id} className="flex items-center gap-4 px-5 py-3">
                                            {r.kind === 'image' && r.imageUrl ? (
                                                <img src={r.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-gray-200 bg-gray-50 object-contain" loading="lazy" />
                                            ) : (
                                                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs font-semibold text-gray-600">Aa</span>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-semibold text-gray-900">{r.kind === 'image' ? 'Blocked image' : r.term}</p>
                                                <p className="truncate text-xs text-gray-500">
                                                    {r.note ? `${r.note} · ` : ''}
                                                    {r.addedByName} · {when(r.createdAt)}
                                                </p>
                                            </div>
                                            <button onClick={() => void removeRule(r.id)} className="text-sm font-medium text-red-700 hover:underline">
                                                Remove
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {openId && <DisputeDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} />}
        </DashboardLayout>
    );
};
