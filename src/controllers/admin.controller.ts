import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { generatePDF } from "pdf-node";
import { Order, IOrder } from "../models/order.model.js";
import { User, UserRoles, IUser } from "../models/user.model.js";
import { Settings } from "../models/settings.model.js";

interface CustomError extends Error {
  statusCode?: number;
}

export const getAdminDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { range = "30d" } = req.query;

    let startDate: Date;
    let priorStartDate: Date;
    let priorEndDate: Date;
    const now = new Date();

    if (range === "7d") {
      startDate = new Date(new Date().setDate(now.getDate() - 7));
      priorStartDate = new Date(new Date().setDate(now.getDate() - 14));
      priorEndDate = startDate;
    } else if (range === "90d") {
      startDate = new Date(new Date().setDate(now.getDate() - 90));
      priorStartDate = new Date(new Date().setDate(now.getDate() - 180));  
      priorEndDate = startDate;
    } else if (range === "ytd") {
      startDate = new Date(new Date().getFullYear(), 0, 1);
      priorStartDate = new Date(new Date().getFullYear() - 1, 0, 1);
      priorEndDate = new Date(new Date().getFullYear() - 1, now.getMonth(), now.getDate());
    } else {
      startDate = new Date(new Date().setDate(now.getDate() - 30));
      priorStartDate = new Date(new Date().setDate(now.getDate() - 60));
      priorEndDate = startDate;
    }

    const orderStats = await Order.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } }
        }
      }
    ]);

    const orders = orderStats[0] || { total: 0, pending: 0, completed: 0, cancelled: 0 };

    const revenueStats = await Order.aggregate([
      {
        $facet: {
          current: [
            { $match: { createdAt: { $gte: startDate }, status: { $nin: ["CANCELLED", "REJECTED"] } } },
            { $group: { _id: null, total: { $sum: "$pricing.total" }, count: { $sum: 1 } } }
          ],
          prior: [
            { $match: { createdAt: { $gte: priorStartDate, $lt: priorEndDate }, status: { $nin: ["CANCELLED", "REJECTED"] } } },
            { $group: { _id: null, total: { $sum: "$pricing.total" } } }
          ]
        }
      }
    ]);

    const currentRevenue = revenueStats[0].current[0]?.total || 0;
    const priorRevenue = revenueStats[0].prior[0]?.total || 0;

    let trendPct = 0;
    if (priorRevenue > 0) {
      trendPct = ((currentRevenue - priorRevenue) / priorRevenue) * 100;
    } else if (currentRevenue > 0) {
      trendPct = 100;
    }

    const partnerStats = await User.aggregate([
      { $match: { role: UserRoles.PRINTER } },
      {
        $group: {
          _id: null,
          active: { $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] } },
          suspended: { $sum: { $cond: [{ $eq: ["$status", "Suspended"] }, 1, 0] } }
        }
      }
    ]);

    const partners = partnerStats[0] || { active: 0, suspended: 0 };

    const recentOrdersRaw = await Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName regions");

        const calculateOrderFinancials = (order: Pick<IOrder, "pricing" | "items">) => {
      const customerCharge = order.pricing?.total || 0;
      
      const partnerPayout = (order.items || []).reduce((total, item) => {
        const { widthIn, heightIn, quantity = 1 } = item;
        if (widthIn && heightIn) {
          const areaSqFt = (widthIn * heightIn) / 144;
          return total + (areaSqFt * 3.50 * quantity);
        }
        return total + (5.00 * quantity);
      }, 0);

      const fees = customerCharge > 0 ? (customerCharge * 0.029) + 0.30 : 0;
      const profit = customerCharge - partnerPayout - fees;
      
      return { customerCharge, partnerPayout, fees, profit };
    };
 
    const recentOrders = recentOrdersRaw.map(order => {
      const { profit } = calculateOrderFinancials(order);
      return {
        id: order._id,
        customer: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
        total: order.pricing?.total || 0,
        profits: Number(profit.toFixed(2)),
        status: order.status,
        createdAt: order.createdAt,
        assignedPartner: (order.assignedPrinter as unknown as IUser)?.companyName || null
      };
    });

    res.json({
      stats: {
        totalOrders: orders.total,
        pendingOrders: orders.pending,
        activePartners: partners.active,
        totalRevenue: {
          amount: Number(currentRevenue.toFixed(2)),
          trendPct: Number(trendPct.toFixed(1))
        }
      },
      recentOrders
    });
  } catch (error) {
    next(error);
  } 
};

export const getGlobalPricing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await Settings.findOne({ key: "global_pricing" });

    if (!settings) {
      return res.status(200).json({
        baseRatePerSqFt: 24.00,
        shipping: {
          standard: 8.99,
          express: 24.99
        },
        taxRatePct: 8.0
      });
    }

    res.status(200).json(settings.value);
  } catch (error) {
    next(error);
  }
};

export const updateGlobalPricing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { baseRatePerSqFt, shipping, taxRatePct } = req.body;

    const settings = await Settings.findOneAndUpdate(
      { key: "global_pricing" },
      {
        $set: {
          value: {
            baseRatePerSqFt,
            shipping,
            taxRatePct
          }
        }
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.status(200).json(settings?.value);
  } catch (error) {
    next(error);
  }
};

export const getAdminNotificationSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await Settings.findOne({ key: "admin_notifications" });

    if (!settings) {
      return res.status(200).json({
        email: {
          newOrderPlaced: true,
          lowPartnerBalance: true,
          printErrorReported: true,
          orderShipped: true,
          paymentFailed: true,
          newPartnerSignup: false,
          dailySummaryReport: false
        },
        sms: {
          urgentOrders: true,
          systemCritical: false
        }
      });
    }

    res.status(200).json(settings.value);
  } catch (error) {
    next(error);
  }
};

