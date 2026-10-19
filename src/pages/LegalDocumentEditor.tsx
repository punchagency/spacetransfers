import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiArrowLeft } from 'react-icons/fi';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { LegalPreview } from '../components/legal/LegalPreview';
import { apiFetch } from '../utils/api';
import { hasUnsavedChanges, publicLegalUrl, type LegalAdminDocument, type LegalDocId } from '../utils/legal';
import { confirmLeave, setLeaveGuard } from '../utils/leaveGuard';
import { legalMarkupError } from '../utils/legalMarkup';

const when = (value: string) =>
    new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Editing one legal document: the text on the left, the page customers will
 * read on the right. Saving keeps a private draft; publishing makes it the
 * version every new sign-up accepts.
 */
export const LegalDocumentEditor = () => {
    const { docId } = useParams<{ docId: LegalDocId }>();
    const [doc, setDoc] = useState<LegalAdminDocument | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [isDraft, setIsDraft] = useState(true);
    const [busy, setBusy] = useState<'save' | 'discard' | 'publish' | null>(null);
    const [publishing, setPublishing] = useState(false);
    const [note, setNote] = useState('');
    const [noteError, setNoteError] = useState<string | null>(null);
    const [viewing, setViewing] = useState<{ version: string; title: string; body: string; isDraft: boolean } | null>(null);
    const [tab, setTab] = useState<'edit' | 'preview'>('edit');

    const load = useCallback(
        (next?: LegalAdminDocument) => {
            const apply = (d: LegalAdminDocument) => {
                setDoc(d);
                const source = d.draft || d.current;
                setTitle(source?.title || '');
                setBody(source?.body || '');
                setIsDraft(source ? source.isDraft : true);
            };
            if (next) return apply(next);
            apiFetch(`/admin/legal/${docId}`)
                .then(apply)
                .catch((e) => setLoadError(e?.message || 'The document could not be loaded.'));
        },
        [docId],
    );
    useEffect(() => load(), [load]);

    const saved = doc ? doc.draft || doc.current : null;
    const dirty = doc ? hasUnsavedChanges(saved, { title, body, isDraft }) : false;
    const problem = useMemo(() => legalMarkupError(body) || (title.trim() ? null : 'Give the document a title.'), [body, title]);

    // Leaving with unsaved wording asks first.
    useEffect(() => {
        if (!dirty) return;
        const warn = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        // Moving to another page of the console doesn't unload it, so the menus and links ask too.
        setLeaveGuard('Leave without saving? Your changes to this document will be lost.');
        const onLinkClick = (e: MouseEvent) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const link = (e.target as HTMLElement | null)?.closest('a[href]') as HTMLAnchorElement | null;
            if (!link || link.target === '_blank' || link.origin !== window.location.origin) return;
            if (link.pathname === window.location.pathname) return;
            if (!confirmLeave()) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        window.addEventListener('beforeunload', warn);
        document.addEventListener('click', onLinkClick, true);
        return () => {
            setLeaveGuard(null);
            window.removeEventListener('beforeunload', warn);
            document.removeEventListener('click', onLinkClick, true);
        };
    }, [dirty]);

    const saveDraft = async () => {
        if (problem) return toast.error(problem);
        setBusy('save');
        try {
            load(await apiFetch(`/admin/legal/${docId}/draft`, { method: 'PUT', body: JSON.stringify({ title, body, isDraft }) }));
            toast.success('Draft saved. Customers still see the published version.');
        } catch (e: any) {
            toast.error(e?.message || 'The draft could not be saved.');
        } finally {
            setBusy(null);
        }
    };

    const discardDraft = async () => {
        setBusy('discard');
        try {
            load(await apiFetch(`/admin/legal/${docId}/draft`, { method: 'DELETE' }));
            toast.success('Draft discarded.');
        } catch (e: any) {
            toast.error(e?.message || 'The draft could not be discarded.');
        } finally {
            setBusy(null);
        }
    };

    const publish = async () => {
        if (!note.trim()) {
            setNoteError('Say what changed in this version.');
            return;
        }
        setBusy('publish');
        try {
            const res = await apiFetch(`/admin/legal/${docId}/publish`, { method: 'POST', body: JSON.stringify({ title, body, isDraft, note: note.trim() }) });
            load(res.document);
            setPublishing(false);
            setNote('');
            toast.success(`Version ${res.version} published. New sign-ups accept it from now on.`, { duration: 7000 });
        } catch (e: any) {
            setNoteError(e?.message || 'The document could not be published.');
        } finally {
            setBusy(null);
        }
    };

    const viewVersion = async (version: string) => {
        try {
            setViewing(await apiFetch(`/admin/legal/${docId}/versions/${encodeURIComponent(version)}`));
        } catch (e: any) {
            toast.error(e?.message || 'That version could not be loaded.');
        }
    };

    if (loadError) {
        return (
            <DashboardLayout>
                <p className="text-sm text-red-600">{loadError}</p>
            </DashboardLayout>
        );
    }
    if (!doc) {
        return (
            <DashboardLayout>
                <p className="text-sm text-gray-500">Loading…</p>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <div className="space-y-5">
                <Link to="/legal" className="flex w-fit items-center gap-2 text-gray-600 hover:text-gray-900">
                    <FiArrowLeft />
                    <span className="font-medium">All legal documents</span>
                </Link>

                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="text-2xl font-bold text-gray-900">{doc.current?.title}</h1>
                        <p className="text-sm text-gray-500">
                            Live: version {doc.current?.version} ·{' '}
                            <a href={publicLegalUrl(doc.id)} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">
                                view the live page
                            </a>
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {doc.draft && (
                            <button
                                onClick={() => void discardDraft()}
                                disabled={busy !== null}
                                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                                {busy === 'discard' ? 'Discarding…' : 'Discard draft'}
                            </button>
                        )}
                        <button
                            onClick={() => void saveDraft()}
                            disabled={busy !== null || !dirty}
                            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                            {busy === 'save' ? 'Saving…' : dirty ? 'Save draft' : 'Draft saved'}
                        </button>
                        <button
                            onClick={() => {
                                if (problem) return void toast.error(problem);
                                setNoteError(null);
                                setPublishing(true);
                            }}
                            disabled={busy !== null}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            Publish
                        </button>
                    </div>
                </div>

                {doc.draft && (
                    <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                        You are editing an unpublished draft{doc.draft.byName ? `, last saved by ${doc.draft.byName}` : ''} on {when(doc.draft.at)}.
                        {doc.draft.note ? ` ${doc.draft.note}` : ''} Customers still see version {doc.current?.version}.
                    </p>
                )}

                <div className="flex gap-2 lg:hidden" role="tablist">
                    {(['edit', 'preview'] as const).map((t) => (
                        <button
                            key={t}
                            role="tab"
                            aria-selected={tab === t}
                            onClick={() => setTab(t)}
                            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === t ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white text-gray-700'}`}
                        >
                            {t === 'edit' ? 'Edit' : 'Preview'}
                        </button>
                    ))}
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                    <div className={`min-w-0 space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm ${tab === 'edit' ? '' : 'max-lg:hidden'}`}>
                        <div className="space-y-1.5">
                            <label htmlFor="legal-title" className="text-sm font-medium text-gray-700">
                                Title
                            </label>
                            <input
                                id="legal-title"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                maxLength={120}
                                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
                            />
                        </div>
                        <label htmlFor="legal-is-draft" className="flex cursor-pointer items-start gap-2 text-sm text-gray-700">
                            <input id="legal-is-draft" type="checkbox" checked={isDraft} onChange={(e) => setIsDraft(e.target.checked)} className="mt-0.5 h-4 w-4" />
                            <span>
                                Show as a draft
                                <span className="block text-xs text-gray-500">Untick once a lawyer has approved this wording. The page then stops saying it is a draft.</span>
                            </span>
                        </label>
                        <div className="space-y-1.5">
                            <label htmlFor="legal-body" className="text-sm font-medium text-gray-700">
                                Wording
                            </label>
                            <p id="legal-body-help" className="text-xs text-gray-500">
                                Start a section with <code className="rounded bg-gray-100 px-1">## </code> and a bullet with <code className="rounded bg-gray-100 px-1">- </code>.
                                Leave a blank line between paragraphs. Text before the first section is the introduction.
                            </p>
                            <textarea
                                id="legal-body"
                                aria-describedby="legal-body-help"
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                spellCheck
                                className="h-[60vh] min-h-[320px] w-full resize-y rounded-lg border border-gray-200 px-3 py-2.5 font-mono text-[13px] leading-relaxed focus:border-blue-500 focus:outline-none"
                            />
                            {problem && <p className="text-sm text-red-600">{problem}</p>}
                        </div>
                    </div>
                    <div className={`min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm ${tab === 'preview' ? '' : 'max-lg:hidden'}`}>
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Preview</p>
                        <div className="max-h-[70vh] overflow-y-auto pr-1" tabIndex={0} aria-label="Preview of the document">
                            <LegalPreview title={title} version={dirty || doc.draft ? null : doc.current?.version} isDraft={isDraft} body={body} />
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <h2 className="text-base font-semibold text-gray-900">Version history</h2>
                    <p className="mt-0.5 text-sm text-gray-500">Every version stays on record, so it is always clear what each person agreed to.</p>
                    <ul className="mt-3 divide-y divide-gray-100">
                        {doc.history.map((h, i) => (
                            <li key={h.version} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-gray-900">
                                        Version {h.version}
                                        {i === 0 && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Live</span>}
                                        {h.isDraft && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Shown as draft</span>}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {when(h.at)}
                                        {h.byName ? ` · ${h.byName}` : ''}
                                        {h.note ? ` · ${h.note}` : ''}
                                    </p>
                                </div>
                                <button onClick={() => void viewVersion(h.version)} className="text-sm font-medium text-blue-600 hover:underline">
                                    View
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {publishing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div role="dialog" aria-modal="true" aria-label="Publish this version" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                        <h3 className="text-lg font-bold text-gray-900">Publish this version?</h3>
                        <p className="mt-1 text-sm text-gray-500">
                            It goes live straight away and every new sign-up accepts it. People who signed up earlier keep their record of the version
                            they accepted.
                            {isDraft ? ' The page will still say it is a draft.' : ' The page will no longer say it is a draft.'}
                        </p>
                        <label htmlFor="legal-publish-note" className="mt-4 block text-sm font-medium text-gray-700">
                            What changed? <span className="font-normal text-gray-500">(required, kept in the history)</span>
                        </label>
                        <textarea
                            id="legal-publish-note"
                            value={note}
                            onChange={(e) => {
                                setNote(e.target.value);
                                setNoteError(null);
                            }}
                            rows={3}
                            maxLength={500}
                            placeholder="e.g. Wording approved by counsel; retention periods added."
                            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                        />
                        {noteError && (
                            <p role="alert" className="mt-1 text-sm text-red-600">
                                {noteError}
                            </p>
                        )}
                        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
                            <button onClick={() => setPublishing(false)} disabled={busy !== null} className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                                Cancel
                            </button>
                            <button onClick={() => void publish()} disabled={busy !== null} className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                                {busy === 'publish' ? 'Publishing…' : 'Publish'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {viewing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setViewing(null)}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Version ${viewing.version}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl"
                    >
                        <div className="overflow-y-auto p-6">
                            <LegalPreview title={viewing.title} version={viewing.version} isDraft={viewing.isDraft} body={viewing.body} />
                        </div>
                        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
                            <button
                                onClick={() => {
                                    setBody(viewing.body);
                                    setTitle(viewing.title);
                                    setIsDraft(viewing.isDraft);
                                    setViewing(null);
                                    toast('Loaded into the editor. Save or publish to use it.');
                                }}
                                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                Start from this version
                            </button>
                            <button onClick={() => setViewing(null)} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
};
