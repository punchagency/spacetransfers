import { StatCard } from './StatCard';
import { type StatsGridProps } from '../../types/dashboard';

/**
 * Renders skeletons while `cards` is undefined.
 *
 * This used to fall back to a hard-coded set — "24 orders, 1,847 completed,
 * $45,293 revenue" — which is what an admin saw both while loading and if the
 * request failed. Invented figures on a dashboard are worse than no figures:
 * they are indistinguishable from real ones, so a failed fetch looked like a
 * healthy business.
 */
const Skeleton = () => (
  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 animate-pulse">
    <div className="h-4 w-24 bg-gray-100 rounded" />
    <div className="h-9 w-20 bg-gray-100 rounded mt-3" />
    <div className="h-3 w-16 bg-gray-100 rounded mt-2" />
  </div>
);

export const StatsGrid = ({ cards }: StatsGridProps) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    {cards
      ? cards.map((c) => (
          <StatCard
            key={c.title}
            title={c.title}
            value={c.value}
            trendPct={c.trendPct}
            trendHint={c.trendHint}
            subtitle={c.subtitle}
          />
        ))
      : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} />)}
  </div>
);
