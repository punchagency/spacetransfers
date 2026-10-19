import { FiFileText, FiImage, FiLayers } from "react-icons/fi";
import { useCallback, useRef, useState } from "react";
import { Asset } from "../../../data/assets";

interface AssetListProps {
  assets: Asset[];
  selectedAssets: Set<string>;
  onToggleAsset: (id: string) => void;
  isLoading?: boolean;
  isLoadingMore?: boolean;
}

// ITEM_HEIGHT must equal the total visual space per row including any gap.
// Box = 64px + mb-2 (8px margin-bottom) = 72px total.
// These two values must always sum to ITEM_HEIGHT.
const ITEM_HEIGHT = 72;      // total scroll-math height per item
const ITEM_BOX_HEIGHT = 64;  // actual div height (ITEM_HEIGHT - 8px gap)
const CONTAINER_HEIGHT = 400;
const OVERSCAN = 5;

const FiCheckIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const SKELETON_COUNT = Math.ceil(CONTAINER_HEIGHT / ITEM_HEIGHT) + 1;

// Varying widths make the skeleton look like real filenames, not a repeating pattern.
const SKELETON_WIDTHS = ["55%", "72%", "45%", "63%", "80%", "50%", "68%", "40%"];

export const AssetList = ({
  assets,
  selectedAssets,
  onToggleAsset,
  isLoading = false,
  isLoadingMore = false,
}: AssetListProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const handleScroll = useCallback(() => {
    setScrollTop(scrollRef.current?.scrollTop ?? 0);
  }, []);

  const count = assets.length;
  // Total scroll height = every item occupies exactly ITEM_HEIGHT px.
  const totalHeight = count * ITEM_HEIGHT;

  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    count - 1,
    Math.ceil((scrollTop + CONTAINER_HEIGHT) / ITEM_HEIGHT) + OVERSCAN,
  );

  const visibleAssets = assets.slice(startIndex, endIndex + 1);
  const paddingTop = startIndex * ITEM_HEIGHT;
  // Remaining space below the last rendered item.
  const paddingBottom = Math.max(0, totalHeight - (endIndex + 1) * ITEM_HEIGHT);

  const getFileIcon = (type: Asset["fileType"]) => {
    switch (type) {
      case "pdf":    return <FiFileText className="w-4 h-4 text-red-400" />;
      case "png":
      case "jpg":    return <FiImage className="w-4 h-4 text-blue-400" />;
      case "xlsx":   return <FiLayers className="w-4 h-4 text-green-400" />;
      default:       return <FiFileText className="w-4 h-4 text-gray-500" />;
    }
  };

  const ThumbnailOrIcon = ({ asset, isSelected }: { asset: Asset; isSelected: boolean }) => {
    if (asset.thumbnailUrl) {
      return (
        <img
          src={asset.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-full h-full object-contain rounded-md"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      );
    }
    return (
      <div className={`w-full h-full flex items-center justify-center ${isSelected ? "bg-white" : "bg-gray-50"} rounded-md`}>
        {getFileIcon(asset.fileType)}
      </div>
    );
  };

  const getTagColor = (type: Asset["type"]) => {
    switch (type) {
      case "artwork":    return "bg-purple-100 text-purple-700";
      case "preview":    return "bg-blue-100 text-blue-700";
      case "proofs":     return "bg-orange-100 text-orange-700";
      case "production": return "bg-gray-100 text-gray-700";
      case "documents":  return "bg-green-100 text-green-700";
      default:           return "bg-gray-100 text-gray-700";
    }
  };

  // Show skeleton rows immediately while the first page is being fetched.
  if (isLoading) {
    return (
      <div style={{ height: CONTAINER_HEIGHT }} className="overflow-hidden">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <div
            key={i}
            style={{
              height: ITEM_BOX_HEIGHT,
              marginBottom: ITEM_HEIGHT - ITEM_BOX_HEIGHT,
              boxSizing: "border-box",
              animationDelay: `${i * 60}ms`,
            }}
            className="flex items-center gap-3 px-3 rounded-xl border border-transparent"
          >
            <div className="w-4 h-4 rounded bg-gray-100 animate-pulse flex-shrink-0" />
            <div className="w-8 h-8 rounded-lg bg-gray-100 animate-pulse flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div
                className="h-3 bg-gray-100 rounded animate-pulse"
                style={{ width: SKELETON_WIDTHS[i % SKELETON_WIDTHS.length] }}
              />
              <div className="h-2.5 bg-gray-100 rounded animate-pulse w-1/5" />
            </div>
            <div className="w-12 h-4 rounded-full bg-gray-100 animate-pulse flex-shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  if (count === 0 && !isLoadingMore) {
    return (
      <div
        className="flex items-center justify-center text-sm text-gray-500"
        style={{ height: CONTAINER_HEIGHT }}
      >
        No assets found
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto pr-2 custom-scrollbar"
      style={{ height: CONTAINER_HEIGHT }}
      onScroll={handleScroll}
    >
      {/* top spacer — keeps items at the correct scroll position */}
      {paddingTop > 0 && (
        <div style={{ height: paddingTop, flexShrink: 0 }} />
      )}

      {visibleAssets.map((asset) => {
        const isSelected = selectedAssets.has(asset.id);
        return (
          <div
            key={asset.id}
            onClick={() => onToggleAsset(asset.id)}
            // height = ITEM_BOX_HEIGHT; marginBottom makes up the remaining 8px of ITEM_HEIGHT.
            style={{ height: ITEM_BOX_HEIGHT, marginBottom: ITEM_HEIGHT - ITEM_BOX_HEIGHT, boxSizing: "border-box" }}
            className={`flex items-center justify-between px-3 rounded-xl transition-all cursor-pointer group border ${
              isSelected
                ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                : "border-transparent hover:bg-gray-50 hover:border-gray-100"
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center transition-colors ${
                  isSelected
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-gray-300 bg-white group-hover:border-blue-400"
                }`}
              >
                {isSelected && <FiCheckIcon className="w-3 h-3" />}
              </div>
              <div
                className={`w-8 h-8 flex-shrink-0 rounded-lg overflow-hidden border transition-colors ${
                  isSelected ? "bg-white border-blue-200" : "bg-gray-50 border-gray-100"
                }`}
              >
                <ThumbnailOrIcon asset={asset} isSelected={isSelected} />
              </div>
              <div className="min-w-0">
                <h4
                  className={`text-sm font-semibold truncate leading-tight ${
                    isSelected ? "text-blue-900" : "text-gray-900"
                  }`}
                >
                  {asset.name}
                </h4>
                <p
                  className={`text-xs truncate leading-tight ${
                    isSelected ? "text-blue-600" : "text-gray-500"
                  }`}
                >
                  {asset.size}
                </p>
              </div>
            </div>
            <span
              className={`flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full capitalize ml-2 ${getTagColor(
                asset.type,
              )}`}
            >
              {asset.type}
            </span>
          </div>
        );
      })}

      {/* bottom spacer — keeps the scrollbar sized correctly */}
      {paddingBottom > 0 && (
        <div style={{ height: paddingBottom, flexShrink: 0 }} />
      )}

      {/* skeleton rows — visible while more assets load in background */}
      {isLoadingMore && (
        <>
          {[0, 1, 2].map((i) => (
            <div
              key={`skel-${i}`}
              style={{ height: ITEM_BOX_HEIGHT, marginBottom: ITEM_HEIGHT - ITEM_BOX_HEIGHT, boxSizing: "border-box" }}
              className="flex items-center gap-3 px-3 rounded-xl border border-transparent"
            >
              <div className="w-4 h-4 rounded bg-gray-100 animate-pulse flex-shrink-0" />
              <div className="w-8 h-8 rounded-lg bg-gray-100 animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-gray-100 rounded animate-pulse w-2/3" />
                <div className="h-2.5 bg-gray-100 rounded animate-pulse w-1/4" />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
};
