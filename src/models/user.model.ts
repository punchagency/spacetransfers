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
  otpCode?: string | null;
  otpExpiresAt?: Date | null;
  otpAttempts?: number;
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
  /**
   * This partner's own warehouse in the client's ShipStation account.
   *
   * ShipStation stamps a warehouse on every order and reports against it, so
   * without one every partner's jobs are filed under the HQ warehouse — the
   * labels still ship from the right address, but ShipStation's own reporting
   * shows all volume coming from head office.
   *
   * The client creates a warehouse per partner and passes the numeric id; it is
   * only visible in the ShipStation URL, which is why it is entered by hand
   * rather than discovered.
   */
  shipStationWarehouseId?: number | null;
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
    /*
     * `badges` and `performance` removed.
     *
     * Neither was ever written by any code path: badges was empty on every
     * partner with no way to award one, and performance was {0, 0, 0} on all of
     * them while the Profile page dressed those zeros up as "< 2 hours response
     * time" and "Top 10%". Real production time and on-time rate are derived
     * from orders in `partnerPerformance.service`, which both consoles read.
     */
  settings: {
    jobCapacity?: {
      maxConcurrent?: number;
      dailyMax?: number;
      autoAccept?: boolean;
    };
    notifications?: {
      email?: {
        // Shared / printer keys
        newJobs?: boolean;
        orderUpdates?: boolean;
        payoutAlerts?: boolean;
        accountUpdates?: boolean;
        systemAlerts?: boolean;
        // Admin-specific key (maps to the "partners" notification category)
        partnerActivity?: boolean;
      };
    };
    /**
     * Mirrors the schema below. Payouts run through Stripe Connect only — the
     * older bank_transfer / paypal / check shape was never persistable, because
     * the schema has no `accountNumber`, `routingNumber` or `paypalEmail`
     * fields and Mongoose strict mode dropped them on save.
     */
    paymentMethod?: {
      type?: "stripe_connect";
      stripeConnectAccountId?: string;
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
    /**
     * Two-factor was a stored boolean that nothing enforced — login never read
     * it, there was no TOTP secret, and the "QR code" carried the literal
     * string MOCKSECRET. It was removed rather than left advertising protection
     * the account did not have.
     */
    security?: {
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
  // Canonical computed region — single source of truth for both customers and printers.
  // Derived from defaultShippingAddress.state (or businessAddress.state for printers) via
  // getRegionFromState / geocoding. Stored so queries can filter by region without
  // recomputing it live on every request.
  detectedRegion?: "West" | "Midwest" | "South" | "Northeast" | null;
  statusHistory?: Array<{
    from?: string | null;
    to: string;
    reason?: string | null;
    at?: Date;
    byId?: any;
    byName?: string | null;
    notified?: boolean;
  }>;
  availabilityStatus?: "open" | "paused";
  // True when the partner was automatically paused because they reached their
  // maximum active job limit. Distinguishes a capacity auto-pause from a manual
  // pause so auto-recovery only re-opens partners the system paused itself, and
  // the Open/Paused toggle stays disabled while this is set.
  capacityPaused?: boolean;
  /**
   * Immutable audit record of the legal terms this user accepted at sign-up.
   * Absent on accounts created before the acceptance step shipped, and on
   * sub-accounts (which inherit the parent account holder's acceptance).
   */
  legalAcceptance?: {
    termsAccepted: boolean;
    contentResponsibilityAccepted: boolean;
    termsVersion: string;
    privacyVersion: string;
    contentPolicyVersion: string;
    acceptedAt: Date;
    ip?: string;
    userAgent?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
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
      /*
       * "Rejected" is terminal and distinct from "Suspended" on purpose. A
       * suspension is a pause on a partner the network still wants — it can be
       * lifted. A rejection is a declined application that was never a partner.
       * Collapsing the two left declined applicants sitting in the partners
       * table looking exactly like a working partner paused for cause.
       */
      enum: ["Active", "Suspended", "Under Review", "Pending", "Rejected"],
      default: "Active"
    },

    /*
     * Every status change, with the reason and who made it.
     *
     * Rejecting or suspending a partner is consequential and was previously a
     * one-click, unexplained, permanent act: the only trace was the status field
     * itself. Nothing recorded why, who decided, or when — so a partner
     * re-applying months later met an approver with no way to know whether the
     * last rejection was about print quality or a duplicate signup.
     *
     * One trail for all of them rather than a `rejectionReason` beside a
     * `suspensionReason`, so a new status cannot arrive without somewhere to
     * explain itself.
     */
    statusHistory: [
      {
        from: { type: String, default: null },
        to: { type: String, required: true },
        reason: { type: String, default: null },
        at: { type: Date, default: Date.now },
        byId: { type: Schema.Types.ObjectId, ref: "User", default: null },
        byName: { type: String, default: null },
        /** Whether the partner was successfully told. */
        notified: { type: Boolean, default: false },
      },
    ],
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
    otpCode: {
      type: String,
      default: null
    },
    otpExpiresAt: {
      type: Date,
      default: null
    },
    otpAttempts: {
      type: Number,
      default: 0
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
    shipStationWarehouseId: { type: Number, default: null },
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
    settings: {
      /*
       * `profile` (bio, gender, dateOfBirth, nationalId, taxId) removed.
       * Nothing anywhere read it — the admin console collected it, echoed it
       * back and used it for nothing, and the schema defaults created an empty
       * copy on every user of every role.
       *
       * Date of birth and national ID are the ones worth naming: storing staff
       * identity documents with no purpose is a liability, not a feature.
       */
      /*
       * `businessHours` and `printingCapabilities` were removed from this
       * schema.
       *
       * Business hours gated auto-assignment and separately refused a partner
       * permission to accept a job already assigned to them (403) while that
       * job's SLA clock kept running. The check compared against the SERVER's
       * clock and no partner has a timezone stored, so "9-5" meant nine to five
       * wherever the server happened to run. Pause answers "am I taking work"
       * explicitly, visibly to admins, and with a notification.
       *
       * Printing capabilities (max sheet size, inks, films, formats, DPI) were
       * consulted by no assignment or pricing decision, and both editors for
       * them had already been removed as decorative.
       */
      jobCapacity: {
        maxConcurrent: Number,
        dailyMax: Number,
        autoAccept: { type: Boolean, default: true }
      },
      notifications: {
        email: {
          // Shared / printer keys
          newJobs:         { type: Boolean, default: true },
          orderUpdates:    { type: Boolean, default: true },
          payoutAlerts:    { type: Boolean, default: true },
          accountUpdates:  { type: Boolean, default: true },
          systemAlerts:    { type: Boolean, default: true },
          // Admin-specific key (maps to the "partners" notification category)
          partnerActivity: { type: Boolean, default: true },
        },
      },
      paymentMethod: {
        type: { type: String, enum: ["stripe_connect"] },
        stripeConnectAccountId: String,
      },
      pricing: {
        /*
         * Last resort only. Both creation paths — admin `createPartner` and
         * self-registration — now write `partnerDefaults` from the admin's
         * General Settings explicitly, so this should never be the value a
         * real partner ends up on. It stays as a floor for documents written
         * outside those paths (fixtures, migrations, direct edits).
         */
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
    },
    detectedRegion: {
      type: String,
      enum: ["West", "Midwest", "South", "Northeast", null],
      default: null,
    },
    availabilityStatus: {
      type: String,
      /*
       * Two states, not three. "Stopped" was offered alongside "Paused" and did
       * exactly the same thing: one gate reads this field and it only asks
       * whether the value is "open", and a manual change to either cleared
       * `capacityPaused` identically. The dropdown promised a difference
       * ("temporarily not accepting" vs "offline") that no code honoured, so it
       * was a choice with no consequence.
       */
      enum: ["open", "paused"],
      default: "open",
    },
    capacityPaused: {
      type: Boolean,
      default: false,
    },
    // Compliance audit trail. `_id: false` because this is a value object, not
    // a document collection — it is only ever read as a whole.
    legalAcceptance: {
      type: new Schema(
        {
          termsAccepted: { type: Boolean, required: true },
          contentResponsibilityAccepted: { type: Boolean, required: true },
          termsVersion: { type: String, required: true },
          privacyVersion: { type: String, required: true },
          contentPolicyVersion: { type: String, required: true },
          acceptedAt: { type: Date, required: true },
          ip: { type: String },
          userAgent: { type: String },
        },
        { _id: false },
      ),
      required: false,
      default: undefined,
    }
  },
  {
    timestamps: true
  }
);

// Partial unique index on googleId: only enforced when the field is a non-null
// string (i.e., an actual Google account ID). This lets every non-Google user
// keep googleId === null without colliding with each other on the unique key.
/*
 * One address may hold one account of each kind, not one account in total.
 *
 * `email` alone was unique, so a person who administered the platform could not
 * also sign up as a print partner, and a partner could not shop as a customer —
 * the same human needed a second mailbox per role. Scoping uniqueness to the
 * pair keeps the real constraint (no two partner accounts on one address) while
 * dropping the accidental one.
 *
 * Every lookup by email is now role-scoped to match; `loginUser` resolves the
 * role from the app making the request.
 */
userSchema.index({ email: 1, role: 1 }, { unique: true });

userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: "string" } } },
);

export const User = mongoose.model<IUser>("User", userSchema);
