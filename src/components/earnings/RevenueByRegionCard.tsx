import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from "react-simple-maps";

export type RevenueByRegionRow = {
  region: string;
  value: number;
  percentage: number;
};

export const RevenueByRegionCard = ({
  rows,
}: {
  rows: RevenueByRegionRow[];
}) => {
  // Marker locations: [longitude, latitude]
  const markers: Array<{ coordinates: [number, number] }> = [
    { coordinates: [-120, 37] }, // West Coast US (California)
    { coordinates: [-74, 40] }, // East Coast US (Northeast)
    { coordinates: [100, 0] }, // Southeast Asia (Malay Peninsula/Indonesia)
    { coordinates: [135, -35] }, // Southern Australia
  ];

  const geoUrl =
    "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

  const maxValue = Math.max(1, ...(rows || []).map((r) => Number(r.value) || 0));
  const displayRows = (rows || []).slice(0, 5);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 w-[292px] h-[393px] flex flex-col">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">
        Revenue by Region
      </h3>

      {/* World Map with exact styling from image */}
      <div className="rounded-lg border border-gray-100 p-2 bg-white overflow-hidden">
        <ComposableMap
          projectionConfig={{ scale: 80 }}
          width={260}
          height={120}
          style={{ width: "100%", height: "auto" }}
        >
          <Geographies geography={geoUrl}>
            {({ geographies }: { geographies: { rsmKey: string }[] }) =>
              geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="#93B4FF"
                  stroke="#FFFFFF"
                  strokeWidth={0.5}
                />
              ))
            }
          </Geographies>
          {markers.map((marker, index) => (
            <Marker key={index} coordinates={marker.coordinates}>
              <circle r={3} fill="#111827" stroke="#FFFFFF" strokeWidth={1.5} />
            </Marker>
          ))}
        </ComposableMap>
      </div>

      <div className="mt-4 space-y-4">
        {displayRows.length === 0 ? (
          <div className="text-sm text-gray-400 italic">No region data</div>
        ) : (
          displayRows.map((r) => (
            <div key={r.region}>
            <div className="text-sm text-gray-900 mb-1">
              {r.region} <span className="font-semibold">{r.value.toLocaleString()}</span>
            </div>
            <div className="h-[2px] bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600"
                style={{ width: `${(Number(r.value) / maxValue) * 100}%` }}
              />
            </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
