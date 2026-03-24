import { Request, Response, NextFunction } from "express";
import { User } from "../models/user.model.js";
import { Asset } from "../models/asset.model.js";
import { Design } from "../models/design.model.js";
import { Order } from "../models/order.model.js";
import sharp from "sharp";
import { env } from "../config/env.js";
import { generatePDF } from "pdf-node";
import fs from "fs";
import path from "path";

interface CustomError extends Error {
  statusCode?: number;
}

export const updateAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, defaultShippingAddress, companyName, phone } = req.body;
    const userId = req.user?.id;

    const updateData: any = {};
    if (name) updateData.name = name;
    if (companyName) updateData.companyName = companyName;
    if (phone) updateData.phone = phone;
    if (defaultShippingAddress) updateData.defaultShippingAddress = defaultShippingAddress;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-passwordHash");

    if (!updatedUser) {
      const error = new Error("User not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const userResponse: any = {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role
    };

    if (updatedUser.companyName) userResponse.companyName = updatedUser.companyName;
    if (updatedUser.phone) userResponse.phone = updatedUser.phone;
    if (updatedUser.defaultShippingAddress) userResponse.defaultShippingAddress = updatedUser.defaultShippingAddress;

    res.json({ user: userResponse });
  } catch (error) {
    next(error);
  }
};

