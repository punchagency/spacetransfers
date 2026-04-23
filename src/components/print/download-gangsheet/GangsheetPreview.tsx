import { useEffect, useMemo, useRef, useState } from "react";

const VIEWPORT_SIZE_IN = 23.5;

export const GangsheetPreview = ({
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
          <div ref={viewportRef} className="relative w-full aspect-square border border-gray-200 rounded-xl bg-gray-50 overflow-auto">
            <div className="relative bg-white" style={innerStyle}>
              <div
                className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage: `linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)`,
                  backgroundSize: "20px 20px",
                  backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
                }}
              />

              {previewDataUrl ? (
                <img src={previewDataUrl} alt="Gangsheet preview" className="absolute top-0 left-0" style={imgStyle} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
                  Preview unavailable
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
