import { StatCard } from './StatCard';
import { type StatCardItem, type StatsGridProps } from '../../types/dashboard';

const defaultCards: StatCardItem[] = [
  { title: "Total Orders", value: "24", trend: "+12%" },
  { title: "Completed Orders", value: "1,847", trend: "+8%" },
  { title: "Profit Earned", value: "382", trend: "+32%" },
  { title: "Total Revenue", value: "$45,293", trend: "+23%" },
];

export const StatsGrid = ({ cards = defaultCards }: StatsGridProps) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    {cards.map((c) => (
      <StatCard key={c.title} title={c.title} value={c.value} trend={c.trend} />
    ))}
  </div>
);