export const getOrderTracking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ _id: orderId, user: req.user?.id });

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const isValidTrackingNumber = (tn: any) => typeof tn === "string" && /^[A-Za-z0-9]{10,35}$/.test(tn);
    let trackingNumber = order.trackingNumber;
    let carrier = order.carrier || "UPS";
    let events = (order.trackingEvents || []).map(event => ({
      time: event.time,
      location: event.location,
      description: event.description
    }));

    if (!isValidTrackingNumber(trackingNumber)) {
      if (env.nodeEnv !== "production") {
        trackingNumber = "1Z999AA10123456784";
        carrier = "UPS";

        if (events.length === 0) {
          events = [
            {
              time: new Date(Date.now() - 3600000),
              location: (order.shippingAddress?.city || "Los Angeles") + ", " + (order.shippingAddress?.state || "CA"),
              description: "Arrived at facility"
            },
            {
              time: new Date(Date.now() - 86400000),
              location: "Los Angeles, CA",
              description: "Departed facility"
            }
          ];
        }
      } else {
        const error = new Error("Tracking not available") as CustomError;
        error.statusCode = 404;
        throw error;
      }
    }

    const carrierUrls: { [key: string]: string } = {
      UPS: `https://www.ups.com/track?loc=en_US&tracknum=${trackingNumber}`,
      FedEx: `https://www.fedex.com/apps/fedextrack/?tracknumbers=${trackingNumber}`,
      USPS: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`,
      DHL: `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`
    };

    const trackingUrl = carrierUrls[carrier] || carrierUrls.UPS;
    const status = order.status === "SHIPPED" ? "In Transit" : (order.status === "COMPLETED" ? "Delivered" : "Pending");

    events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    res.json({
      trackingNumber,
      carrier,
      trackingUrl,
      status,
      events
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
};

export const createOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      items,
      customer,
      shippingAddress,
      shippingMethod,
      payment,
      pricing
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      const error = new Error("items array is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!customer || !customer.firstName || !customer.lastName || !customer.email) {
      const error = new Error("customer.firstName, customer.lastName and customer.email are required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (
      !shippingAddress ||
      !shippingAddress.street ||
      !shippingAddress.city ||
      !shippingAddress.state ||
      !shippingAddress.postalCode ||
      !shippingAddress.country
    ) {
      const error = new Error("shippingAddress.street, city, state, postalCode and country are required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!shippingMethod) {
      const error = new Error("shippingMethod is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!payment || !payment.method) {
      const error = new Error("payment.method is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (payment.method === "card" && !payment.paymentIntentId) {
      const error = new Error("payment.paymentIntentId is required for card payments") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (
      !pricing ||
      typeof pricing.subtotal !== "number" ||
      typeof pricing.shippingCost !== "number" ||
      typeof pricing.tax !== "number" ||
      typeof pricing.total !== "number" ||
      !pricing.currency
    ) {
      const error = new Error("pricing with subtotal, shippingCost, tax, total and currency is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    let computedSubtotal = 0;
    const orderItems = items.map((item: any) => {
      const {
        type,
        designId,
        name,
        widthIn,
        heightIn,
        quantity,
        unitPrice
      } = item || {};

      if (!type || !name || typeof quantity !== "number" || typeof unitPrice !== "number") {
        const error = new Error("Each item requires type, name, quantity and unitPrice") as CustomError;
        error.statusCode = 400;
        throw error;
      }

      const lineSubtotal = unitPrice * quantity;
      computedSubtotal += lineSubtotal;

      return {
        type,
        designId,
        name,
        widthIn,
        heightIn,
        quantity,
        unitPrice,
        subtotal: lineSubtotal
      };
    });

    const roundToTwo = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const roundedComputedSubtotal = roundToTwo(computedSubtotal);

    if (roundToTwo(pricing.subtotal) !== roundedComputedSubtotal) {
      const error = new Error("pricing.subtotal does not match computed items subtotal") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const expectedTotal = roundToTwo(pricing.subtotal + pricing.shippingCost + pricing.tax);
    if (roundToTwo(pricing.total) !== expectedTotal) {
      const error = new Error("pricing.total does not match subtotal + shippingCost + tax") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const order = new Order({
      user: req.user?.id,
      items: orderItems,
      customer,
      shippingAddress,
      shippingMethod,
      payment,
      pricing,
      status: "COMPLETED"
    });

    await order.save();

    res.status(201).json({
      id: order.id,
      createdAt: order.createdAt,
      status: order.status,
      pricing: order.pricing
    });
  } catch (error) {
    next(error);
  }
};

export const createDesign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, thumbnail, size, pricing, artboardData } = req.body;

    const design = new Design({
      user: req.user?.id,
      title,
      thumbnail,
      size,
      pricing,
      artboardData
    });

    await design.save();
    await User.updateOne({ _id: req.user?.id }, { $set: { artboardDraft: null } });

    res.status(201).json({
      id: design.id,
      title: design.title,
      createdAt: design.createdAt,
      updatedAt: design.updatedAt
    });
  } catch (error) {
    next(error);
  }
};

export const getArtboardDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user?.id).select("artboardDraft");
    res.json({ draft: user?.artboardDraft || null });
  } catch (error) {
    next(error);
  }
};

export const upsertArtboardDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { draft } = req.body || {};
    await User.updateOne({ _id: req.user?.id }, { $set: { artboardDraft: draft || null } });
    res.json({ message: "Draft saved" });
  } catch (error) {
    next(error);
  }
};

export const clearArtboardDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await User.updateOne({ _id: req.user?.id }, { $set: { artboardDraft: null } });
    res.json({ message: "Draft cleared" });
  } catch (error) {
    next(error);
  }
};

export const listDesigns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const designs = await Design.find({ user: req.user?.id })
      .select("title size thumbnail createdAt updatedAt")
      .sort({ updatedAt: -1 });

    const formattedDesigns = designs.map((design) => ({
      id: design.id,
      title: design.title,
      size: `${design.size.widthIn}" x ${design.size.heightIn}"`,
      thumbnail: design.thumbnail,
      createdAt: design.createdAt,
      updatedAt: design.updatedAt
    }));

    res.json({ designs: formattedDesigns });
  } catch (error) {
    next(error);
  }
};

export const searchDesigns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== "string") {
      return res.json({ designs: [] });
    }

    const designs = await Design.find({
      user: req.user?.id,
      title: { $regex: q, $options: "i" }
    })
      .select("title size thumbnail createdAt updatedAt")
      .sort({ updatedAt: -1 });

    const formattedDesigns = designs.map((design) => ({
      id: design.id,
      title: design.title,
      size: `${design.size.widthIn}" x ${design.size.heightIn}"`,
      thumbnail: design.thumbnail,
      createdAt: design.createdAt,
      updatedAt: design.updatedAt
    }));

    res.json({ designs: formattedDesigns });
  } catch (error) {
    next(error);
  }
};

export const getDesignById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { designId } = req.params;
    const design = await Design.findOne({ _id: designId, user: req.user?.id });

    if (!design) {
      const error = new Error("Design not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.json({
      id: design.id,
      title: design.title,
      size: design.size,
      pricing: design.pricing,
      artboardData: design.artboardData
    });
  } catch (error) {
    next(error);
  }
};

export const deleteDesign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { designId } = req.params;

    const design = await Design.findOneAndDelete({ _id: designId, user: req.user?.id });

    if (!design) {
      const error = new Error("Design not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({ message: "Design deleted successfully" });
  } catch (error) {
    next(error);
  }
};

export const updateDesign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { designId } = req.params;
    const { title, thumbnail, artboardData } = req.body;

    const updateData: any = {};
    if (title !== undefined) updateData.title = title;
    if (thumbnail !== undefined) updateData.thumbnail = thumbnail;
    if (artboardData !== undefined) updateData.artboardData = artboardData;

    if (Object.keys(updateData).length === 0) {
      const error = new Error("No fields provided to update") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const design = await Design.findOneAndUpdate(
      { _id: designId, user: req.user?.id },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!design) {
      const error = new Error("Design not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    res.json({
      id: design.id,
      title: design.title,
      updatedAt: design.updatedAt
    });
  } catch (error) {
    next(error);
  }
};

export const duplicateDesign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { designId } = req.params;
    const { newTitle } = req.body;

    if (!newTitle || !newTitle.trim()) {
      const error = new Error("newTitle is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const source = await Design.findOne({ _id: designId, user: req.user?.id });
    if (!source) {
      const error = new Error("Design not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const copy = new Design({
      user: req.user?.id,
      title: newTitle.trim(),
      thumbnail: source.thumbnail,
      size: source.size,
      pricing: source.pricing,
      artboardData: source.artboardData
    });

    await copy.save();

    res.status(201).json({
      id: copy.id,
      title: copy.title,
      createdAt: copy.createdAt
    });
  } catch (error) {
    next(error);
  }
};

export const listOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, limit, cursor } = req.query || {};

    const query: any = {
      user: req.user?.id
    };

    if (status) {
      const normalized = status.toString().trim().toLowerCase();
      const statusMap: { [key: string]: string[] } = {
        pending: ["PENDING"],
        processing: ["PROCESSING"],
        shipped: ["SHIPPED"],
        completed: ["COMPLETED", "PAID", "paid"],
        cancelled: ["CANCELLED"]
      };

      const mappedStatuses = statusMap[normalized];
      if (!mappedStatuses) {
        const error = new Error("Invalid status filter") as CustomError;
        error.statusCode = 400;
        throw error;
      }

      if (mappedStatuses.length === 1) {
        query.status = mappedStatuses[0];
      } else {
        query.status = { $in: mappedStatuses };
      }
    }

    if (cursor) {
      query._id = { $lt: cursor };
    }

    let parsedLimit = 20;
    if (limit !== undefined) {
      const n = parseInt(limit as string, 10);
      if (!Number.isNaN(n) && n > 0) {
        parsedLimit = Math.min(n, 100);
      }
    }

    const results = await Order.find(query)
      .sort({ _id: -1 })
      .limit(parsedLimit + 1);

    const hasMore = results.length > parsedLimit;
    const orders = hasMore ? results.slice(0, parsedLimit) : results;

    const apiStatusMap: { [key: string]: string } = {
      PENDING: "Pending",
      PROCESSING: "Processing",
      SHIPPED: "Shipped",
      COMPLETED: "Completed",
      CANCELLED: "Cancelled"
    };

    const formatSheetSize = (order: any) => {
      if (!order.items || order.items.length === 0) return null;
      const firstItem = order.items[0];
      if (
        typeof firstItem.widthIn === "number" &&
        typeof firstItem.heightIn === "number"
      ) {
        return `${firstItem.widthIn}" x ${firstItem.heightIn}"`;
      }
      return null;
    };

    const responseOrders = orders.map((order) => ({
      orderId: order.id,
      status: apiStatusMap[order.status] || order.status,
      date: order.createdAt,
      total: order.pricing?.total ?? null,
      sheetSize: formatSheetSize(order),
      trackingNumber: order.trackingNumber || null
    }));

    const nextCursor = hasMore ? orders[orders.length - 1].id : null;

    res.json({
      orders: responseOrders,
      nextCursor
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ _id: orderId, user: req.user?.id });

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const apiStatusMap: { [key: string]: string } = {
      PENDING: "Pending",
      PROCESSING: "Processing",
      SHIPPED: "Shipped",
      COMPLETED: "Completed",
      CANCELLED: "Cancelled"
    };

    const formattedItems = (order.items || []).map((item) => {
      let description = "";
      if (item.widthIn && item.heightIn) {
        description = `${item.widthIn}" x ${item.heightIn}"`;
      }

      return {
        name: item.name || "Unknown Item",
        description: description,
        quantity: item.quantity || 0,
        unitPrice: item.unitPrice || 0,
        subtotal: item.subtotal || 0
      };
    });

    const pricing = order.pricing || {};
    const lineItems = [
      { label: "Subtotal", amount: pricing.subtotal || 0 },
      { label: `Tax`, amount: pricing.tax || 0 },
      { label: "Shipping", amount: pricing.shippingCost || 0 }
    ];

    res.json({
      orderId: order.id,
      status: apiStatusMap[order.status] || order.status,
      items: formattedItems,
      shippingAddress: {
        name: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim() || "Valued Customer",
        street: order.shippingAddress?.street || "N/A",
        city: order.shippingAddress?.city || "N/A",
        state: order.shippingAddress?.state || "N/A",
        postalCode: order.shippingAddress?.postalCode || "N/A",
        country: order.shippingAddress?.country || "N/A"
      },
      payment: {
        method: order.payment?.method || "N/A",
        cardBrand: order.payment?.cardBrand || null,
        cardLast4: order.payment?.cardLast4 || null
      },
      pricing: {
        lineItems,
        total: pricing.total || 0,
        currency: pricing.currency || "USD"
      }
    });
  } catch (error) {
    next(error);
  }
};

export const uploadAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      const error = new Error("No file uploaded") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const port = env.port || 4000;
    const fileUrl = `http://localhost:${port}/uploads/${req.file.filename}`;

    let widthPx, heightPx, dpi;
    try {
      const metadata = await sharp(req.file.path).metadata();
      widthPx = metadata.width;
      heightPx = metadata.height;
      dpi = metadata.density || 72;
    } catch (err: any) {
      if (err.message && err.message.includes('unsupported image format')) {
        console.log(`Metadata extraction skipped for ${req.file.originalname}: Unsupported format`);
      } else {
        console.error("Error reading image metadata:", err);
      }
    }

    const asset = new Asset({
      user: req.user?.id,
      url: fileUrl,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      widthPx,
      heightPx,
      dpi
    });

    await asset.save();

    res.status(201).json({
      id: asset.id,
      url: asset.url,
      originalFilename: asset.originalFilename,
      sizeBytes: asset.sizeBytes,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      dpi: asset.dpi
    });
  } catch (error) {
    next(error);
  }
};