export const updateAdminNotificationSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, sms } = req.body;

    const settings = await Settings.findOneAndUpdate(
      { key: "admin_notifications" },
      {
        $set: {
          value: {
            email: email || {},
            sms: sms || {}
          }
        }
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.status(200).json(settings?.value);
  } catch (error) {
    next(error);
  }
};

export const getAdminSecuritySettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const admin = await User.findById(adminId).select("settings.security updatedAt");

    if (!admin) {
      const error = new Error("Admin not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const security = admin.settings?.security || { twoFactorEnabled: false };

    res.status(200).json({
       twoFactorEnabled: security.twoFactorEnabled || false,
       lastPasswordChange: security.lastPasswordChange || admin.updatedAt || new Date()
     });
   } catch (error) {
     next(error);
   }
 };
 
 export const updateAdminSecuritySettings = async (req: Request, res: Response, next: NextFunction) => {
   try {
     const adminId = req.user?.id;
     const { twoFactorEnabled } = req.body;
 
     if (twoFactorEnabled === undefined) {
       const error = new Error("twoFactorEnabled is required") as CustomError;
       error.statusCode = 400;
       throw error;
     }
 
     const admin = await User.findById(adminId);
     if (!admin) {
       const error = new Error("Admin not found") as CustomError;
       error.statusCode = 404;
       throw error;
     }
 
     if (!admin.settings) admin.settings = { pricing: { baseRatePerSqFt: 18, tiered: [], surcharges: { rushPct: 10, specialInkFlat: 5 } }, security: { twoFactorEnabled: false } };
     if (!admin.settings.security) admin.settings.security = { twoFactorEnabled: false };
 
     const previous2FA = admin.settings.security.twoFactorEnabled;
     admin.settings.security.twoFactorEnabled = twoFactorEnabled;
 
     admin.markModified("settings.security");
     await admin.save();
 
     if (twoFactorEnabled && !previous2FA) {
       const mockQrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=otpauth://totp/SpaceTransfers:${admin.email}?secret=MOCKSECRET&issuer=SpaceTransfers`;
       console.log(`[TOTP MOCK] Setup flow initiated for ${admin.email}. QR Code URL sent: ${mockQrCodeUrl}`);
     }
 
     res.status(200).json({ updated: true });
   } catch (error) {
     next(error);
   }
 };

export const getAdminProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const admin = await User.findById(adminId).select("name email phone avatarUrl");

    if (!admin) {
      const error = new Error("Admin not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      name: admin.name,
      email: admin.email,
      phone: admin.phone || null,
      avatarUrl: admin.avatarUrl || null
    });
  } catch (error) {
    next(error);
  }
};

export const updateAdminProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    const { name, phone, avatarUrl } = req.body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;

    if (Object.keys(updateData).length === 0) {
      const error = new Error("No update data provided") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const admin = await User.findOneAndUpdate(
      { _id: adminId, role: UserRoles.ADMIN },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!admin) {
      const error = new Error("Admin not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({ updated: true });
  } catch (error) {
    next(error);
  }
};

export const getRevenueChart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { range = "30d" } = req.query;

    let startDate: Date;                                                                                                                                     
    const now = new Date();
    now.setHours(23, 59, 59, 999);

    if (range === "7d") {
      startDate = new Date(new Date().setDate(now.getDate() - 6));
    } else if (range === "90d") {
      startDate = new Date(new Date().setDate(now.getDate() - 89));
    } else if (range === "ytd") {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else {
      startDate = new Date(new Date().setDate(now.getDate() - 29));
    }
    startDate.setHours(0, 0, 0, 0);

    const orders = await Order.find({
      createdAt: { $gte: startDate }, 
      status: { $nin: ["CANCELLED", "REJECTED"] }
    }).select("pricing.total createdAt");

    const dailyRevenue: { [key: string]: number } = {};
    orders.forEach(order => {
      const dateKey = order.createdAt.toISOString().split("T")[0];
      dailyRevenue[dateKey] = (dailyRevenue[dateKey] || 0) + (order.pricing?.total || 0);
    });

    const points: { date: string, revenue: number }[] = [];
    const tempDate = new Date(startDate);
    while (tempDate <= now) {
      const key = tempDate.toISOString().split("T")[0];
      points.push({
        date: key,
        revenue: Number((dailyRevenue[key] || 0).toFixed(2))
      });
      tempDate.setDate(tempDate.getDate() + 1);
    }

    res.json({  
      points,
      currency: "USD"
    });
  } catch (error) {
    next(error);
  }
};

