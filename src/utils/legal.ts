/** The legal documents, as the console lists and edits them. */

export type LegalDocId = 'terms' | 'privacy' | 'content-policy';

export interface LegalListItem {
    id: LegalDocId;
    title: string;
    version: string;
    isDraft: boolean;
    url: string;
    publishedAt: string;
    hasDraft: boolean;
    versions: number;
}

export interface LegalVersionView {
    title: string;
    version: string | null;
    isDraft: boolean;
    body: string;
    note: string;
    byName: string;
    at: string;
}

export interface LegalAdminDocument {
    id: LegalDocId;
    current: LegalVersionView | null;
    draft: LegalVersionView | null;
    history: { version: string; title: string; isDraft: boolean; note: string; byName: string; at: string }[];
}

/**
 * Where the store publishes a document. VITE_STORE_URL names the store;
 * without it, the store is assumed to sit beside the console at "store." in
 * place of "admin.".
 */
export const storeOrigin = (env: string | undefined, here: string): string => {
    const configured = (env || '').trim().replace(/\/+$/, '');
    if (configured) return configured;
    try {
        const url = new URL(here);
        if (url.hostname.startsWith('admin.')) url.hostname = 'store.' + url.hostname.slice('admin.'.length);
        return url.origin;
    } catch {
        return '';
    }
};

export const publicLegalUrl = (id: LegalDocId) =>
    `${storeOrigin(import.meta.env.VITE_STORE_URL, typeof window === 'undefined' ? '' : window.location.origin)}/legal/${id}`;

/** Whether the text in the editor differs from what it was opened with. */
export const hasUnsavedChanges = (
    saved: { title: string; body: string; isDraft: boolean } | null,
    editing: { title: string; body: string; isDraft: boolean },
) => !saved || saved.title !== editing.title || saved.body.trim() !== editing.body.trim() || saved.isDraft !== editing.isDraft;