export const listAssets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assets = await Asset.find({ user: req.user?.id })
      .sort({ _id: -1 });

    const responseItems = assets.map(asset => ({
      id: asset.id,
      url: asset.url,
      originalFilename: asset.originalFilename,
      sizeBytes: asset.sizeBytes,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      dpi: asset.dpi
    }));

    res.json({
      items: responseItems
    });
  } catch (error) {
    next(error);
  }
};

const roundToTwo = (value: number) => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

export const getCartQuote = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { items, shippingMethod, shippingCountry, shippingPostalCode } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      const error = new Error("items array is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!shippingMethod) {
      const error = new Error("shippingMethod is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!shippingCountry) {
      const error = new Error("shippingCountry is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (!shippingPostalCode) {
      const error = new Error("shippingPostalCode is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const quoteItems: any[] = [];
    let subtotal = 0;

    for (const item of items) {
      const {
        name,
        type,
        designId,
        widthIn,
        heightIn,
        copies
      } = item || {};

      if (!name) {
        const error = new Error("Each item must have a name") as CustomError;
        error.statusCode = 400;
        throw error;
      }

      if (!type) {
        const error = new Error("Each item must have a type") as CustomError;
        error.statusCode = 400;
        throw error;
      }

      let unitPrice = 0;

      if (type === "gangsheet") {
        if (!designId) {
          const error = new Error("designId is required for gangsheet items") as CustomError;
          error.statusCode = 400;
          throw error;
        }

        const design = await Design.findOne({ _id: designId, user: req.user?.id });

        if (!design) {
          const error = new Error("Design not found for cart item") as CustomError;
          error.statusCode = 404;
          throw error;
        }

        if (design.pricing && typeof design.pricing.price === "number") {
          unitPrice = design.pricing.price;
        } else if (design.pricing && typeof design.pricing.areaSqFt === "number") {
          const baseRatePerSqFt = 10;
          unitPrice = design.pricing.areaSqFt * baseRatePerSqFt;
        } else if (typeof widthIn === "number" && typeof heightIn === "number") {
          const areaSqFt = (widthIn * heightIn) / 144;
          const baseRatePerSqFt = 10;
          unitPrice = areaSqFt * baseRatePerSqFt;
        } else {
          const error = new Error("Unable to determine price for gangsheet item") as CustomError;
          error.statusCode = 400;
          throw error;
        }
      } else {
        const error = new Error(`Unsupported cart item type: ${type}`) as CustomError;
        error.statusCode = 400;
        throw error;
      }

      const quantity = typeof copies === "number" && copies > 0 ? copies : 1;
      const lineSubtotal = unitPrice * quantity;

      subtotal += lineSubtotal;

      quoteItems.push({
        name,
        unitPrice: roundToTwo(unitPrice),
        quantity,
        subtotal: roundToTwo(lineSubtotal)
      });
    }

    subtotal = roundToTwo(subtotal);

    let shippingCost = 0;
    if (shippingMethod === "standard") {
      shippingCost = 8.99;
    } else if (shippingMethod === "express") {
      shippingCost = 19.99;
    }

    let taxRate = 0;
    if (shippingCountry === "United States") {
      taxRate = 0.094;
    }

    const tax = roundToTwo(subtotal * taxRate);
    const total = roundToTwo(subtotal + shippingCost + tax);

    res.status(200).json({
      items: quoteItems,
      subtotal,
      shippingCost,
      tax,
      total,
      currency: "USD"
    });
  } catch (error) {
    next(error);
  }
};

export const downloadInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ _id: orderId, user: req.user?.id });

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

    const data = {
      orderId: order.id,
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
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${order.id}.pdf"`);
    res.send(result.buffer);

  } catch (error) {
    next(error);
  }
};