export const listOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { 
      status, 
      partnerId, 
      search, 
      limit = "20" 
    } = req.query;

    const query: any = {};

    if (status) {
      const statusMap: { [key: string]: string } = {
        "Pending": "PENDING",
        "Assigned": "PROCESSING",
        "In Progress": "PRINTING",
        "Shipped": "SHIPPED",
        "Completed": "COMPLETED",
        "Cancelled": "CANCELLED"
      };
      query.status = statusMap[status as string] || (status as string).toUpperCase();
    }

    if (partnerId) {
      query.assignedPrinter = partnerId;
    }

    if (search) {
      const searchRegex = new RegExp(search as string, "i");
      query.$or = [
        { "customer.firstName": searchRegex },
        { "customer.lastName": searchRegex },
        { "customer.email": searchRegex }
      ];
      
      if (mongoose.Types.ObjectId.isValid(search as string)) {
        query.$or.push({ _id: search as string });
      }
    }

    const pageSize = parseInt(limit as string);
    const orders = await Order.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasNextPage = orders.length > pageSize;
    const results = hasNextPage ? orders.slice(0, pageSize) : orders;

    const formattedOrders = results.map(order => {
      const firstItem = order.items?.[0] || {};
      const sheetSize = firstItem.widthIn && firstItem.heightIn 
        ? `${firstItem.widthIn}" x ${firstItem.heightIn}"`
        : "N/A";
  
      return {
        id: order._id,
        customer: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
        total: order.pricing?.total || 0,
        status: order.status,
        createdAt: order.createdAt,
        assignedPartnerId: order.assignedPrinter || null,
        sheetSize,
        isUrgent: order.priority === "URGENT"
      };
    });

    let nextCursor = null;
    if (hasNextPage) {
      const lastOrder = results[results.length - 1];
      nextCursor = `${lastOrder.createdAt.getTime()}_${lastOrder._id}`;
    }

    res.status(200).json({
      orders: formattedOrders,
      nextCursor
    });
  } catch (error) {
    next(error);
  }
};

export const getPartnerPricing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOne({ _id: partnerIdString, role: UserRoles.PRINTER })
      .select("settings.pricing")
      .lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const pricing = partner.settings?.pricing || {
      baseRatePerSqFt: 18.00,
      tiered: [
        { minSqFt: 0, maxSqFt: 2, rate: 20.00 },
        { minSqFt: 2, maxSqFt: 5, rate: 18.50 },
        { minSqFt: 5, maxSqFt: null, rate: 17.00 }
      ],
      surcharges: {
        rushPct: 10,
        specialInkFlat: 5.00
      }
    };

    res.status(200).json(pricing);
  } catch (error) {
    next(error);
  }
};

export const updatePartnerPricing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { baseRatePerSqFt, tiered, surcharges } = req.body;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const updateData: any = {};
    if (baseRatePerSqFt !== undefined) updateData["settings.pricing.baseRatePerSqFt"] = baseRatePerSqFt;
    if (tiered !== undefined) updateData["settings.pricing.tiered"] = tiered;
    if (surcharges !== undefined) updateData["settings.pricing.surcharges"] = surcharges;

    const partner = await User.findOneAndUpdate(
      { _id: partnerIdString, role: UserRoles.PRINTER },
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("settings.pricing").lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      id: partner._id,
      updated: true,
      pricing: partner.settings?.pricing
    });
  } catch (error) {
    next(error);
  }
};

export const getPartnerSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOne({ _id: partnerIdString, role: UserRoles.PRINTER })
      .select("settings")
      .lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const settings = partner.settings || {};

    const notifications = {
      orderAssigned: settings.notifications?.email?.newJobs || false,
      jobCompleted: settings.notifications?.email?.jobUpdates || false
    };

    const capabilities = {
      maxSheetSizeIn: settings.printingCapabilities?.maxSheetSizeIn || { width: 0, height: 0 },
      formats: settings.printingCapabilities?.supportedFormats || [],
      maxDPI: settings.printingCapabilities?.maxResolutionDPI || 0
    };

    res.status(200).json({
      jobCapacity: settings.jobCapacity || { maxConcurrent: 0, dailyMax: 0 },
      notifications,
      capabilities
    });
  } catch (error) {
    next(error);
  }
};

export const updatePartnerSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { jobCapacity, notifications, capabilities } = req.body;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const updateData: any = {};

    if (jobCapacity) {
      if (jobCapacity.maxConcurrent !== undefined) updateData["settings.jobCapacity.maxConcurrent"] = jobCapacity.maxConcurrent;
      if (jobCapacity.dailyMax !== undefined) updateData["settings.jobCapacity.dailyMax"] = jobCapacity.dailyMax;
    }

    if (notifications) {
      if (notifications.orderAssigned !== undefined) updateData["settings.notifications.email.newJobs"] = notifications.orderAssigned;
      if (notifications.jobCompleted !== undefined) updateData["settings.notifications.email.jobUpdates"] = notifications.jobCompleted;
    }

    if (capabilities) {
      if (capabilities.maxDPI !== undefined) updateData["settings.printingCapabilities.maxResolutionDPI"] = capabilities.maxDPI;
      if (capabilities.maxSheetSizeIn !== undefined) updateData["settings.printingCapabilities.maxSheetSizeIn"] = capabilities.maxSheetSizeIn;
      if (capabilities.formats !== undefined) updateData["settings.printingCapabilities.supportedFormats"] = capabilities.formats;
    }

    const partner = await User.findOneAndUpdate(
      { _id: partnerIdString, role: UserRoles.PRINTER },
      { $set: updateData },
      { new: true, runValidators: true }
    ).lean();

    if (!partner) {
      const error = new Error("Partner not found or is not a printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({ updated: true });
  } catch (error) {
    next(error);
  }
};

