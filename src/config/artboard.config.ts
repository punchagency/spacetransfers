// Zoom configuration
export const ZOOM = {
  MIN: 0.5,
  MAX: 3,
  STEP: 0.1,
  WHEEL_FACTOR_IN: 1.05,
  WHEEL_FACTOR_OUT: 0.95,
} as const;

// Canvas configuration
export const CANVAS = {
  PIXELS_PER_INCH: 96,
  SHEET_WIDTH_IN: 23.5,
  SHEET_HEIGHT_IN: 23.5,
  DEFAULT_MARGIN: 0.15,
  DEFAULT_SPACING: 0.1,
  TOP_CENTER_Y: 1.0,
  RULER_OFFSET_PX: 32,
  GRID_GAP_IN: 0.06,
  SELECTION_BUFFER_IN: 0.084,
  /**
   * Absolute safety ceiling on placements — NOT the product limit.
   *
   * How much artwork a sheet holds is governed by its length
   * (`MAX_SHEET_HEIGHT_IN`), not by a count: see `isSheetFull`. This value
   * exists only so a pathological input cannot exhaust browser memory, and it
   * is set high enough that ordinary work never meets it.
   *
   * It used to be 1200, which was the *effective* limit and cut sheets far
   * short of their advertised length — measured, a sheet of 2in artwork was
   * stopped at ~166in of a possible 1200in, using 14% of the sheet. Worse, it
   * read as a length limit because the sheet maximum is also "1200" (inches),
   * which is exactly how it was reported as a bug.
   *
   * 80,000 is above what 1200in can hold even for very small artwork
   * (~76,000 half-inch placements), so the length limit is always the one that
   * binds. The packer was measured at 72ms for 80,000 items, and the canvas
   * virtualizes, so render cost tracks the viewport rather than this number.
   */
  MAX_ITEMS: 80_000,
} as const;

/**
 * Maximum sheet LENGTH in inches (100 feet).
 *
 * Was a bare `1200` literal repeated across six files. Centralised so the
 * length limit has exactly one definition and cannot drift from the layout
 * packer, the drop clamp, the item drag bounds or the canvas extent.
 */
export const MAX_SHEET_HEIGHT_IN = 1200;

/**
 * File types the artboard can read, as MIME types.
 *
 * Single source for the drop filter, the file-picker `accept` attribute and
 * the "unsupported file" notice. These had drifted: the drop handler accepted
 * PDF while the browse dialog's `accept` omitted it, so the same file could be
 * added by dragging but not by browsing.
 */
export const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "application/pdf",
] as const;

/**
 * Margin values the sidebar dropdown offers.
 *
 * Shared with the AI command executor so a spoken margin ("set the margin to
 * 0.75") snaps to a value the `<select>` can actually display — otherwise the
 * control renders blank and the sidebar stops reflecting the real state.
 */
/**
 * Selectable margins. `CANVAS.DEFAULT_MARGIN` must be one of them.
 *
 * It was not: the editor ran at 0.15in while the options were 0.25, 0.5 and 1.0,
 * so the select's value matched nothing — it could not show the margin in use,
 * the default could not be chosen back once changed, and the list labelled 0.25
 * "(Default)" when the default was 0.15.
 */
export const MARGIN_OPTIONS = [0.15, 0.25, 0.5, 1.0] as const;

/**
 * Canvas background swatches, mirroring the sidebar palette. `aliases` are the
 * words a user might speak for each; they exist so "dark", "charcoal" and
 * "dark gray" all resolve to the same swatch the sidebar will highlight.
 */
export const CANVAS_BACKGROUNDS: Array<{
  id: string;
  label: string;
  aliases: string[];
}> = [
  { id: "transparent", label: "Transparent", aliases: ["transparent", "checkerboard", "checkered", "none"] },
  { id: "#ffffff", label: "White", aliases: ["white"] },
  { id: "#f3f4f6", label: "Light Gray", aliases: ["light gray", "light grey", "light"] },
  { id: "#9ca3af", label: "Gray", aliases: ["gray", "grey"] },
  { id: "#4b5563", label: "Dark Gray", aliases: ["dark gray", "dark grey", "dark", "charcoal"] },
  { id: "#111827", label: "Black", aliases: ["black"] },
  { id: "#ef4444", label: "Red", aliases: ["red"] },
  { id: "#f59e0b", label: "Amber", aliases: ["amber", "orange", "yellow"] },
  { id: "#22c55e", label: "Green", aliases: ["green"] },
  { id: "#6366f1", label: "Indigo", aliases: ["indigo", "blue"] },
  { id: "#a855f7", label: "Purple", aliases: ["purple", "violet"] },
  { id: "#ec4899", label: "Pink", aliases: ["pink", "magenta"] },
  { id: "rainbow", label: "Rainbow", aliases: ["rainbow", "gradient"] },
];

// Unit configuration
export const UNIT = {
  INCH: {
    LABEL: "in",
    DECIMALS: 2,
  },
  PIXEL: {
    LABEL: "px",
    DECIMALS: 0,
  },
} as const;

// DPI configuration
export const DPI = {
  THRESHOLD: 300,
  DEFAULT: 150,
  WARNING_DURATION: 8000,
} as const;

// Animation configuration
export const ANIMATION = {
  DROP_DELAY: 50,
  BOUNCE_DELAY: 400,
  POSITION_DURATION: 0.6,
  BOUNCE_DURATION: 0.2,
  BOUNCE_OFFSET: 0.3,
  SHAKE_DURATION: 0.1,
  SHAKE_DISTANCE: 5,
  SHAKE_REPEATS: 3,
  GRAVITY_DURATION: 0.8,
  NORMAL_DURATION: 0.3,
  ZOOM_TRANSITION: "200ms",
} as const;

// Pricing configuration
export const PRICING = {
  DEFAULT_ITEM_PRICE: 12.34,
  /**
   * Only used until the live rate arrives from `GET /customer/pricing`, which
   * is the authority — see `lib/utils/pricingRates`. Read it through
   * `usePricePerSqFt()`, never directly: this constant priced every order
   * until the admin's Retail Pricing field was wired up, and reading it again
   * would quietly restore that.
   */
  FALLBACK_PRICE_PER_SQ_FT: 3.5,
  SQUARE_INCHES_PER_SQ_FT: 144,
} as const;

// Grid configuration
export const GRID = {
  SIZE: 20,
  SMALL_GRID_DIVISOR: 0.5,
} as const;

// Item constraints
export const ITEM = {
  MIN_SIZE: 0.5,
  DUPLICATE_OFFSET: 0.5,
} as const;
