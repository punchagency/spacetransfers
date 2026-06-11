interface AssetStatsBarProps {
  selectedCount: number;
  totalSize: string;
  loadedAssets: number;
  totalAssets: number;
  onToggleAll: () => void;
  isLoadingMore?: boolean;
}

export const AssetStatsBar = ({
  selectedCount,
  totalSize,
  loadedAssets,
  totalAssets,
  onToggleAll,
  isLoadingMore = false,
}: AssetStatsBarProps) => {
  const allLoaded = !isLoadingMore;
  const selectAllLabel = selectedCount === loadedAssets && loadedAssets > 0
    ? "Deselect All"
    : `Select All${totalAssets > 0 ? ` (${totalAssets.toLocaleString()})` : ""}`;

  return (
    <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between">
      <div className="flex items-center gap-8">
        <div>
          <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">
            Selected
          </span>
          <span className="text-xl font-bold text-gray-900">
            {selectedCount.toLocaleString()}
          </span>
        </div>
        <div className="w-px h-8 bg-gray-200" />
        <div>
          <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">
            Total Size
          </span>
          <span className="text-xl font-bold text-blue-600">{totalSize}</span>
        </div>
        <div className="w-px h-8 bg-gray-200" />
        <div>
          <span className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">
            {allLoaded ? "Files" : "Loaded"}
          </span>
          <span className="text-xl font-bold text-gray-900">
            {loadedAssets.toLocaleString()}
            {!allLoaded && totalAssets > loadedAssets && (
              <span className="text-sm font-normal text-gray-400">
                {" "}/ {totalAssets.toLocaleString()}
              </span>
            )}
          </span>
        </div>
      </div>
      <button
        onClick={onToggleAll}
        className="text-sm font-bold text-blue-600 hover:text-blue-700 disabled:opacity-40"
        disabled={loadedAssets === 0}
      >
        {selectAllLabel}
      </button>
    </div>
  );
};
 