export const setOrderTracking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const { carrier, trackingNumber, trackingUrl } = req.body;

    if (!carrier || !trackingNumber) {
      const error = new Error("Carrier and trackingNumber are required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const order = await Order.findById(orderIdString);
    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    order.carrier = carrier;
    order.trackingNumber = trackingNumber;
    order.trackingUrl = trackingUrl;
    order.status = "SHIPPED";

    if (!order.statusTimeline) order.statusTimeline = [];
    order.statusTimeline.push({
      status: "SHIPPED",
      time: new Date(),
      message: `Order shipped via ${carrier}. Tracking: ${trackingNumber}`
    });

    await order.save();

    res.status(200).json({
      orderId: order._id,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier
    });
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const { status } = req.body;

    if (!status) {
      const error = new Error("Status is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const statusMap: { [key: string]: string } = {
      "Pending": "PENDING",
      "Assigned": "PROCESSING",
      "In Progress": "PRINTING",
      "Shipped": "SHIPPED",
      "Completed": "COMPLETED",
      "Cancelled": "CANCELLED"
    };

    const dbStatus = statusMap[status] as any;
    if (!dbStatus) {
      const error = new Error(`Invalid status value: ${status}`) as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const order = await Order.findById(orderIdString);
    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    order.status = dbStatus;

    if (!order.statusTimeline) order.statusTimeline = [];
    order.statusTimeline.push({
      status: dbStatus,
      time: new Date(),
      message: `Admin updated status to ${status}`
    });

    await order.save();

    res.status(200).json({
      orderId: order._id,
      status: status,
      updatedAt: order.updatedAt
    });
  } catch (error) {
    next(error);
  }
};

export const assignOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const { partnerId, priority = "Normal" } = req.body;

    if (!partnerId) {
      const error = new Error("partnerId is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const order = await Order.findById(orderIdString);
    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOne({ _id: partnerId, role: UserRoles.PRINTER });
    if (!partner) {
      const error = new Error("Partner not found or is not a printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const previousPartnerId = order.assignedPrinter;
    const isReassignment = previousPartnerId && previousPartnerId.toString() !== partnerId;

    order.assignedPrinter = partnerId;
    order.priority = priority.toUpperCase() as any;
    order.status = "PROCESSING";

    const message = isReassignment 
      ? `Order reassigned from previous partner to ${partner.companyName || partner.name}`
      : `Order assigned to ${partner.companyName || partner.name}`;

    if (!order.statusTimeline) order.statusTimeline = [];
    order.statusTimeline.push({
      status: "PROCESSING",
      time: new Date(),
      message
    });

    await order.save();

    res.status(200).json({
      orderId: order._id,
      assignedPartnerId: partnerId,
      status: "Assigned"
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const order = await Order.findById(orderIdString)
      .populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName email regions")
      .lean();

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const calculateItemCost = (item: any) => {
      const { widthIn, heightIn, quantity = 1 } = item;
      if (widthIn && heightIn) {
        const areaSqFt = (widthIn * heightIn) / 144;
        const costPerSqFt = 3.50; 
        return areaSqFt * costPerSqFt * quantity;
      }
      return 5.00 * quantity;
    };

    let totalPartnerCost = 0;
    const formattedItems = (order.items || []).map(item => {
      const itemCost = calculateItemCost(item);
      totalPartnerCost += itemCost;
      
      return {
        name: item.name,
        size: item.widthIn && item.heightIn ? `${item.widthIn}" x ${item.heightIn}"` : "Custom",
        quantity: item.quantity,
        price: item.unitPrice,
        subtotal: item.subtotal
      };
    });

    const customerPaid = order.pricing?.total || 0;
    const processingFees = customerPaid > 0 ? (customerPaid * 0.029) + 0.30 : 0;
    const adminProfit = customerPaid - totalPartnerCost - processingFees;

    const orderSummary = {
      id: order._id,
      status: order.status,
      createdAt: order.createdAt,
      
      customer: {
        name: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
        email: order.customer?.email || "N/A",
        phone: order.customer?.phone || "N/A"
      },

      shippingAddress: {
        street: order.shippingAddress?.street || "N/A",
        city: order.shippingAddress?.city || "N/A",
        state: order.shippingAddress?.state || "N/A",
        postalCode: order.shippingAddress?.postalCode || "N/A",
        country: order.shippingAddress?.country || "N/A",
        region: (order.assignedPrinter as unknown as IUser)?.regions?.[0] || "Unknown"
      },

      items: formattedItems,

      statusTimeline: (order.statusTimeline || []).map(entry => ({
        status: entry.status,
        time: entry.time
      })),

      financials: {
        customerPaid: Number(customerPaid.toFixed(2)),
        partnerCost: Number(totalPartnerCost.toFixed(2)),
        processingFees: Number(processingFees.toFixed(2)),
        adminProfit: Number(adminProfit.toFixed(2)),
        currency: order.pricing?.currency || "USD"
      },

      assignedPartner: order.assignedPrinter ? {
        id: (order.assignedPrinter as unknown as IUser)._id,
        name: (order.assignedPrinter as unknown as IUser).companyName,
        email: (order.assignedPrinter as unknown as IUser).email
      } : null,

      preview: {
        designId: order.items?.[0]?.designId || null,
        sheetSize: formattedItems[0]?.size || "N/A"
      }
    };

    res.status(200).json(orderSummary);
  } catch (error) {
    next(error);
  }
};

export const exportOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to, status } = req.query;

    const query: any = {};
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from as string);
      if (to) query.createdAt.$lte = new Date(to as string);
    }
    if (status) {
      const statusMap: { [key: string]: string } = {
        "Pending": "PENDING",
        "Assigned": "PROCESSING",
        "In Progress": "PRINTING",
        "Shipped": "SHIPPED",
        "Completed": "COMPLETED",
        "Cancelled": "CANCELLED"
      };
      query.status = statusMap[status as string] || (status as string).toUpperCase();
    }

    const filename = `orders-export-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const columns = ['orderId', 'customer', 'email', 'status', 'total', 'partner', 'sheetSize', 'createdAt', 'completedAt'];
    res.write(columns.join(',') + '\n');

    const cursor = Order.find(query)
      .populate<{ assignedPrinter: IUser }>('assignedPrinter', 'companyName')
      .sort({ createdAt: -1 })
      .cursor();

    for (let order = await cursor.next(); order != null; order = await cursor.next()) {
      const customerName = `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim();
      const firstItem = order.items?.[0] || {};
      const sheetSize = firstItem.widthIn && firstItem.heightIn 
        ? `${firstItem.widthIn}" x ${firstItem.heightIn}"`
        : 'N/A';
      
      const completedAt = order.status === 'COMPLETED' ? (order.updatedAt || order.createdAt).toISOString() : 'N/A';

      const row = [
        order._id,
        `"${customerName.replace(/"/g, '""')}"`,
        order.customer?.email || 'N/A',
        order.status,
        order.pricing?.total || 0,
        `"${((order.assignedPrinter as unknown as IUser)?.companyName || 'N/A').replace(/"/g, '""')}"`,
        `"${sheetSize}"`,
        order.createdAt.toISOString(),
        completedAt
      ];

      res.write(row.join(',') + '\n');
    }

    res.end();
  } catch (error) {
    next(error);
  }
};

