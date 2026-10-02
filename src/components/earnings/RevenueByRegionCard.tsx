import { currency } from "../../utils/formatters";

export type RevenueByRegionRow = {
  region: string;
  value: number;
  percentage: number;
};

export const RevenueByRegionCard = ({ rows }: { rows: RevenueByRegionRow[] }) => {
  const data = rows || [];
  const maxValue = Math.max(1, ...data.map((r) => Number(r.value) || 0));
  const total = data.reduce((sum, r) => sum + (Number(r.value) || 0), 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 h-[393px] flex flex-col">
      <h3 className="text-sm font-semibold text-gray-900">Revenue by region</h3>
      <p className="text-xs text-gray-500 mt-0.5">Where the orders came from</p>

      {data.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-400">No revenue in this period</p>
        </div>
      ) : (
        <>
          <div className="mt-5 space-y-4 flex-1 overflow-y-auto">
            {data.map((r) => (
              <div key={r.region}>
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <span className="text-sm text-gray-900">{r.region}</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {/* Rendered as money. `toLocaleString` on the raw number
                        printed "586.2" — a currency figure with no symbol and a
                        missing second decimal place. */}
                    {currency(r.value)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full"
                      style={{ width: `${(Number(r.value) / maxValue) * 100}%` }}
                    />
                  </div>
                  {/* The server computes this share and nothing displayed it. */}
                  <span className="text-[11px] text-gray-500 w-10 text-right tabular-nums">
                    {r.percentage}%
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-200 pt-3 mt-3 flex items-baseline justify-between">
            <span className="text-xs text-gray-500">Total</span>
            <span className="text-sm font-semibold text-gray-900">{currency(total)}</span>
          </div>
        </>
      )}
    </div>
  );
};
