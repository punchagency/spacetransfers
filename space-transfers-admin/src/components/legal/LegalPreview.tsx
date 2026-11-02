import type { LegalBlock } from '../../utils/legalMarkup';
import { parseLegalMarkup } from '../../utils/legalMarkup';

/** The document as customers will read it, from the text being edited. */
export const LegalPreview = ({ title, version, isDraft, body }: { title: string; version?: string | null; isDraft: boolean; body: string }) => {
    const text = parseLegalMarkup(body);
    const blocks = (list: LegalBlock[]) =>
        list.map((b, i) =>
            b.type === 'p' ? (
                <p key={i} className="mt-2 text-sm leading-relaxed text-gray-700">
                    {b.text}
                </p>
            ) : (
                <ul key={i} className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-700">
                    {b.items.map((item, j) => (
                        <li key={j}>{item}</li>
                    ))}
                </ul>
            ),
        );
    return (
        <article className="min-w-0">
            <h2 className="text-xl font-bold text-gray-900">{title || 'Untitled'}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{version ? `Version ${version}` : 'Not yet published'}</p>
            {isDraft && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <strong>Draft.</strong> This document has not been finalised yet.
                </p>
            )}
            {text.intro.length > 0 && <div className="mt-3">{blocks(text.intro)}</div>}
            <div className="mt-4 space-y-4">
                {text.sections.map((s, i) => (
                    <section key={i}>
                        <h3 className="text-sm font-semibold text-gray-900">{s.heading}</h3>
                        {blocks(s.blocks)}
                    </section>
                ))}
            </div>
        </article>
    );
};