export const createPartner = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, phone, regions, capabilities } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      const error = new Error("Partner with this email already exists") as CustomError;
      error.statusCode = 409;
      throw error;
    }

    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const newPartner = new User({
      name,
      companyName: name,
      email,
      phone,
      regions,
      role: UserRoles.PRINTER,
      status: "Active",
      passwordHash,
      settings: {
        printingCapabilities: {
          maxSheetSizeIn: capabilities?.maxSheetSizeIn || { width: 24, height: 19.5 },
          supportedFormats: capabilities?.formats || ["PNG", "PDF", "TIFF"],
          maxResolutionDPI: capabilities?.maxDPI || 1200
        }
      }
    });

    await newPartner.save();

    console.log(`[EMAIL MOCK] Welcome email sent to ${email} with temporary password: ${tempPassword}`);

    res.status(201).json({
      id: newPartner._id,
      status: newPartner.status
    });
  } catch (error) {
    next(error);
  }
};

export const listPartners = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, search, cursor, limit = "20" } = req.query;
    const pageSize = parseInt(limit as string);

    const matchQuery: any = { role: UserRoles.PRINTER };

    if (status) {
      matchQuery.status = status;
    }

    if (search) {
      const searchRegex = new RegExp(search as string, "i");
      matchQuery.$or = [
        { name: searchRegex },
        { companyName: searchRegex },
        { email: searchRegex }
      ];
    }

    const pipeline: any[] = [
      { $match: matchQuery },
      {
        $lookup: {
          from: "orders",
          let: { partnerId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$assignedPrinter", "$$partnerId"] },
                    { $eq: ["$status", "COMPLETED"] }
                  ]
                }
              }
            },
            { $count: "count" }
          ],
          as: "completedCountArr"
        }
      },
      {
        $addFields: {
          ordersCompleted: { $ifNull: [{ $arrayElemAt: ["$completedCountArr.count", 0] }, 0] }
        }
      },
      { $project: { passwordHash: 0, completedCountArr: 0 } },
      { $sort: { ordersCompleted: -1, _id: -1 } }
    ];

    if (cursor) {
      const [cursorValue, cursorId] = (cursor as string).split("_");
      pipeline.push({
        $match: {
          $or: [
            { ordersCompleted: { $lt: parseInt(cursorValue) } },
            {
              ordersCompleted: parseInt(cursorValue),
              _id: { $lt: new mongoose.Types.ObjectId(cursorId) }
            }
          ]
        }
      });
    }

    pipeline.push({ $limit: pageSize + 1 });

    const partners = await User.aggregate(pipeline);

    const hasNextPage = partners.length > pageSize;
    const results = hasNextPage ? partners.slice(0, pageSize) : partners;

    const formattedPartners = results.map(p => ({
      id: p._id,
      name: p.companyName || p.name,
      status: p.status,
      regions: p.regions || [],
      rating: p.rating || 5.0,
      ordersCompleted: p.ordersCompleted
    }));

    let nextCursor = null;
    if (hasNextPage) {
      const lastPartner = results[results.length - 1];
      nextCursor = `${lastPartner.ordersCompleted}_${lastPartner._id}`;
    }

    res.status(200).json({
      partners: formattedPartners,
      nextCursor
    });
  } catch (error) {
    next(error);
  }
};

export const getPartnerById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const partner = await User.findOne({ _id: partnerIdString, role: UserRoles.PRINTER })
      .select("-passwordHash")
      .lean();

    if (!partner) {
      const error = new Error("Partner not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const ordersCompleted = await Order.countDocuments({
      assignedPrinter: partnerIdString,
      status: "COMPLETED"
    });

    res.status(200).json({
      id: partner._id,
      name: partner.companyName || partner.name,
      status: partner.status,
      regions: partner.regions || [],
      ordersCompleted,
      rating: partner.rating || 5.0,
      email: partner.email,
      phone: partner.phone || "N/A"
    });
  } catch (error) {
    next(error);
  }
};

