import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { apiFetch } from '../utils/api';
import { formatOrderStatus } from '../utils/orderStatus';
import { issuePreview, type AdminIssue } from '../utils/refunds';

type Filter = 'open' | 'resolved' | 'all';

const FILTERS: { value: Filter; label: string }[] = [
    { value: 'open', label: 'Open' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'all', label: 'All' },
];

const when = (value: string) =>
    new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Every problem customers have reported, the ones waiting on a reply first. */
export const Issues = () => {
    const navigate = useNavigate();
    const [filter, setFilter] = useState<Filter>('open');
    const [issues, setIssues] = useState<AdminIssue[] | null>(null);
    const [counts, setCounts] = useState({ open: 0, waiting: 0 });
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        setIssues(null);
        const load = async () => {
            try {
                const data = await apiFetch(`/admin/issues?status=${filter}`);
                if (!alive) return;
                setIssues(data?.issues || []);
                setCounts(data?.counts || { open: 0, waiting: 0 });
                setError(null);
            } catch (e: any) {
                if (alive) setError(e?.message || 'The reports could not be loaded.');
            }
        };
        void load();
        const id = window.setInterval(() => void load(), 15000);
        return () => {
            alive = false;
            window.clearInterval(id);
        };
    }, [filter]);

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Issues</h1>
                    <p className="text-gray-500">
                        Problems customers have reported with their orders.
                        {counts.open > 0
                            ? ` ${counts.open} open${counts.waiting > 0 ? `, ${counts.waiting} waiting on a reply` : ''}.`
                            : ' Nothing is open.'}
                    </p>
                </div>

                <div role="tablist" className="flex gap-2">
                    {FILTERS.map((f) => (
                        <button
                            key={f.value}
                            role="tab"
                            aria-selected={filter === f.value}
                            onClick={() => setFilter(f.value)}
                            className={`rounded-lg px-4 py-2 text-sm font-medium ${
                                filter === f.value ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                            }`}
                        >
                            {f.label}
                            {f.value === 'open' && counts.open > 0 ? ` (${counts.open})` : ''}
                        </button>
                    ))}
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    {error ? (
                        <p className="p-8 text-center text-sm text-red-600">{error}</p>
                    ) : issues === null ? (
                        <div className="flex justify-center p-12">
                            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
                        </div>
                    ) : issues.length === 0 ? (
                        <p className="p-12 text-center text-sm text-gray-500">
                            {filter === 'open' ? 'No open reports. Customers raise them from Order History in the store.' : 'No reports here.'}
                        </p>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {issues.map((issue) => {
                                const resolved = issue.status === 'RESOLVED';
                                return (
                                    <li key={issue.id}>
                                        <button
                                            onClick={() => navigate(`/dashboard/orders/${issue.orderId}#issues`)}
                                            className="flex w-full flex-col gap-2 px-5 py-4 text-left hover:bg-gray-50 sm:flex-row sm:items-center sm:gap-4"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-sm font-semibold text-gray-900">{issue.displayId}</span>
                                                    <span className="text-sm text-gray-700">{issue.typeLabel}</span>
                                                    <span
                                                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                                            resolved ? 'bg-green-100 text-green-700' : issue.needsAdmin ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                                                        }`}
                                                    >
                                                        {resolved ? issue.resolution?.outcomeLabel || 'Resolved' : issue.needsAdmin ? 'Needs a reply' : 'Open'}
                                                    </span>
                                                </div>
                                                <p className="mt-1 truncate text-sm text-gray-500">{issuePreview(issue) || 'No details given.'}</p>
                                                <p className="mt-1 text-xs text-gray-500">
                                                    {issue.customerName}
                                                    {issue.partnerName ? ` · printed by ${issue.partnerName}` : ''} · order {formatOrderStatus(issue.orderStatus).toLowerCase()} · $
                                                    {issue.orderTotal.toFixed(2)}
                                                </p>
                                            </div>
                                            <span className="shrink-0 text-xs text-gray-500">{when(issue.updatedAt)}</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>
        </DashboardLayout>
    );
};
