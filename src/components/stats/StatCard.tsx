import { HiArrowTrendingDown, HiArrowTrendingUp } from "react-icons/hi2";
import { type StatCardProps } from "../../types/dashboard";

export const StatCard = ({ title, value, trend }: StatCardProps) => {
  const isNegative = trend.trim().startsWith("-");
  const TrendIcon = isNegative ? HiArrowTrendingDown : HiArrowTrendingUp;
  const trendClass = isNegative ? "text-red-500" : "text-green-600";

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
      <p className="text-sm text-gray-500">{title}</p>
      <div className="flex items-center mt-2">
        <h3 className="text-[36px] font-bold mr-2 text-gray-900">{value}</h3>
        {trend && (
          <span className={`flex items-center mt-3 gap-1 ${trendClass} text-[14px] font-medium`}>
            {trend}
            <TrendIcon className="w-4 h-4" />
          </span>
        )}
      </div>
    </div>
  );
};
