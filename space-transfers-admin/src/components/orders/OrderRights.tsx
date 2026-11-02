import { useState } from 'react';
import toast from 'react-hot-toast';
import { apiFetch } from '../../utils/api';

export interface OrderRightsRecord {
    checkedAt: string;
    attestedAt: string | null;
    checks: string[];
    images: {
        url: string;
        verdict: 'clear' | 'approved';
        incomplete?: boolean;
        approvals: { id: string; label: string; byName: string; at: string | null; note: string }[];
        notes: string[];
    }[];
}

export interface OrderRightsConcern {
    status: 'open' | 'cleared';
    note: string;
    reportedByName: string;
    at: string;
    resolvedByName?: string;
    resolvedAt?: string;
    resolution?: string;
}

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const CHECKS: Record<string, string> = { vision: 'Google Vision', claude: 'Claude' };

/**
 * The rights check as this order was placed: what was checked, which images an
 * admin approved and why, and any concern its partner raised.
 */
export const OrderRights = ({
    orderId,
    rights,
    concern,
    onChanged,
}: {
    orderId: string;
    rights?: OrderRightsRecord | null;
    concern?: OrderRightsConcern | null;
    onChanged: () => void;
}) => {
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    if (!rights && !concern) return null;

    const approved = (rights?.images || []).filter((i) => i.verdict === 'approved');
    const incomplete = (rights?.images || []).some((i) => i.incomplete);
    const notes = (rights?.images || []).flatMap((i) => i.notes);

    const clear = async () => {
        setBusy(true);
        try {
            await apiFetch(`/admin/orders/${orderId}/rights-concern/resolve`, { method: 'POST', body: JSON.stringify({ note: note.trim() }) });
            toast.success('Concern cleared; the partner can carry on');
            setNote('');
            onChanged();
        } catch (e: any) {
            toast.error(e?.message || 'The concern could not be cleared.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <section aria-labelledby="order-rights-h" className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
            <h2 id="order-rights-h" className="text-md font-bold text-gray-900">
                Rights check
            </h2>

            {concern?.status === 'open' && (
                <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-950">
                    <p className="font-semibold">On hold: {concern.reportedByName} raised a rights concern · {when(concern.at)}</p>
                    <p>{concern.note}</p>
                    <label htmlFor="rights-concern-note" className="sr-only">
                        Why it can be printed
                    </label>
                    <textarea
                        id="rights-concern-note"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder="Why it can be printed (sent to the partner). To stop it instead, cancel the order."
                        className="w-full resize-y rounded-lg border border-red-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                    <button
                        disabled={busy || note.trim().length < 10}
                        onClick={() => void clear()}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
                    >
                        Clear concern
                    </button>
                </div>
            )}
            {concern?.status === 'cleared' && (
                <p className="text-sm text-gray-600">
                    {concern.reportedByName}’s concern was cleared by {concern.resolvedByName} · {when(concern.resolvedAt)}: {concern.resolution}
                </p>
            )}

            {rights && (
                <div className="space-y-2 text-sm text-gray-700">
                    <p>
                        Checked {when(rights.checkedAt)}
                        {rights.checks.length ? ` with ${rights.checks.map((c) => CHECKS[c] || c).join(' and ')}` : ' (file details and blocked images only)'}
                        {rights.attestedAt ? '; the customer confirmed they have the rights.' : '.'}
                        {incomplete ? ' Some checks failed for some images, so the result rests on fewer checks.' : ''}
                    </p>
                    {approved.length === 0 ? (
                        <p className="text-gray-500">All {rights.images.length} image{rights.images.length === 1 ? '' : 's'} passed.</p>
                    ) : (
                        <ul className="space-y-2">
                            {approved.map((img) => (
                                <li key={img.url} className="flex gap-3">
                                    <img src={img.url} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-gray-200 bg-gray-50 object-contain" loading="lazy" />
                                    <div className="min-w-0 text-sm">
                                        {img.approvals.map((a) => (
                                            <p key={a.id}>
                                                <span className="font-medium text-gray-900">{a.label}</span> approved by {a.byName} · {when(a.at)}
                                                <span className="block text-xs text-gray-500">{a.note}</span>
                                            </p>
                                        ))}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                    {notes.length > 0 && <p className="text-xs text-gray-500">In the files’ details: {[...new Set(notes)].join(' · ')}</p>}
                </div>
            )}
        </section>
    );
};
