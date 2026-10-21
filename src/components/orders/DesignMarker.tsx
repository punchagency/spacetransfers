import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/utils/api";

interface SheetDesign {
  index: number;
  name: string;
  imageUrl: string | null;
  copies: number;
  imageW: number;
  imageH: number;
  rotation: number;
  flipped: boolean;
  centers: { x: number; y: number }[];
}

interface SheetDesigns {
  index: number;
  name: string;
  widthIn: number;
  heightIn: number;
  designs: SheetDesign[];
}

export interface MarkedDesign {
  sheet: number;
  design: number;
}

const keyOf = (sheet: number, design: number) => `${sheet}:${design}`;

/**
 * The customer's sheet as it printed, where they tap the designs that came out
 * wrong. Every copy of a design lights up together. The list underneath does
 * the same from the keyboard.
 */
export default function DesignMarker({
  orderId,
  marked,
  onChange,
}: {
  orderId: string;
  marked: MarkedDesign[];
  onChange: (next: MarkedDesign[]) => void;
}) {
  const [sheets, setSheets] = useState<SheetDesigns[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let alive = true;
    apiFetch(`/customer/orders/${orderId}/designs`)
      .then((res) => alive && setSheets(res?.sheets || []))
      .catch((err: any) => alive && setError(err?.message || "Your sheet couldn't be loaded."));
    return () => {
      alive = false;
    };
  }, [orderId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!sheets) return <p className="text-xs text-gray-500">Loading your sheet…</p>;
  const sheet = sheets[Math.min(active, sheets.length - 1)];
  if (!sheet) return <p className="text-xs text-gray-500">There are no designs to mark on this order.</p>;

  const chosen = new Set(marked.map((m) => keyOf(m.sheet, m.design)));
  const toggle = (design: number) => {
    const key = keyOf(sheet.index, design);
    onChange(chosen.has(key) ? marked.filter((m) => keyOf(m.sheet, m.design) !== key) : [...marked, { sheet: sheet.index, design }]);
  };
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div className="space-y-2">
      {sheets.length > 1 && (
        <div role="tablist" aria-label="Sheets" className="flex flex-wrap gap-1">
          {sheets.map((s, i) => (
            <button
              key={s.index}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${i === active ? "bg-slate-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-[repeating-conic-gradient(#f3f4f6_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]" aria-hidden>
        <div className="relative w-full" style={{ aspectRatio: `${sheet.widthIn} / ${sheet.heightIn}` }}>
          {sheet.designs.map((d) => {
            const on = chosen.has(keyOf(sheet.index, d.index));
            return d.centers.map((c, n) => (
              <div
                key={`${d.index}-${n}`}
                onClick={() => toggle(d.index)}
                title={d.name}
                className={`absolute cursor-pointer ${on ? "outline-2 outline-red-600 bg-red-500/20" : "hover:outline hover:outline-1 hover:outline-gray-400"}`}
                style={{
                  left: pct(c.x - d.imageW / 2, sheet.widthIn),
                  top: pct(c.y - d.imageH / 2, sheet.heightIn),
                  width: pct(d.imageW, sheet.widthIn),
                  height: pct(d.imageH, sheet.heightIn),
                  transform: `rotate(${d.rotation}deg)${d.flipped ? " scaleX(-1)" : ""}`,
                }}
              >
                {d.imageUrl && <img src={d.imageUrl} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-fill" />}
              </div>
            ));
          })}
        </div>
      </div>
      <ul className="max-h-44 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200" aria-label={`Designs on ${sheet.name}`}>
        {sheet.designs.map((d) => {
          const id = `mark-${sheet.index}-${d.index}`;
          return (
            <li key={d.index}>
              <label htmlFor={id} className="flex cursor-pointer items-center gap-3 px-3 py-2">
                <input
                  id={id}
                  type="checkbox"
                  checked={chosen.has(keyOf(sheet.index, d.index))}
                  onChange={() => toggle(d.index)}
                  className="h-4 w-4 shrink-0 accent-slate-900"
                />
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-gray-200 bg-gray-50">
                  {d.imageUrl && <img src={d.imageUrl} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-gray-900">{d.name}</span>
                  <span className="block text-xs text-gray-500">{d.copies === 1 ? "1 copy" : `${d.copies} copies`}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
