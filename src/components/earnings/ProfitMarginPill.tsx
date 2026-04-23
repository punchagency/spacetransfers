import { type ProfitMarginPillProps } from "../../types/earnings";

export const ProfitMarginPill = ({ value }: ProfitMarginPillProps) => {
  const isGood = value >= 40;
  const className = isGood
    ? "bg-emerald-50 text-emerald-600"
    : "bg-amber-50 text-amber-600";

  return (
    <span
      className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${className}`}
    >
      {value.toFixed(2)}%
    </span>
  );
};
