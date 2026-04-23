import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { currency } from "../../utils/formatters";

export type RevenueChartPoint = {
  label: string;
  current: number;
  previous: number;
};

export const RevenueChartCard = ({
  currentTotal,
  previousTotal,
  points,
}: {
  currentTotal: number;
  previousTotal: number;
  points: RevenueChartPoint[];
}) => {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 h-[393px] flex flex-col">
      <div className="flex items-center gap-4 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-900">Revenue</h3>
        <div className="text-gray-300">|</div>
        <div className="flex items-center gap-6 text-xs text-gray-700">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gray-900" />
            <span>
              Current Week{" "}
              <span className="font-semibold text-gray-900">
                {currency(currentTotal || 0)}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span>
              Previous Week{" "}
              <span className="font-semibold text-gray-900">
                {currency(previousTotal || 0)}
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 relative flex-1 w-full h-full min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            margin={{
              top: 20,
              right: 20,
              left: -20,
              bottom: 0,
            }}
          >
            <CartesianGrid vertical={false} stroke="#F3F4F6" />
            <XAxis
              dataKey="label"
              axisLine={{ stroke: "#E5E7EB" }}
              tickLine={false}
              tick={{ fill: "#9CA3AF", fontSize: 10 }}
              dy={10}
            />
            <YAxis
              axisLine={{ stroke: "#E5E7EB" }}
              tickLine={false}
              tick={{ fill: "#9CA3AF", fontSize: 10 }}
              tickFormatter={(value) => (value === 0 ? "0" : `${Number(value) / 1000}K`)}
            />
            <Tooltip
              cursor={{ stroke: "#111827", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-white p-2 border border-gray-200 shadow-lg rounded-lg">
                      <p className="text-gray-900 font-bold text-lg">
                        {currency(payload[0].value as number)}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Line
              type="monotone"
              dataKey="current"
              stroke="#111827"
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 5,
                fill: "#fff",
                stroke: "#111827",
                strokeWidth: 2,
              }}
            />
            <Line
              type="monotone"
              dataKey="previous"
              stroke="#3B82F6"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              activeDot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
