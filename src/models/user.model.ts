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
  passwordHash: string | null;
  googleId?: string | null;
  name: string;
  companyName?: string;
  website?: string;
  regions?: string[];
  status: string;
  rating: number;
  phone?: string;
  avatarUrl?: string | null;
  welcomeEmail?: {
    status: "sent" | "skipped" | "failed";
    attemptedAt?: Date;
    sentAt?: Date;
    error?: string | null;
    messageId?: string | null;
  };
  resetPasswordTokenHash?: string | null;
  resetPasswordExpiresAt?: Date | null;
  emailVerificationTokenHash?: string | null;
  emailVerificationExpiresAt?: Date | null;
  emailVerificationSentAt?: Date | null;
  stripeConnectAccountId?: string | null;
  stripeConnectOnboarded?: boolean;
  payoutsEnabled?: boolean;
  artboardDraft?: any;
  cart?: any[];
  verificationStatus?: {
    email: boolean;
    phone: boolean;
    business: boolean;
    document: boolean;
  };
  businessDetails?: {
    businessType?: string;
    registrationNumber?: string;
    foundedDate?: Date;
  };
  businessAddress?: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    verified: boolean;
    coordinates?: { lat: number; lng: number };
  };
  certifications?: {
    name: string;
    authority: string;
    date: Date;
    expiryDate?: Date;
    verificationCode?: string;
    documentUrl?: string;
  }[];
  badges?: {
    name: string;
    icon: string;
    dateEarned: Date;
  }[];
  performance?: {
    completionRate: number;
    responseTime: number; // in minutes
    customerRating: number;
  };
  settings: {
    profile?: {
      bio?: string;
      gender?: string;
      dateOfBirth?: string;
      nationalId?: string;
      taxId?: string;
    };
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
        orderUpdates?: boolean;
        payoutAlerts?: boolean;
        accountUpdates?: boolean;
        systemAlerts?: boolean;
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
  parentAccount?: mongoose.Types.ObjectId;
  isSubAccount: boolean;
  defaultShippingAddress?: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    coordinates?: { lat: number; lng: number };
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
      default: null,
    },
    googleId: {
      type: String,
      default: null,
      // Uniqueness is enforced via a partial index below. `sparse: true` + `default: null`
      // is a trap: sparse only skips documents where the field is *absent*, but the default
      // value materialises the field as `null` on every insert, so MongoDB sees many docs
      // with googleId === null and rejects duplicates with E11000.
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
      enum: ["Active", "Suspended", "Under Review", "Pending"],
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
    welcomeEmail: {
      status: { type: String, enum: ["sent", "skipped", "failed"], default: "skipped" },
      attemptedAt: { type: Date, default: null },
      sentAt: { type: Date, default: null },
      error: { type: String, default: null },
      messageId: { type: String, default: null }
    },
    resetPasswordTokenHash: {
      type: String,
      default: null
    },
    resetPasswordExpiresAt: {
      type: Date,
      default: null
    },
    emailVerificationTokenHash: {
      type: String,
      default: null
    },
    emailVerificationExpiresAt: {
      type: Date,
      default: null
    },
    emailVerificationSentAt: {
      type: Date,
      default: null
    },
    stripeConnectAccountId: { type: String, default: null },
    stripeConnectOnboarded: { type: Boolean, default: false },
    payoutsEnabled: { type: Boolean, default: true },
    artboardDraft: {
      type: Schema.Types.Mixed,
      default: null
    },
    verificationStatus: {
      email: { type: Boolean, default: false },
      phone: { type: Boolean, default: false },
      business: { type: Boolean, default: false },
      document: { type: Boolean, default: false }
    },
    businessDetails: {
      businessType: String,
      registrationNumber: String,
      foundedDate: Date
    },
    businessAddress: {
      street: String,
      city: String,
      state: String,
      postalCode: String,
      country: String,
      verified: { type: Boolean, default: false },
      coordinates: {
        lat: { type: Number },
        lng: { type: Number },
      },
    },
    certifications: [
      {
        name: String,
        authority: String,
        date: Date,
        expiryDate: Date,
        verificationCode: String,
        documentUrl: String
      }
    ],
    badges: [
      {
        name: String,
        icon: String,
        dateEarned: { type: Date, default: Date.now }
      }
    ],
    performance: {
      completionRate: { type: Number, default: 0 },
      responseTime: { type: Number, default: 0 },
      customerRating: { type: Number, default: 0 }
    },
    settings: {
      profile: {
        bio: { type: String, default: "" },
        gender: { type: String, default: "" },
        dateOfBirth: { type: String, default: "" },
        nationalId: { type: String, default: "" },
        taxId: { type: String, default: "" }
      },
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
          newJobs:        { type: Boolean, default: true },
          orderUpdates:   { type: Boolean, default: true },
          payoutAlerts:   { type: Boolean, default: true },
          accountUpdates: { type: Boolean, default: true },
          systemAlerts:   { type: Boolean, default: true },
        },
      },
      paymentMethod: {
        type: { type: String, enum: ["stripe_connect"] },
        stripeConnectAccountId: String,
      },
      printingCapabilities: {
        maxSheetSizeIn: { width: Number, height: Number },
        supportedInks: [String],
        supportedFilms: [String],
        supportedFormats: [String],
        maxResolutionDPI: Number
      },
      pricing: {
        baseRatePerSqFt: { type: Number, default: 2.5 },
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
    parentAccount: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    isSubAccount: {
      type: Boolean,
      default: false
    },
    defaultShippingAddress: {
      street: String,
      city: String,
      state: String,
      postalCode: String,
      country: String,
      coordinates: {
        lat: { type: Number },
        lng: { type: Number },
      },
    }
  },
  {
    timestamps: true
  }
);

// Partial unique index on googleId: only enforced when the field is a non-null
// string (i.e., an actual Google account ID). This lets every non-Google user
// keep googleId === null without colliding with each other on the unique key.
userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: "string" } } },
);

export const User = mongoose.model<IUser>("User", userSchema);
