import { usePricingSettings } from "../../../../lib/utils/pricingRates";

/**
 * The roll width, from the same live settings billing reads.
 *
 * This returned a fixed 23.5 while billing followed the admin setting, so
 * changing the roll width in admin would have billed one width and laid out —
 * and printed — another. One number, everywhere.
 */
export const useCanvasWidth = () => usePricingSettings().sheetWidthIn;
