/** One gang sheet on a job; an order can hold several. */
export type JobSheet = {
  index: number;
  name: string;
  widthIn: number | null;
  heightIn: number | null;
  /** How many of this sheet to print. */
  quantity: number;
  itemCount: number;
};

/**
 * Chooses which of a job's sheets is previewed and exported.
 *
 * The preview and exports used to take an order's first sheet only, so on a
 * two-sheet order the second was never seen by the partner and never printed.
 * Renders nothing for a one-sheet job, so those screens look as they did.
 */
export function SheetPicker({
  sheets,
  value,
  onChange,
}: {
  sheets: JobSheet[];
  value: number;
  onChange: (index: number) => void;
}) {
  if (sheets.length < 2) return null;
  return (
    <div className="mb-4">
      <p className="mb-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        This order has {sheets.length} sheets. Export and print each one.
      </p>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Sheets on this order">
        {sheets.map((sh) => (
          <button
            key={sh.index}
            type="button"
            role="tab"
            aria-selected={sh.index === value}
            onClick={() => onChange(sh.index)}
            className={`rounded-lg border px-3 py-1.5 text-left text-xs transition-colors ${
              sh.index === value
                ? "border-indigo-600 bg-indigo-50 text-indigo-800"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            <span className="font-semibold">Sheet {sh.index + 1}</span>
            <span className="block max-w-[12rem] truncate">{sh.name}</span>
            <span className="block text-[11px] text-gray-500">
              {sh.widthIn && sh.heightIn ? `${sh.widthIn.toFixed(1)}" × ${sh.heightIn.toFixed(1)}"` : ""}
              {sh.quantity > 1 ? ` · print ${sh.quantity}` : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
