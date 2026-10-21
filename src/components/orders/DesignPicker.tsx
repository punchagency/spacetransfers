import { useState } from 'react';

export interface SheetDesign {
    index: number;
    name: string;
    imageUrl: string | null;
    copies: number;
    imageW: number;
    imageH: number;
    rotation: number;
    flipped: boolean;
    centers: { x: number; y: number }[];
    widthIn: number;
    heightIn: number;
}

export interface SheetDesigns {
    index: number;
    name: string;
    widthIn: number;
    heightIn: number;
    designs: SheetDesign[];
}

export const designKey = (sheet: number, design: number) => `${sheet}:${design}`;

/**
 * A sheet drawn as it prints, where a click picks a design and every copy of
 * it lights up. The list underneath does the same from the keyboard, and sets
 * how many copies to reprint.
 */
export const DesignPicker = ({
    sheets,
    picked,
    onPick,
    marked,
}: {
    sheets: SheetDesigns[];
    /** Copies chosen, by `designKey`; missing or zero is not chosen. */
    picked: Record<string, number>;
    onPick: (key: string, copies: number) => void;
    /** Designs the customer marked as affected. */
    marked?: Set<string>;
}) => {
    const [active, setActive] = useState(0);
    const sheet = sheets[Math.min(active, sheets.length - 1)];
    if (!sheet) return <p className="text-xs text-gray-500">This order has no designs to choose from.</p>;
    const pct = (v: number, of: number) => `${(v / of) * 100}%`;
    const toggle = (d: SheetDesign) => {
        const key = designKey(sheet.index, d.index);
        onPick(key, (picked[key] ?? 0) > 0 ? 0 : d.copies);
    };

    return (
        <div className="space-y-2">
            {sheets.length > 1 && (
                <div role="tablist" aria-label="Sheets" className="flex flex-wrap gap-1">
                    {sheets.map((s, i) => {
                        const count = s.designs.filter((d) => (picked[designKey(s.index, d.index)] ?? 0) > 0).length;
                        return (
                            <button
                                key={s.index}
                                type="button"
                                role="tab"
                                aria-selected={i === active}
                                onClick={() => setActive(i)}
                                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${i === active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                            >
                                {s.name}
                                {count > 0 ? ` · ${count}` : ''}
                            </button>
                        );
                    })}
                </div>
            )}

            <div className="max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-[repeating-conic-gradient(#f3f4f6_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]" aria-hidden>
                <div className="relative w-full" style={{ aspectRatio: `${sheet.widthIn} / ${sheet.heightIn}` }}>
                    {sheet.designs.map((d) => {
                        // As many copies light up as will be reprinted.
                        const chosen = picked[designKey(sheet.index, d.index)] ?? 0;
                        return d.centers.map((c, n) => (
                            <div
                                key={`${d.index}-${n}`}
                                onClick={() => toggle(d)}
                                title={d.name}
                                className={`absolute cursor-pointer ${
                                    n < chosen
                                        ? 'outline-2 outline-blue-600 bg-blue-500/15'
                                        : chosen > 0
                                          ? 'outline outline-1 outline-dashed outline-blue-400'
                                          : 'hover:outline hover:outline-1 hover:outline-gray-400'
                                }`}
                                style={{
                                    left: pct(c.x - d.imageW / 2, sheet.widthIn),
                                    top: pct(c.y - d.imageH / 2, sheet.heightIn),
                                    width: pct(d.imageW, sheet.widthIn),
                                    height: pct(d.imageH, sheet.heightIn),
                                    transform: `rotate(${d.rotation}deg)${d.flipped ? ' scaleX(-1)' : ''}`,
                                }}
                            >
                                {d.imageUrl && <img src={d.imageUrl} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-fill" />}
                            </div>
                        ));
                    })}
                </div>
            </div>
            <p className="text-xs text-gray-500">Click a design on the sheet, or tick it below. Every copy of it is highlighted.</p>

            <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200" aria-label={`Designs on ${sheet.name}`}>
                {sheet.designs.map((d) => {
                    const key = designKey(sheet.index, d.index);
                    const qty = picked[key] ?? 0;
                    const on = qty > 0;
                    const id = `design-${key.replace(':', '-')}`;
                    return (
                        <li key={key} className="flex items-center gap-3 px-3 py-2">
                            <input
                                id={id}
                                type="checkbox"
                                checked={on}
                                onChange={(e) => onPick(key, e.target.checked ? d.copies : 0)}
                                className="h-4 w-4 shrink-0 rounded border-gray-300 accent-blue-600"
                            />
                            <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-gray-200 bg-gray-50">
                                    {d.imageUrl && <img src={d.imageUrl} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />}
                                </span>
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium text-gray-900">{d.name}</span>
                                    <span className="block text-xs text-gray-500">
                                        {d.widthIn.toFixed(1)} × {d.heightIn.toFixed(1)} in · {d.copies} {d.copies === 1 ? 'copy' : 'copies'}
                                        {marked?.has(key) ? ' · marked by the customer' : ''}
                                    </span>
                                </span>
                            </label>
                            {d.copies > 1 && (
                                <div className={`flex shrink-0 items-center rounded-lg border border-gray-200 ${on ? '' : 'opacity-40'}`}>
                                    <button
                                        type="button"
                                        disabled={!on || qty <= 1}
                                        onClick={() => onPick(key, qty - 1)}
                                        aria-label={`One fewer copy of ${d.name}`}
                                        className="h-8 w-8 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                                    >
                                        −
                                    </button>
                                    <span className="w-7 text-center text-sm tabular-nums" aria-label={`${qty} copies of ${d.name}`}>
                                        {qty}
                                    </span>
                                    <button
                                        type="button"
                                        disabled={!on || qty >= d.copies}
                                        onClick={() => onPick(key, qty + 1)}
                                        aria-label={`One more copy of ${d.name}`}
                                        className="h-8 w-8 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                                    >
                                        +
                                    </button>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};