export const reorder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const { quantityMultiplier = 1 } = req.body || {};

    if (typeof quantityMultiplier !== "number" || quantityMultiplier <= 0) {
      const error = new Error("quantityMultiplier must be a positive number") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const originalOrder = await Order.findOne({ _id: orderId, user: req.user?.id });

    if (!originalOrder) {
      const error = new Error("Original order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const newItems = originalOrder.items.map((item) => {
      const quantity = item.quantity * quantityMultiplier;
      const subtotal = item.unitPrice * quantity;

      return {
        type: item.type,
        designId: item.designId,
        name: item.name,
        widthIn: item.widthIn,
        heightIn: item.heightIn,
        quantity,
        unitPrice: item.unitPrice,
        subtotal
      };
    });

    const subtotal = newItems.reduce((sum, item) => sum + item.subtotal!, 0);
    const shippingCost = originalOrder.pricing.shippingCost || 0;
    const taxRate = originalOrder.pricing.subtotal && originalOrder.pricing.subtotal > 0 ? (originalOrder.pricing.tax || 0) / originalOrder.pricing.subtotal : 0;
    const tax = roundToTwo(subtotal * taxRate);
    const total = roundToTwo(subtotal + shippingCost + tax);

    const newOrder = new Order({
      user: req.user?.id,
      items: newItems,
      customer: originalOrder.customer,
      shippingAddress: originalOrder.shippingAddress,
      shippingMethod: originalOrder.shippingMethod,
      payment: {
        method: originalOrder.payment.method
      },
      pricing: {
        subtotal: roundToTwo(subtotal),
        shippingCost: roundToTwo(shippingCost),
        tax,
        total,
        currency: originalOrder.pricing.currency
      },
      status: "PENDING"
    });

    await newOrder.save();

    res.status(201).json({
      orderId: newOrder.id,
      status: "Pending",
      createdFrom: originalOrder.id
    });
  } catch (error) {
    next(error);
  }
};
