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
} as const;

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
  PRICE_PER_SQ_FT: 3.5,
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
