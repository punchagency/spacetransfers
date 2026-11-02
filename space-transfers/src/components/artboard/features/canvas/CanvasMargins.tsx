import { CANVAS } from "../../../../config/artboard.config";

interface CanvasMarginsProps {
  showMargins: boolean;
  marginSize: number;
  /** The roll width, so the right-hand guide sits the margin in from the real edge. */
  sheetWidthIn: number;
  heightIn: number;
  isDarkBg?: boolean;
}

export default function CanvasMargins({ showMargins, marginSize, sheetWidthIn, heightIn, isDarkBg = false }: CanvasMarginsProps) {
  if (!showMargins) return null;

  const ppi = CANVAS.PIXELS_PER_INCH;
  const marginPx     = marginSize * ppi;
  const innerWidthPx = Math.max(0, sheetWidthIn - 2 * marginSize) * ppi;
  const innerHeightPx = Math.max(0, heightIn - marginSize) * ppi;

  const borderCls = isDarkBg ? 'border-white/60'  : 'border-red-500';
  const textCls   = isDarkBg ? 'text-white/70'    : 'text-red-500';

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 15 }}>
      <div
        className={`absolute border-t-2 border-l-2 border-r-2 border-dashed ${borderCls}`}
        style={{
          top:    `${marginPx}px`,
          left:   `${marginPx}px`,
          width:  `${innerWidthPx}px`,
          height: `${innerHeightPx}px`,
        }}
      />
      <div
        className={`absolute text-xs font-medium ${textCls}`}
        style={{
          top:         `${marginPx}px`,
          left:        `${marginPx}px`,
          paddingTop:  '4px',
          paddingLeft: '4px',
        }}
      >
        Safe Print Area ({marginSize}" margin)
      </div>
    </div>
  );
}