export const getPartnerOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { status, cursor, limit = "20" } = req.query;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const query: any = { assignedPrinter: partnerIdString };

    if (status) {
      const statusMap: { [key: string]: string } = {
        "Pending": "PENDING",
        "Assigned": "PROCESSING",
        "In Progress": "PRINTING",
        "Shipped": "SHIPPED",
        "Completed": "COMPLETED",
        "Cancelled": "CANCELLED"
      };
      query.status = statusMap[status as string] || (status as string).toUpperCase();
    }

    if (cursor) {
      const [cursorTime, cursorId] = (cursor as string).split("_");
      query.$or = [
        { createdAt: { $lt: new Date(Number(cursorTime)) } },
        { 
          createdAt: new Date(Number(cursorTime)), 
          _id: { $lt: cursorId } 
        }
      ];
    }

    const pageSize = parseInt(limit as string);
    const orders = await Order.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasNextPage = orders.length > pageSize;
    const results = hasNextPage ? orders.slice(0, pageSize) : orders;

    const formattedOrders = results.map(order => ({
      id: order._id,
      status: order.status,
      customer: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
      total: order.pricing?.total || 0,
      createdAt: order.createdAt
    }));

    let nextCursor = null;
    if (hasNextPage) {
      const lastOrder = results[results.length - 1];
      nextCursor = `${lastOrder.createdAt.getTime()}_${lastOrder._id}`;
    }

    res.status(200).json({
      orders: formattedOrders,
      nextCursor
    });
  } catch (error) {
    next(error);
  }
};

export const updatePartner = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const updateData = req.body;

    delete updateData.passwordHash;
    delete updateData.role;

    const partner = await User.findOneAndUpdate(
      { _id: partnerIdString, role: UserRoles.PRINTER },
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-passwordHash");

    if (!partner) {
      const error = new Error("Partner not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      id: partner._id,
      updated: true
    });
  } catch (error) {
    next(error);
  }
};

export const updatePartnerStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerId } = req.params;
    const { status } = req.body;

    const partnerIdString = Array.isArray(partnerId) ? partnerId[0] : partnerId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(partnerIdString) || !mongoose.Types.ObjectId.isValid(partnerIdString)) {
      const error = new Error("Invalid Partner ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (!["Active", "Suspended", "Under Review"].includes(status)) {
      const error = new Error("Invalid status. Allowed values: Active, Suspended, Under Review") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const partner = await User.findOneAndUpdate(
      { _id: partnerIdString, role: UserRoles.PRINTER },
      { $set: { status } },
      { new: true, runValidators: true }
    ).select("-passwordHash");

    if (!partner) {
      const error = new Error("Partner not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      id: partner._id,
      status: partner.status,
      updated: true
    });
  } catch (error) {
    next(error);
  }
};

