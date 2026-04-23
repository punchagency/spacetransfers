export interface EarningsRow {
  name: string;
  sku: string;
  baseCost: number;
  markupPct: number;
  finalPrice: number;
  quantity: number;
  totalCost: number;
  totalRevenue: number;
  profit: number;
  profitMarginPct: number;
}

export interface ProfitMarginPillProps {
  value: number;
}
