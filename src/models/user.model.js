import mongoose from "mongoose";

export const UserRoles = {
  CUSTOMER: "CUSTOMER",
  PRINTER: "PRINTER",
  ADMIN: "ADMIN"
};

const userSchema = new mongoose.Schema(
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
    phone: {
      type: String,
      trim: true
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
        accountNumber: String, // Encrypted
        routingNumber: String, // Encrypted
        paypalEmail: String
      },
      printingCapabilities: {
        maxSheetSizeIn: { width: Number, height: Number },
        supportedInks: [String],
        supportedFilms: [String],
        supportedFormats: [String],
        maxResolutionDPI: Number
      }
    },
    role: {
      type: String,
      enum: Object.values(UserRoles),
      required: true,
      default: UserRoles.CUSTOMER
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

export const User = mongoose.model("User", userSchema);