export const adjustOrderFinancials = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const { adjustments } = req.body;

    if (!Array.isArray(adjustments) || adjustments.length === 0) {
      const error = new Error("Adjustments array is required and cannot be empty") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const order = await Order.findById(orderIdString);

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (!order.pricing.adjustments) {
      order.pricing.adjustments = [];
    }

    let totalAdjustment = 0;
    adjustments.forEach(adj => {
      const { type, amount, reason } = adj;
      
      if (!["discount", "surcharge", "credit", "fee"].includes(type)) {
        const error = new Error(`Invalid adjustment type: ${type}`) as CustomError;
        error.statusCode = 400;
        throw error;
      }

      if (typeof amount !== "number" || amount <= 0) {
        const error = new Error("Adjustment amount must be a positive number") as CustomError;
        error.statusCode = 400;
        throw error;
      }

      order.pricing.adjustments!.push({ type, amount, reason, createdAt: new Date() });

      if (type === "discount" || type === "credit") {
        totalAdjustment -= amount;
      } else {
        totalAdjustment += amount;
      }

      if (!order.statusTimeline) order.statusTimeline = [];
      order.statusTimeline.push({
        status: order.status,
        time: new Date(),
        message: `Financial adjustment: ${type.toUpperCase()} of ${amount} applied. Reason: ${reason}`
      });
    });

    order.pricing.total = Math.max(0, order.pricing.total + totalAdjustment);
    
    await order.save();

    const calculateItemCost = (item: any) => {
      const { widthIn, heightIn, quantity = 1 } = item;
      if (widthIn && heightIn) {
        const areaSqFt = (widthIn * heightIn) / 144;
        const costPerSqFt = 3.50; 
        return areaSqFt * costPerSqFt * quantity;
      }
      return 5.00 * quantity;
    };

    const partnerPayout = (order.items || []).reduce((total, item) => total + calculateItemCost(item), 0);
    const fees = order.pricing.total > 0 ? (order.pricing.total * 0.029) + 0.30 : 0;
    const margin = order.pricing.total - partnerPayout - fees;

    res.status(200).json({
      customerCharge: Number(order.pricing.total.toFixed(2)),
      margin: Number(margin.toFixed(2)),
      currency: order.pricing.currency
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderFinancials = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const order = await Order.findById(orderIdString).lean();

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const customerCharge = order.pricing?.total || 0;

    const calculateItemCost = (item: any) => {
      const { widthIn, heightIn, quantity = 1 } = item;
      if (widthIn && heightIn) {
        const areaSqFt = (widthIn * heightIn) / 144;
        const costPerSqFt = 3.50; 
        return areaSqFt * costPerSqFt * quantity;
      }
      return 5.00 * quantity;
    };

    const partnerPayout = (order.items || []).reduce((total, item) => total + calculateItemCost(item), 0);
    const fees = customerCharge > 0 ? (customerCharge * 0.029) + 0.30 : 0;
    const margin = customerCharge - partnerPayout - fees;

    res.status(200).json({
      customerCharge: Number(customerCharge.toFixed(2)),
      partnerPayout: Number(partnerPayout.toFixed(2)),
      fees: Number(fees.toFixed(2)),
      margin: Number(margin.toFixed(2)),
      currency: order.pricing?.currency || "USD"
    });
  } catch (error) {
    next(error);
  }
};

export const downloadOrderInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const order = await Order.findById(orderIdString);

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const invoiceTemplatePath = path.join(process.cwd(), "src", "templates", "invoice.html");
    const htmlTemplate = fs.readFileSync(invoiceTemplatePath, "utf8");

    const formattedItems = (order.items || []).map((item) => {
      let description = "";
      if (item.widthIn && item.heightIn) {
        description = `${item.widthIn}" x ${item.heightIn}"`;
      }
      return {
        name: item.name || "Unknown Item",
        description: description,
        quantity: item.quantity || 0,
        unitPrice: (item.unitPrice || 0).toFixed(2),
        subtotal: (item.subtotal || 0).toFixed(2)
      };
    });

    const pricing = order.pricing || {};
    const lineItems = [
      { label: "Subtotal", amount: (pricing.subtotal || 0).toFixed(2) },
      { label: "Shipping", amount: (pricing.shippingCost || 0).toFixed(2) },
      { label: "Tax", amount: (pricing.tax || 0).toFixed(2) }
    ];

    if (pricing.adjustments && pricing.adjustments.length > 0) {
      pricing.adjustments.forEach(adj => {
        const label = adj.type.charAt(0).toUpperCase() + adj.type.slice(1);
        const amount = (adj.type === "discount" || adj.type === "credit") ? -adj.amount : adj.amount;
        lineItems.push({ label: `${label} (${adj.reason})`, amount: amount.toFixed(2) });
      });
    }

    const data = {
      orderId: order._id,
      date: (order.createdAt || new Date()).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      shippingAddress: {
        name: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim() || "Valued Customer",
        street: order.shippingAddress?.street || "N/A",
        city: order.shippingAddress?.city || "N/A",
        state: order.shippingAddress?.state || "N/A",
        postalCode: order.shippingAddress?.postalCode || "N/A",
        country: order.shippingAddress?.country || "N/A"
      },
      items: formattedItems,
      pricing: {
        lineItems,
        total: (pricing.total || 0).toFixed(2),
        currency: pricing.currency || "USD"
      }
    };

    const pdfOptions = {
      format: "A4",
      printBackground: true
    };

    const result = await generatePDF({
      html: htmlTemplate,
      data: data,
      buffer: true,
      pdfOptions: pdfOptions
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${order._id}.pdf"`);
    res.send(result.buffer);

  } catch (error) {
    next(error);
  }
};

export const getOrderTimeline = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const orderIdString = Array.isArray(orderId) ? orderId[0] : orderId as string;
    if (!/^[0-9a-fA-F]{24}$/.test(orderIdString) || !mongoose.Types.ObjectId.isValid(orderIdString)) {
      const error = new Error("Invalid Order ID") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const order = await Order.findById(orderIdString)
      .populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName")
      .lean();

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }
 
    let events: any[] = [];

    events.push({
      time: order.createdAt,
      who: "Customer",
      type: "Created",
      message: "Order placed"
    });

    if (order.statusTimeline && order.statusTimeline.length > 0) {
      order.statusTimeline.forEach(entry => {
        let who = "System";
        let message = `Status updated to ${entry.status}`;

        if (entry.status === "PROCESSING" && order.assignedPrinter) {
          who = "Admin";
          message = `Assigned to ${(order.assignedPrinter as unknown as IUser).companyName}`;
        } else if (["PRINTING", "QUALITY_CHECK"].includes(entry.status)) {
          who = "Printer";
        } else if (entry.status === "REJECTED") {
          who = "Admin";
          message = `Order rejected. Reason: ${order.rejectionReason || "Not specified"}`;
        }

        events.push({
          time: entry.time,
          who,
          type: entry.status.charAt(0).toUpperCase() + entry.status.slice(1).toLowerCase(),
          message
        });
      });
    }

    if (order.trackingEvents && order.trackingEvents.length > 0) {
      order.trackingEvents.forEach(event => {
        events.push({
          time: event.time,
          who: "Printer",
          type: "Shipped",
          message: `${event.description} at ${event.location}`
        });
      });
    }

    events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    res.status(200).json({ events });

  } catch (error) {
    next(error);
  }
};

