import { User } from "../models/user.model.js";
import { Asset } from "../models/asset.model.js";
import { Design } from "../models/design.model.js";
import { Order } from "../models/order.model.js";
import sharp from "sharp";
import { env } from "../config/env.js";

export const updateAccount = async (req, res, next) => {
  try {
    const { name, defaultShippingAddress, companyName, phone } = req.body;
    const userId = req.user.id;

    const updateData = {};
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
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    const userResponse = {
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

export const logout = async (req, res, next) => {
  try {
    // In a stateless JWT system, logout is handled client-side by discarding the token.
    // However, if we were using cookies or a token blacklist, we would handle that here.
    // For now, we'll just return a success response.
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
};

export const createOrder = async (req, res, next) => {
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
      const error = new Error("items array is required");
      error.statusCode = 400;
      throw error;
    }

    if (!customer || !customer.firstName || !customer.lastName || !customer.email) {
      const error = new Error("customer.firstName, customer.lastName and customer.email are required");
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
      const error = new Error("shippingAddress.street, city, state, postalCode and country are required");
      error.statusCode = 400;
      throw error;
    }

    if (!shippingMethod) {
      const error = new Error("shippingMethod is required");
      error.statusCode = 400;
      throw error;
    }

    if (!payment || !payment.method) {
      const error = new Error("payment.method is required");
      error.statusCode = 400;
      throw error;
    }

    if (payment.method === "card" && !payment.paymentIntentId) {
      const error = new Error("payment.paymentIntentId is required for card payments");
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
      const error = new Error("pricing with subtotal, shippingCost, tax, total and currency is required");
      error.statusCode = 400;
      throw error;
    }

    let computedSubtotal = 0;
    const orderItems = items.map((item) => {
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
        const error = new Error("Each item requires type, name, quantity and unitPrice");
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

    const roundToTwo = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
    const roundedComputedSubtotal = roundToTwo(computedSubtotal);

    if (roundToTwo(pricing.subtotal) !== roundedComputedSubtotal) {
      const error = new Error("pricing.subtotal does not match computed items subtotal");
      error.statusCode = 400;
      throw error;
    }

    const expectedTotal = roundToTwo(pricing.subtotal + pricing.shippingCost + pricing.tax);
    if (roundToTwo(pricing.total) !== expectedTotal) {
      const error = new Error("pricing.total does not match subtotal + shippingCost + tax");
      error.statusCode = 400;
      throw error;
    }

    const order = new Order({
      user: req.user.id,
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

export const createDesign = async (req, res, next) => {
  try {
    const { title, thumbnail, size, pricing, artboardData } = req.body;

    const design = new Design({
      user: req.user.id,
      title,
      thumbnail,
      size,
      pricing,
      artboardData
    });

    await design.save();

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

export const listDesigns = async (req, res, next) => {
  try {
    const designs = await Design.find({ user: req.user.id })
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

export const getDesignById = async (req, res, next) => {
  try {
    const { designId } = req.params;
    const design = await Design.findOne({ _id: designId, user: req.user.id });

    if (!design) {
      const error = new Error("Design not found");
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

export const deleteDesign = async (req, res, next) => {
  try {
    const { designId } = req.params;

    const design = await Design.findOneAndDelete({ _id: designId, user: req.user.id });

    if (!design) {
      const error = new Error("Design not found");
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({ message: "Design deleted successfully" });
  } catch (error) {
    next(error);
  }
};

export const updateDesign = async (req, res, next) => {
  try {
    const { designId } = req.params;
    const { title, thumbnail, artboardData } = req.body;

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (thumbnail !== undefined) updateData.thumbnail = thumbnail;
    if (artboardData !== undefined) updateData.artboardData = artboardData;

    if (Object.keys(updateData).length === 0) {
      const error = new Error("No fields provided to update");
      error.statusCode = 400;
      throw error;
    }

    const design = await Design.findOneAndUpdate(
      { _id: designId, user: req.user.id },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!design) {
      const error = new Error("Design not found");
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

export const duplicateDesign = async (req, res, next) => {
  try {
    const { designId } = req.params;
    const { newTitle } = req.body;

    if (!newTitle || !newTitle.trim()) {
      const error = new Error("newTitle is required");
      error.statusCode = 400;
      throw error;
    }

    const source = await Design.findOne({ _id: designId, user: req.user.id });
    if (!source) {
      const error = new Error("Design not found");
      error.statusCode = 404;
      throw error;
    }

    const copy = new Design({
      user: req.user.id,
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

export const listOrders = async (req, res, next) => {
  try {
    const { status, limit, cursor } = req.query || {};

    const query = {
      user: req.user.id
    };

    if (status) {
      const normalized = status.toString().trim().toLowerCase();
      const statusMap = {
        pending: ["PENDING"],
        processing: ["PROCESSING"],
        shipped: ["SHIPPED"],
        // Include legacy "paid" orders under Completed filter
        completed: ["COMPLETED", "PAID", "paid"],
        cancelled: ["CANCELLED"]
      };

      const mappedStatuses = statusMap[normalized];
      if (!mappedStatuses) {
        const error = new Error("Invalid status filter");
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
      const n = parseInt(limit, 10);
      if (!Number.isNaN(n) && n > 0) {
        parsedLimit = Math.min(n, 100);
      }
    }

    const results = await Order.find(query)
      .sort({ _id: -1 })
      .limit(parsedLimit + 1);

    const hasMore = results.length > parsedLimit;
    const orders = hasMore ? results.slice(0, parsedLimit) : results;

    const apiStatusMap = {
      PENDING: "Pending",
      PROCESSING: "Processing",
      SHIPPED: "Shipped",
      COMPLETED: "Completed",
      CANCELLED: "Cancelled"
    };

    const formatSheetSize = (order) => {
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

export const getOrderById = async (req, res, next) => {
  try {
    res.json({ message: "Customer get order by id blueprint" });
  } catch (error) {
    next(error);
  }
};

export const uploadAsset = async (req, res, next) => {
  try {
    if (!req.file) {
      const error = new Error("No file uploaded");
      error.statusCode = 400;
      throw error;
    }

    // In a real app, we would upload to S3 or similar and get the URL.
    // Here we'll simulate it by using the local path or a dummy URL.
    // Assuming the upload middleware stores the file in 'uploads/' and sets req.file.path

    // For this simulation, we'll create a dummy URL based on the filename
    const port = env.port || 4000;
    const fileUrl = `http://localhost:${port}/uploads/${req.file.filename}`;

    // Get image metadata using sharp
    let widthPx, heightPx, dpi;
    try {
      const metadata = await sharp(req.file.path).metadata();
      widthPx = metadata.width;
      heightPx = metadata.height;
      dpi = metadata.density || 72; // Default to 72 if not present
    } catch (err) {
      // Suppress "unsupported image format" errors (e.g. for PSDs) to avoid noise
      if (err.message && err.message.includes('unsupported image format')) {
        console.log(`Metadata extraction skipped for ${req.file.originalname}: Unsupported format`);
      } else {
        console.error("Error reading image metadata:", err);
      }
    }

    const asset = new Asset({
      user: req.user.id,
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

export const listAssets = async (req, res, next) => {
  try {
    const assets = await Asset.find({ user: req.user.id })
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

const roundToTwo = (value) => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

export const getCartQuote = async (req, res, next) => {
  try {
    const { items, shippingMethod, shippingCountry, shippingPostalCode } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      const error = new Error("items array is required");
      error.statusCode = 400;
      throw error;
    }

    if (!shippingMethod) {
      const error = new Error("shippingMethod is required");
      error.statusCode = 400;
      throw error;
    }

    if (!shippingCountry) {
      const error = new Error("shippingCountry is required");
      error.statusCode = 400;
      throw error;
    }

    if (!shippingPostalCode) {
      const error = new Error("shippingPostalCode is required");
      error.statusCode = 400;
      throw error;
    }

    const quoteItems = [];
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
        const error = new Error("Each item must have a name");
        error.statusCode = 400;
        throw error;
      }

      if (!type) {
        const error = new Error("Each item must have a type");
        error.statusCode = 400;
        throw error;
      }

      let unitPrice = 0;

      if (type === "gangsheet") {
        if (!designId) {
          const error = new Error("designId is required for gangsheet items");
          error.statusCode = 400;
          throw error;
        }

        const design = await Design.findOne({ _id: designId, user: req.user.id });

        if (!design) {
          const error = new Error("Design not found for cart item");
          error.statusCode = 404;
          throw error;
        }

        if (design.pricing && typeof design.pricing.price === "number") {
          unitPrice = design.pricing.price;
        } else if (design.pricing && typeof design.pricing.areaSqFt === "number") {
          const baseRatePerSqFt = 10; // fallback heuristic
          unitPrice = design.pricing.areaSqFt * baseRatePerSqFt;
        } else if (typeof widthIn === "number" && typeof heightIn === "number") {
          const areaSqFt = (widthIn * heightIn) / 144;
          const baseRatePerSqFt = 10;
          unitPrice = areaSqFt * baseRatePerSqFt;
        } else {
          const error = new Error("Unable to determine price for gangsheet item");
          error.statusCode = 400;
          throw error;
        }
      } else {
        const error = new Error(`Unsupported cart item type: ${type}`);
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

