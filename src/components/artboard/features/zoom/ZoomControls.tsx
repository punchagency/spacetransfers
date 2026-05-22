import { MdZoomIn, MdZoomOut } from "react-icons/md";

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export default function ZoomControls({ zoom, onZoomIn, onZoomOut }: ZoomControlsProps) {
  return (
    <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-1 bg-white border border-gray-300 rounded-lg shadow-lg p-1">
      <button
        className="p-1 hover:bg-gray-100 rounded transition cursor-pointer"
        onClick={onZoomIn}
        title="Zoom In"
      >
        <MdZoomIn className="w-5 h-5 text-gray-700" />
      </button>
      <div className="text-xs text-center text-gray-600 font-medium">{Math.round(zoom * 100)}%</div>
      <button
        className="p-1 hover:bg-gray-100 rounded transition cursor-pointer"
        onClick={onZoomOut}
        title="Zoom Out"
      >
        <MdZoomOut className="w-5 h-5 text-gray-700" />
      </button>
    </div>
  );
}
