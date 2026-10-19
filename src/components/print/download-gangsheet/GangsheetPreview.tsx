import { memo, useEffect, useMemo, useRef, useState, useCallback } from "react";

const VIEWPORT_SIZE_IN = 23.5;

const GangsheetPreviewComponent = ({
  previewDataUrl,
  sheetWidthIn,
  sheetHeightIn,
  showTitle = true,
}: {
  previewDataUrl?: string | null;
  sheetWidthIn?: number | null;
  sheetHeightIn?: number | null;
  showTitle?: boolean;
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportPx, setViewportPx] = useState(0);
  const [imgError, setImgError] = useState(false);

  // Reset error state whenever the URL changes so a corrected URL gets a fresh attempt.
  useEffect(() => { setImgError(false); }, [previewDataUrl]);

  const handleImgError = useCallback(() => setImgError(true), []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const update = () => setViewportPx(el.clientWidth);
    update();

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dims = useMemo(() => {
    const w =
      typeof sheetWidthIn === "number" && Number.isFinite(sheetWidthIn) && sheetWidthIn > 0
        ? sheetWidthIn
        : VIEWPORT_SIZE_IN;
    const h =
      typeof sheetHeightIn === "number" && Number.isFinite(sheetHeightIn) && sheetHeightIn > 0
        ? sheetHeightIn
        : VIEWPORT_SIZE_IN;
    return {
      sheetWIn: w,
      sheetHIn: h,
      innerWIn: Math.max(w, VIEWPORT_SIZE_IN),
      innerHIn: Math.max(h, VIEWPORT_SIZE_IN),
    };
  }, [sheetHeightIn, sheetWidthIn]);

  const pxPerIn = viewportPx > 0 ? viewportPx / VIEWPORT_SIZE_IN : 0;

  const innerStyle = pxPerIn
    ? { width: dims.innerWIn * pxPerIn, height: dims.innerHIn * pxPerIn }
    : { width: "100%", height: "100%" };
  const imgStyle = pxPerIn
    ? { width: dims.sheetWIn * pxPerIn, height: dims.sheetHIn * pxPerIn }
    : { width: "100%", height: "100%" };

  return (
    <div>
      {showTitle ? <h3 className="text-sm font-bold text-gray-900 mb-3">Gangsheet Preview</h3> : null}

      <div className="w-full flex justify-center">
        <div className="w-full max-w-[520px]">
          <div ref={viewportRef} tabIndex={0} role="region" aria-label="Sheet preview, scrollable" className="relative w-full aspect-square border border-gray-200 rounded-xl bg-gray-50 overflow-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <div className="relative bg-white" style={innerStyle}>
              <div
                className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage: `linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)`,
                  backgroundSize: "20px 20px",
                  backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
                }}
              />

              {previewDataUrl && !imgError ? (
                <img
                  src={previewDataUrl}
                  alt=""
                  decoding="async"
                  className="absolute top-0 left-0"
                  style={imgStyle}
                  onError={handleImgError}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
                  {imgError ? "Preview failed to load" : "Preview unavailable"}
                </div>
              )}

              <div className="absolute inset-0 border border-red-200 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// memo prevents re-rendering when the parent re-renders for unrelated reasons.
// The preview URL is the only thing that ever changes and it's already stable across polls.
export const GangsheetPreview = memo(GangsheetPreviewComponent);
