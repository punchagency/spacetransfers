import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { apiFetch } from '../utils/api';
import { publicLegalUrl, type LegalListItem } from '../utils/legal';

const day = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** The Terms, Privacy Policy and Content Policy, with where each stands. */
export const LegalDocuments = () => {
    const [docs, setDocs] = useState<LegalListItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        apiFetch('/admin/legal')
            .then((data) => setDocs(data?.documents || []))
            .catch((e) => setError(e?.message || 'The documents could not be loaded.'));
    }, []);

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Legal documents</h1>
                    <p className="text-gray-500">
                        The documents customers and partners agree to when they sign up. Each sign-up records the version it accepted.
                    </p>
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                {!docs && !error && <p className="text-sm text-gray-500">Loading…</p>}
                <div className="grid gap-4 md:grid-cols-3">
                    {(docs || []).map((doc) => (
                        <div key={doc.id} className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                            <h2 className="text-base font-semibold text-gray-900">{doc.title}</h2>
                            <p className="mt-1 text-sm text-gray-500">
                                Version {doc.version} · published {day(doc.publishedAt)}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <span
                                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                        doc.isDraft ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                                    }`}
                                >
                                    {doc.isDraft ? 'Shown as draft' : 'Final'}
                                </span>
                                {doc.hasDraft && (
                                    <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">Unpublished changes</span>
                                )}
                            </div>
                            <div className="mt-auto flex flex-wrap items-center gap-3 pt-5">
                                <Link
                                    to={`/legal/${doc.id}`}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                                >
                                    {doc.hasDraft ? 'Continue editing' : 'Edit'}
                                </Link>
                                <a href={publicLegalUrl(doc.id)} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 hover:underline">
                                    View live page
                                </a>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </DashboardLayout>
    );
};
