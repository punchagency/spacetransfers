export type ProfileTabId = "overview" | "business";

export interface PrinterProfile {
  name: string;
  businessName: string;
  email: string;
  phone: string;
  website: string;
  avatarUrl: string | null;
  regions: string[];
  status: string;
  memberSince: string;
  totalJobs: number;
  verificationStatus: {
    email: boolean;
    phone: boolean;
    business: boolean;
    document: boolean;
  };
  businessDetails: {
    businessType?: string;
    registrationNumber?: string;
    foundedDate?: string;
  };
  businessAddress: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    verified: boolean;
  };
  certifications: {
    name: string;
    authority: string;
    date: string;
    expiryDate?: string;
    verificationCode?: string;
    documentUrl?: string;
  }[];
  performance: {
    averageProductionHours: number | null;
    onTimeDeliveryRate: number | null;
    sampleSize: number;
    rating: number | null;
  };
}