export const getEarningsSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { range = "30d" } = req.query;

    let startDate: Date;
    let priorStartDate: Date;
    let priorEndDate: Date;
    const now = new Date();

    if (range === "7d") {
      startDate = new Date(new Date().setDate(now.getDate() - 7));
      priorStartDate = new Date(new Date().setDate(now.getDate() - 14));
      priorEndDate = startDate;
    } else if (range === "90d") {
      startDate = new Date(new Date().setDate(now.getDate() - 90));
      priorStartDate = new Date(new Date().setDate(now.getDate() - 180));
      priorEndDate = startDate;
    } else if (range === "ytd") {
      startDate = new Date(new Date().getFullYear(), 0, 1);
      priorStartDate = new Date(new Date().getFullYear() - 1, 0, 1);
      priorEndDate = new Date(new Date().getFullYear() - 1, now.getMonth(), now.getDate());
    } else {
      startDate = new Date(new Date().setDate(now.getDate() - 30));
      priorStartDate = new Date(new Date().setDate(now.getDate() - 60));
      priorEndDate = startDate;
    }

    const orders = await Order.find({
      createdAt: { $gte: startDate },
      status: { $nin: ["CANCELLED", "REJECTED"] }
    }).populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName regions");

    const priorOrders = await Order.find({
      createdAt: { $gte: priorStartDate, $lt: priorEndDate },
      status: { $nin: ["CANCELLED", "REJECTED"] }
    });

    const calculateItemCost = (item: any) => {
      const { widthIn, heightIn, quantity = 1 } = item;
      if (widthIn && heightIn) {
        const areaSqFt = (widthIn * heightIn) / 144;
        const costPerSqFt = 3.50; 
        return areaSqFt * costPerSqFt * quantity;
      }
      return 5.00 * quantity;
    };

    const calculateTotals = (orderList: any[]) => {
      let revenue = 0;
      let payout = 0;
      let fees = 0;
      
      orderList.forEach(o => {
        const orderRevenue = (o.pricing?.total || 0);
        revenue += orderRevenue;
        
        o.items.forEach((item: any) => {
          payout += calculateItemCost(item);
        });

        if (orderRevenue > 0) {
          fees += (orderRevenue * 0.029) + 0.30;
        }
      });

      const totalCost = payout + fees;
      return { revenue, cost: totalCost, profit: revenue - totalCost };
    };

    const currentTotals = calculateTotals(orders);
    const priorTotals = calculateTotals(priorOrders);

    const calculateTrend = (curr: number, prior: number) => {
      if (prior === 0) return curr > 0 ? 100 : 0;
      return Number(((curr - prior) / prior * 100).toFixed(1));
    };

    const regionMap: { [key: string]: number } = {};
    orders.forEach(o => {
      const region = (o.assignedPrinter as unknown as IUser)?.regions?.[0] || "Unknown";
      regionMap[region] = (regionMap[region] || 0) + (o.pricing?.total || 0);
    });
    const revenueByRegion = Object.entries(regionMap).map(([region, value]) => ({
      region,
      value: Number(value.toFixed(0)),
      percentage: Number(((value / (currentTotals.revenue || 1)) * 100).toFixed(0))
    })).sort((a, b) => b.value - a.value);

    const productMap: { [key: string]: any } = {};
    orders.forEach(o => {
      o.items.forEach((item: any) => {
        const key = item.name || "Custom Print";
        if (!productMap[key]) {
          productMap[key] = {
            name: key,
            sku: `DTF-${o._id.toString().slice(-4).toUpperCase()}`,
            quantity: 0,
            totalRevenue: 0,
            totalCost: 0
          };
        }
        productMap[key].quantity += (item.quantity || 1);
        productMap[key].totalRevenue += (item.subtotal || 0);
        productMap[key].totalCost += calculateItemCost(item);
      });
    });

    const products = Object.values(productMap).map(p => {
      const profit = p.totalRevenue - p.totalCost;
      const finalPrice = p.totalRevenue / (p.quantity || 1);
      const profitMargin = (profit / (p.totalRevenue || 1)) * 100;
      const baseCost = p.totalCost / (p.quantity || 1);
      const markup = ((finalPrice - baseCost) / (baseCost || 1)) * 100;

      return {
        name: p.name,
        sku: p.sku,
        baseCost: Number(baseCost.toFixed(2)),
        markup: Number(markup.toFixed(1)),
        quantity: p.quantity,
        finalPrice: Number(finalPrice.toFixed(2)),
        totalCost: Number(p.totalCost.toFixed(2)),
        totalRevenue: Number(p.totalRevenue.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        profitMargin: Number(profitMargin.toFixed(2))
      };
    });

    const getTimeLabel = (date: Date) => {
      if (range === "7d") return date.toLocaleDateString("en-US", { weekday: "short" });
      if (range === "ytd") return date.toLocaleDateString("en-US", { month: "short" });
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    const currentPointsMap: { [key: string]: number } = {};
    const priorPointsMap: { [key: string]: number } = {};

    orders.forEach(o => {
      const label = getTimeLabel(o.createdAt);
      currentPointsMap[label] = (currentPointsMap[label] || 0) + (o.pricing?.total || 0);
    });

    priorOrders.forEach(o => {
      const label = getTimeLabel(o.createdAt);
      priorPointsMap[label] = (priorPointsMap[label] || 0) + (o.pricing?.total || 0);
    });

    const labels: string[] = [];
    let tempDate = new Date(startDate);
    const endChartDate = new Date(now);
    
    while (tempDate <= endChartDate) {
      labels.push(getTimeLabel(tempDate));
      if (range === "7d") {
        tempDate.setDate(tempDate.getDate() + 1);
      } else if (range === "90d") {
        tempDate.setDate(tempDate.getDate() + 7); 
      } else if (range === "ytd") {
        tempDate.setMonth(tempDate.getMonth() + 1);
      } else {
        tempDate.setDate(tempDate.getDate() + 2); 
      }
    }

    const chartPoints = labels.map(label => ({
      label,
      current: Number((currentPointsMap[label] || 0).toFixed(0)),
      previous: Number((priorPointsMap[label] || 0).toFixed(0))
    }));

    res.json({
      kpis: {
        totalProfits: { 
          value: Number(currentTotals.profit.toFixed(0)), 
          trendPct: calculateTrend(currentTotals.profit, priorTotals.profit) 
        },
        totalCosts: { 
          value: Number(currentTotals.cost.toFixed(0)), 
          trendPct: calculateTrend(currentTotals.cost, priorTotals.cost) 
        },
        profitEarned: { 
          value: Number(currentTotals.profit.toFixed(0)), 
          trendPct: calculateTrend(currentTotals.profit, priorTotals.profit) 
        },
        totalRevenue: { 
          value: Number(currentTotals.revenue.toFixed(0)), 
          trendPct: calculateTrend(currentTotals.revenue, priorTotals.revenue) 
        }
      },
      revenueChart: {
        currentTotal: Number(currentTotals.revenue.toFixed(0)),
        previousTotal: Number(priorTotals.revenue.toFixed(0)),
        points: chartPoints
      },
      revenueByRegion,
      products
    });
  } catch (error) {
    next(error);
  }
};
