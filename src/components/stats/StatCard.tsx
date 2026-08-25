import { HiArrowTrendingDown, HiArrowTrendingUp, HiMinusSmall } from "react-icons/hi2";
import { type StatCardProps } from "../../types/dashboard";

/**
 * Direction is derived from the number, not from the formatted string.
 *
 * This previously did `trend.trim().startsWith("-")` and treated everything
 * else as growth — so a flat period would have rendered a green upward arrow.
 * It never actually showed one only because `0` is falsy and the caller
 * suppressed the whole element, which made "unchanged" indistinguishable from
 * "no data".
 */
export const StatCard = ({ title, value, trendPct, trendHint, subtitle }: StatCardProps) => {
  const hasTrend = typeof trendPct === "number";
  const direction = !hasTrend ? "none" : trendPct > 0 ? "up" : trendPct < 0 ? "down" : "flat";

  const TrendIcon =
    direction === "up" ? HiArrowTrendingUp : direction === "down" ? HiArrowTrendingDown : HiMinusSmall;

  const trendClass =
    direction === "up"
      ? "text-green-600"
      : direction === "down"
        ? "text-red-500"
        : "text-gray-400";

  // "+12.5%" / "-8%" / "0%" — the sign carries the direction, so no icon-only
  // ambiguity for anyone who cannot distinguish the colours.
  //
  // When there is nothing to compare against, this still renders something —
  // worded, not a bare dash, so it cannot be mistaken for a flat 0%. Hiding it
  // entirely put the explanation on an element that was never drawn, so the
  // one case that most needs explaining was the one you could not hover.
  const trendLabel = hasTrend ? `${trendPct > 0 ? "+" : ""}${trendPct}%` : "No prior data";

  // A card takes part in period comparison only if it was given a hint. Metrics
  // like Total Orders and Active Partners have no trend concept at all and must
  // stay bare — without this they would all read "No prior data".
  const participatesInTrend = hasTrend || Boolean(trendHint);

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
      <p className="text-sm text-gray-500">{title}</p>
      <div className="flex items-center mt-2">
        <h3 className="text-[36px] font-bold mr-2 text-gray-900">{value}</h3>
        {participatesInTrend && (
          <span
            className={`flex items-center mt-3 gap-1 ${trendClass} font-medium ${
              hasTrend ? "text-[14px]" : "text-[12px]"
            } ${trendHint ? "cursor-help" : ""}`}
            title={trendHint}
            aria-label={trendHint ? `${trendLabel}. ${trendHint}` : trendLabel}
          >
            {trendLabel}
            {hasTrend && <TrendIcon className="w-4 h-4" aria-hidden="true" />}
          </span>
        )}
      </div>
      {subtitle && <p className="text-xs text-gray-400 mt-1.5">{subtitle}</p>}
    </div>
  );
};
