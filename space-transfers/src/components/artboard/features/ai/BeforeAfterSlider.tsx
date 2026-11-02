import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Before/after comparison with a draggable divider.
 *
 * The two images are stacked and the top one is clipped, rather than
 * cross-faded or shown side by side. That is the only arrangement where the two
 * versions occupy the *same* pixels on screen, which is what makes a subtle
 * difference — a fringe left along a cutout edge, a colour that shifted a
 * shade — actually visible. Side-by-side forces the eye to travel and
 * remember, and at artboard scale those are exactly the defects that get
 * missed and printed.
 */

interface BeforeAfterSliderProps {
  beforeUrl: string;
  afterUrl: string;
  /**
   * Checkerboard behind the images so transparency reads as transparency
   * rather than as white — the distinction is the entire point of a cutout.
   */
  showTransparencyGrid?: boolean;
  className?: string;
}

const CHECKER_LIGHT = "#ffffff";
const CHECKER_DARK = "#e9ecef";
const CHECKER_SIZE = 12;

export default function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  showTransparencyGrid = true,
  className = "",
}: BeforeAfterSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const [dragging, setDragging] = useState(false);

  const updateFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    setPosition(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  // Bound to the window, not the divider, so a fast drag that outruns the
  // pointer keeps tracking instead of dropping the moment the cursor leaves the
  // 12px handle. Attached only while dragging so there are no idle listeners.
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => updateFromClientX(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) updateFromClientX(touch.clientX);
    };
    const stop = () => setDragging(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stop);
    // Not passive: dragging the divider must not also scroll the page under it.
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", stop);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", stop);
    };
  }, [dragging, updateFromClientX]);

  const gridStyle = showTransparencyGrid
    ? {
        backgroundImage: `linear-gradient(45deg, ${CHECKER_DARK} 25%, transparent 25%),
           linear-gradient(-45deg, ${CHECKER_DARK} 25%, transparent 25%),
           linear-gradient(45deg, transparent 75%, ${CHECKER_DARK} 75%),
           linear-gradient(-45deg, transparent 75%, ${CHECKER_DARK} 75%)`,
        backgroundSize: `${CHECKER_SIZE * 2}px ${CHECKER_SIZE * 2}px`,
        backgroundPosition: `0 0, 0 ${CHECKER_SIZE}px, ${CHECKER_SIZE}px -${CHECKER_SIZE}px, -${CHECKER_SIZE}px 0px`,
        backgroundColor: CHECKER_LIGHT,
      }
    : undefined;

  return (
    <div
      ref={containerRef}
      className={`relative select-none overflow-hidden rounded-xl border border-gray-200 ${className}`}
      style={{ ...gridStyle, cursor: dragging ? "ew-resize" : "default", touchAction: "none" }}
      // Clicking anywhere jumps the divider there. Faster than dragging for the
      // common "show me all of the after" move, and it makes the whole image a
      // target instead of a thin handle.
      onMouseDown={(e) => {
        updateFromClientX(e.clientX);
        setDragging(true);
      }}
      onTouchStart={(e) => {
        const touch = e.touches[0];
        if (touch) updateFromClientX(touch.clientX);
        setDragging(true);
      }}
    >
      {/* After: the full-width base layer. The *before* is the one clipped, so
          the default view leads with the result the customer is judging. */}
      <img
        // Same CORS mode as the board, so neither leaves a cached copy the other can't read.
        crossOrigin="anonymous"
        src={afterUrl}
        alt="After the AI edit"
        draggable={false}
        className="block w-full"
        style={{ maxHeight: "48vh", objectFit: "contain" }}
      />

      {/* Before: same box, same object-fit, clipped to the divider. Both
          constraints are required — a different fit would scale the two images
          differently and the comparison would show a size change that isn't
          there. */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)`, ...gridStyle }}
      >
        <img
          // Same CORS mode as the board, so neither leaves a cached copy the other can't read.
          crossOrigin="anonymous"
          src={beforeUrl}
          alt="Before the AI edit"
          draggable={false}
          className="block w-full"
          style={{ maxHeight: "48vh", objectFit: "contain" }}
        />
      </div>

      {/* Labels, each fading out as its own side is squeezed away — a "Before"
          tag floating over a sliver of image is just clutter. */}
      <span
        className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white transition-opacity duration-150"
        style={{ opacity: position > 12 ? 1 : 0 }}
      >
        Before
      </span>
      <span
        className="pointer-events-none absolute right-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white transition-opacity duration-150"
        style={{ opacity: position < 88 ? 1 : 0 }}
      >
        After
      </span>

      {/* Divider + handle. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Compare before and after"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${Math.round(position)}% before`}
        // Keyboard control matters here beyond compliance: nudging by 2% is a
        // more precise way to inspect an edge than any drag, and Home/End flip
        // cleanly between the two full versions.
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setPosition((p) => Math.max(0, p - 2));
          else if (e.key === "ArrowRight") setPosition((p) => Math.min(100, p + 2));
          else if (e.key === "Home") setPosition(0);
          else if (e.key === "End") setPosition(100);
          else return;
          e.preventDefault();
        }}
        className="absolute top-0 bottom-0 z-10 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)] focus:outline-none"
        style={{ left: `${position}%`, cursor: "ew-resize" }}
      >
        <span
          className="absolute top-1/2 left-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white shadow-md transition-transform duration-150"
          style={{ transform: `translate(-50%, -50%) scale(${dragging ? 1.1 : 1})` }}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-gray-600" aria-hidden>
            <path d="M9 6 4 12l5 6M15 6l5 6-5 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </div>
  );
}
