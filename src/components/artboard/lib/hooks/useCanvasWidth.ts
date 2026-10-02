import { usePricingSettings } from "../../../../lib/utils/pricingRates";

export const useCanvasWidth = () => usePricingSettings().sheetWidthIn;
