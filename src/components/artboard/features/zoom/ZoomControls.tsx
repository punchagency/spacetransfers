import { MdZoomIn, MdZoomOut, MdFitScreen } from "react-icons/md";

/**
 * Zoom readout and controls.
 *
 * The percentage doubles as the AI command box's feedback surface: a spoken
 * "zoom to 150%" has to be visible somewhere, or the interface stops reflecting
 * the state the assistant just changed.
 *
 * "Fit" is a distinct mode rather than a zoom value — while active the board
 * keeps re-fitting to the window, so it is shown as an engaged state instead of
 * a number the user has to guess at.
 */

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  /** True while auto-fit is active (no explicit zoom pinned). */
  isFit: boolean;
}

export default function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  isFit,
}: ZoomControlsProps) {
  return (
    <div className="absolute bottom-4 right-4 z-20 flex flex-col items-stretch gap-1 rounded-lg border border-gray-300 bg-white p-1 shadow-lg">
      <button
        className="rounded p-1 transition hover:bg-gray-100 cursor-pointer"
        onClick={onZoomIn}
        title="Zoom in"
        aria-label="Zoom in"
      >
        <MdZoomIn className="h-5 w-5 text-gray-700" />
      </button>

      <div
        className="text-center text-xs font-medium text-gray-600 tabular-nums"
        aria-live="polite"
      >
        {Math.round(zoom * 100)}%
      </div>

      <button
        className="rounded p-1 transition hover:bg-gray-100 cursor-pointer"
        onClick={onZoomOut}
        title="Zoom out"
        aria-label="Zoom out"
      >
        <MdZoomOut className="h-5 w-5 text-gray-700" />
      </button>

      <button
        className={`rounded p-1 transition cursor-pointer ${
          isFit ? "bg-slate-900 text-white" : "text-gray-700 hover:bg-gray-100"
        }`}
        onClick={onZoomFit}
        title={isFit ? "Fitting to window" : "Zoom to fit"}
        aria-label="Zoom to fit"
        aria-pressed={isFit}
      >
        <MdFitScreen className="h-5 w-5" />
      </button>
    </div>
  );
}
