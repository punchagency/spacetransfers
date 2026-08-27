export interface Partner {
  id: string;
  name: string;
  email: string;
  regions: string[];
  status: "Active" | "Pending" | "Suspended" | "Under Review";
  ordersInProgress: string;
  orders: string;
}

export interface PartnerDetailsData {
  id: string;
  name: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  website?: string;
  regions: string[];
  status: "Active" | "Pending" | "Suspended" | "Under Review";
  ordersCompleted: number;
  /** Null until the partner has shipped something — not zero, which would read as instant. */
  averageProductionHours?: number | null;
  /** Null until there is a finished job with a deadline to measure against. */
  onTimeDeliveryRate?: number | null;
  performanceSampleSize?: number;
  rating: number;
}

export interface PartnerSettingsApi {
  jobCapacity?: { maxConcurrent?: number; dailyMax?: number; autoAccept?: boolean };
  notifications?: { orderAssigned: boolean; jobCompleted: boolean };
  capabilities?: { maxSheetSizeIn: { width: number; height: number }; formats: string[]; maxDPI: number };
}

export interface PartnerOrderRow {
    displayId?: string | null;
  id: string;
  status: string;
  customer: string;
  total: number;
  createdAt: string;
}

export interface PartnerHeaderProps {
  name: string;
  email: string;
  status: string;
}

export interface EditPartnerData {
  name: string;
  email: string;
  phone: string;
  region: string;
  status: string;
  notes?: string;
}

export interface Fee {
  id: number;
  name: string;
  value: string;
}

export interface PricingData {
  basePrintPrice: string;
  baseShippingPrice: string;
  extraFees: Fee[];
  markupType: string;
  markupAmount: string;
}

