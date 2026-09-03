export interface Partner {
  id: string;
  name: string;
  email: string;
  regions: string[];
  status: "Active" | "Pending" | "Suspended" | "Under Review" | "Rejected";
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
  status: "Active" | "Pending" | "Suspended" | "Under Review" | "Rejected";
  ordersCompleted: number;
  /** Null until the partner has shipped something — not zero, which would read as instant. */
  averageProductionHours?: number | null;
  /** Null until there is a finished job with a deadline to measure against. */
  onTimeDeliveryRate?: number | null;
  performanceSampleSize?: number;
  rating: number;
  /**
   * Recent status changes, newest first, with the reason and who made it.
   *
   * A suspended or rejected partner used to display a status and nothing else,
   * leaving the reason wherever the admin who decided it happened to remember.
   */
  /** Where they print from. Null when no address was ever captured. */
  address?: {
    street: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  } | null;
  statusHistory?: Array<{
    from: string | null;
    to: string;
    reason: string | null;
    at: string;
    by: string | null;
    notified: boolean;
  }>;
}

export interface PartnerSettingsApi {
  /** Null when this partner has no warehouse of their own; HQ is used instead. */
  shipStationWarehouseId?: number | null;
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

