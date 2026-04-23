interface AssetStatsBarProps {
  selectedCount: number;
  totalSize: string;
  totalAssets: number;
  onToggleAll: () => void;
}

export const AssetStatsBar = ({
  selectedCount,
  totalSize,
  totalAssets,
  onToggleAll,
}: AssetStatsBarProps) => {
  return (
    <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between">
      <div className="flex items-center gap-8">
        <div>
          <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">
            Selected Files
          </span>
          <span className="text-xl font-bold text-gray-900">
            {selectedCount}
          </span>
        </div>
        <div className="w-px h-8 bg-gray-200" />
        <div>
          <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">
            Total Size
          </span>
          <span className="text-xl font-bold text-blue-600">
            {totalSize} MB
          </span>
        </div>
      </div>
      <button
        onClick={onToggleAll}
        className="text-sm font-bold text-blue-600 hover:text-blue-700"
      >
        {selectedCount === totalAssets ? "Deselect All" : "Select All"}
      </button>
    </div>
  );
};
