import mongoose, { Document, Schema } from "mongoose";

export enum UserRole {
  CUSTOMER = "CUSTOMER",
  PRINTER = "PRINTER",
  ADMIN = "ADMIN"
}

export const UserRoles = {
  CUSTOMER: UserRole.CUSTOMER,
  PRINTER: UserRole.PRINTER,
  ADMIN: UserRole.ADMIN
};

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  companyName?: string;
  website?: string;
  regions?: string[];
  status: string;
  rating: number;
  phone?: string;
  avatarUrl?: string | null;
  settings: {
    businessHours?: {
      monday?: { isOpen: boolean; start: string; end: string };
      tuesday?: { isOpen: boolean; start: string; end: string };
      wednesday?: { isOpen: boolean; start: string; end: string };
      thursday?: { isOpen: boolean; start: string; end: string };
      friday?: { isOpen: boolean; start: string; end: string };
      saturday?: { isOpen: boolean; start: string; end: string };
      sunday?: { isOpen: boolean; start: string; end: string };
    };
    jobCapacity?: {
      maxConcurrent?: number;
      dailyMax?: number;
      autoAccept?: boolean;
    };
    notifications?: {
      email?: {
        newJobs?: boolean;
        jobUpdates?: boolean;
        payoutAlerts?: boolean;
        systemAlerts?: boolean;
      };
      sms?: {
        urgentJobs?: boolean;
        payoutComplete?: boolean;
      };
    };
    paymentMethod?: {
      type?: "bank_transfer" | "paypal" | "check";
      accountNumber?: string;
      routingNumber?: string;
      paypalEmail?: string;
    };
    printingCapabilities?: {
      maxSheetSizeIn?: { width: number; height: number };
      supportedInks?: string[];
      supportedFilms?: string[];
      supportedFormats?: string[];
      maxResolutionDPI?: number;
    };
    pricing?: {
      baseRatePerSqFt: number;
      tiered?: {
        minSqFt: number;
        maxSqFt?: number | null;
        rate: number;
      }[];
      surcharges?: {
        rushPct: number;
        specialInkFlat: number;
      };
    };
    security?: {
      twoFactorEnabled: boolean;
      lastPasswordChange?: Date;
    };
  };
  role: UserRole;
  defaultShippingAddress?: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    passwordHash: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    companyName: {
      type: String,
      trim: true
    },
    website: {
      type: String,
      trim: true
    },
    regions: [
      {
        type: String,
        trim: true
      }
    ],
    status: {
      type: String,
      enum: ["Active", "Suspended", "Under Review"],
      default: "Active"
    },
    rating: {
      type: Number,
      default: 5.0,
      min: 0,
      max: 5
    },
    phone: {
      type: String,
      trim: true
    },
    avatarUrl: {
      type: String,
      default: null
    },
    settings: {
      businessHours: {
        monday: { isOpen: Boolean, start: String, end: String },
        tuesday: { isOpen: Boolean, start: String, end: String },
        wednesday: { isOpen: Boolean, start: String, end: String },
        thursday: { isOpen: Boolean, start: String, end: String },
        friday: { isOpen: Boolean, start: String, end: String },
        saturday: { isOpen: Boolean, start: String, end: String },
        sunday: { isOpen: Boolean, start: String, end: String }
      },
      jobCapacity: {
        maxConcurrent: Number,
        dailyMax: Number,
        autoAccept: { type: Boolean, default: true }
      },
      notifications: {
        email: {
          newJobs: { type: Boolean, default: true },
          jobUpdates: { type: Boolean, default: true },
          payoutAlerts: { type: Boolean, default: true },
          systemAlerts: { type: Boolean, default: true }
        },
        sms: {
          urgentJobs: { type: Boolean, default: true },
          payoutComplete: { type: Boolean, default: false }
        }
      },
      paymentMethod: {
        type: { type: String, enum: ["bank_transfer", "paypal", "check"] },
        accountNumber: String,
        routingNumber: String,
        paypalEmail: String
      },
      printingCapabilities: {
        maxSheetSizeIn: { width: Number, height: Number },
        supportedInks: [String],
        supportedFilms: [String],
        supportedFormats: [String],
        maxResolutionDPI: Number
      },
      pricing: {
        baseRatePerSqFt: { type: Number, default: 18.00 },
        tiered: [
          {
            minSqFt: { type: Number, required: true },
            maxSqFt: { type: Number },
            rate: { type: Number, required: true }
          }
        ],
        surcharges: {
          rushPct: { type: Number, default: 10 },
          specialInkFlat: { type: Number, default: 5.00 }
        }
      },
      security: {
        twoFactorEnabled: { type: Boolean, default: false },
        lastPasswordChange: { type: Date }
      }
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      required: true,
      default: UserRole.CUSTOMER
    },
    defaultShippingAddress: {
      street: String,
      city: String,
      state: String,
      postalCode: String,
      country: String
    }
  },
  {
    timestamps: true
  }
);

export const User = mongoose.model<IUser>("User", userSchema);
