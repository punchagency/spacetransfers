export interface Partner {
  id: string;
  name: string;
  email: string;
  regions: string[];
  status: "Active" | "Pending" | "Suspended" | "Under Review" | "Rejected";
  /**
   * Whether the partner is currently taking work, as distinct from whether
   * their account is in good standing. A partner can be Active and Paused at
   * the same time — the account is fine, they just are not accepting jobs.
   */
  availabilityStatus: AvailabilityStatus;
  /** True when the capacity monitor paused them, not a person. */
  capacityPaused?: boolean;
  ordersInProgress: string;
  orders: string;
}

export type AvailabilityStatus = "open" | "paused";

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
  availabilityStatus: AvailabilityStatus;
  /** True when the system paused them for hitting their job limit, not a person. */
  capacityPaused?: boolean;
  /** Sole Proprietorship / Partnership / Corporation / LLC, as the partner declared it. */
  businessType?: string | null;
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

