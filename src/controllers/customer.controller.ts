import { Request, Response, NextFunction } from "express";
import { User } from "../models/user.model.js";
import { Asset } from "../models/asset.model.js";
import { Design } from "../models/design.model.js";
import { Order } from "../models/order.model.js";
import { Settings } from "../models/settings.model.js";
import sharp from "sharp";
import mongoose from "mongoose";
import crypto from "node:crypto";
import os from "node:os";
import { env } from "../config/env.js";
import { generatePDF } from "pdf-node";
import fs from "fs";
import path from "path";
import { alphaTrimToFile, smartTrimToFile } from "../utils/aiCrop.js";
import { isRembgEnabled, runRembg } from "../utils/rembg.js";
import { uploadBufferToCloudinary, cloudinaryThumbUrl, isCloudinaryUrl } from "../utils/cloudinary.js";
import { autoAssignOrder } from "../services/orderAssignment.service.js";
import { getRegionFromState, getLatLngFromState, getRegionFromCoords, normalizeRegion } from "../utils/region.js";
import { geocodeAddress } from "../utils/geocoding.js";
import { sendEmail } from "../services/email.service.js";
import { notifyAllAdmins } from "../services/adminNotifications.service.js";

interface CustomError extends Error {
  statusCode?: number;
}

// For Cloudinary URLs use URL transformation; for legacy local URLs derive -thumb200.webp path.
const computeThumbUrl = (assetUrl: string | null | undefined): string | null => {
  if (!assetUrl) return null;
  if (isCloudinaryUrl(assetUrl)) return cloudinaryThumbUrl(assetUrl);
  const lastSlash = assetUrl.lastIndexOf("/");
  const lastDot = assetUrl.lastIndexOf(".");
  if (lastDot <= lastSlash) return null;
  return assetUrl.substring(0, lastDot) + "-thumb200.webp";
};

// Trim an image buffer using temp files, optionally running rembg first.
// Returns the trimmed PNG as a Buffer. Temp files are written to os.tmpdir().
const trimBuffer = async (inputBuffer: Buffer): Promise<Buffer> => {
  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const inputPath = path.join(tmpDir, `${id}-input.png`);
  const trimmedPath = path.join(tmpDir, `${id}-trim.png`);
  const cleanup = () => {
    fs.unlink(inputPath, () => {});
    fs.unlink(trimmedPath, () => {});
  };
  try {
    await sharp(inputBuffer, { limitInputPixels: false }).png().toFile(inputPath);
    if (isRembgEnabled()) {
      const rembgPath = path.join(tmpDir, `${id}-rembg.png`);
      await runRembg(inputPath, rembgPath);
      const alphaThreshold = parseInt(process.env.TRIM_ALPHA_THRESHOLD || "10", 10) || 10;
      const maxProbe = parseInt(process.env.TRIM_MAX_PROBE || "800", 10) || 800;
      await alphaTrimToFile(rembgPath, trimmedPath, { alphaThreshold, maxProbe });
      fs.unlink(rembgPath, () => {});
    } else {
      await smartTrimToFile(inputPath, trimmedPath);
    }
    return await fs.promises.readFile(trimmedPath);
  } finally {
    cleanup();
  }
};

export const trimAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      const error = new Error("url is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }
  
    // Accept Cloudinary URLs and legacy local /uploads/ URLs.
    const isLocal = url.includes("/uploads/");
    const isCdn = isCloudinaryUrl(url);
    if (!isLocal && !isCdn) {
      const error = new Error("Invalid asset url") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    // Fetch the source image into a buffer.
    let sourceBuffer: Buffer;
    if (isLocal) {
      const marker = "/uploads/";
      const idx = url.lastIndexOf(marker);
      const safeFilename = path.basename(url.substring(idx + marker.length));
      const localPath = path.join(process.cwd(), "uploads", safeFilename);
      if (fs.existsSync(localPath)) {
        sourceBuffer = await fs.promises.readFile(localPath);
      } else {
        // File not on disk (e.g. from a different server); fetch via HTTP if absolute URL.
        if (!/^https?:\/\//i.test(url)) {
          const error = new Error("Asset file not found") as CustomError;
          error.statusCode = 404;
          throw error;
        }
        const r = await fetch(url);
        if (!r.ok) {
          const error = new Error("Asset file not found") as CustomError;
          error.statusCode = 404;
          throw error;
        }
        sourceBuffer = Buffer.from(await r.arrayBuffer());
      }
    } else {
      const r = await fetch(url);
      if (!r.ok) {
        const error = new Error("Asset file not found") as CustomError;
        error.statusCode = 404;
        throw error;
      }
      sourceBuffer = Buffer.from(await r.arrayBuffer());
    }

    const trimmedBuffer = await trimBuffer(sourceBuffer);

    const { url: trimmedUrl } = await uploadBufferToCloudinary(trimmedBuffer, "space-transfers/trimmed");

    const meta = await sharp(trimmedBuffer, { limitInputPixels: false }).metadata();
    const normalizedDpi = Math.max(150, Math.round(meta.density || 300));
    const trimmedWidthPx = meta.width || null;
    const trimmedHeightPx = meta.height || null;
    const trimmedWidthIn = trimmedWidthPx ? +(trimmedWidthPx / normalizedDpi).toFixed(4) : null;
    const trimmedHeightIn = trimmedHeightPx ? +(trimmedHeightPx / normalizedDpi).toFixed(4) : null;

    res.json({ trimmedUrl, trimmedWidthPx, trimmedHeightPx, trimmedWidthIn, trimmedHeightIn });
  } catch (error) {
    next(error);
  }
};

export const updateAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, defaultShippingAddress, companyName, phone } = req.body;
    const userId = req.user?.id;

    const user = await User.findById(userId);
    if (!user) {
      const error = new Error("User not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    if (name) user.name = name;
    if (companyName) user.companyName = companyName;
    if (phone) user.phone = phone;

    if (defaultShippingAddress && typeof defaultShippingAddress === "object") {
      // Merge onto existing address so partial updates (e.g. just postalCode) don't wipe other fields.
      const merged: any = { ...(user.defaultShippingAddress as any || {}), ...defaultShippingAddress };
      user.defaultShippingAddress = merged;

      // Re-derive region whenever the address changes.
      const stateCode = String(merged.state || "").trim();
      let newRegion = normalizeRegion(getRegionFromState(stateCode));

      if (!newRegion) {
        // Geocode in the background and patch the user record once we have a result.
        // We don't await here so the response is not delayed.
        (async () => {
          try {
            const geo = await geocodeAddress({
              street: merged.street, city: merged.city, state: merged.state,
              zip: merged.postalCode, country: merged.country,
            });
            if (!geo) return;
            const geoRegion = normalizeRegion(getRegionFromState(geo.state)) ?? getRegionFromCoords(geo.lat, geo.lng);
            await User.updateOne(
              { _id: userId },
              {
                $set: {
                  "defaultShippingAddress.coordinates": { lat: geo.lat, lng: geo.lng },
                  "defaultShippingAddress.state": geo.state || merged.state,
                  regions: [geoRegion],
                  detectedRegion: geoRegion,
                },
              }
            );
            console.log(`[region-assign] role=CUSTOMER id=${userId} state=${geo.state} region=${geoRegion} geocoded=true (account update)`);
          } catch (geoErr) {
            console.error("[region-assign] geocode failed during account update:", (geoErr as any)?.message);
          }
        })().catch(() => {});
      } else {
        user.regions = [newRegion];
        (user as any).detectedRegion = newRegion;
        console.log(`[region-assign] role=CUSTOMER id=${userId} state=${stateCode} region=${newRegion} geocoded=false (account update)`);
      }
    }

    await user.save();

    const userResponse: any = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      detectedRegion: (user as any).detectedRegion ?? user.regions?.[0] ?? null,
    };
    if (user.companyName) userResponse.companyName = user.companyName;
    if (user.phone) userResponse.phone = user.phone;
    if (user.defaultShippingAddress) userResponse.defaultShippingAddress = user.defaultShippingAddress;

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

    if (payment.method === "paypal" && (!payment.paypalOrderId || !payment.paypalCaptureId)) {
      const error = new Error("payment.paypalOrderId and payment.paypalCaptureId are required for PayPal payments") as CustomError;
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
        unitPrice,
        sheetWidthIn,
        sheetHeightIn,
        previewImage,
        artboardItems
      } = item || {};

      if (!type || !name || typeof quantity !== "number" || typeof unitPrice !== "number") {
        const error = new Error("Each item requires type, name, quantity and unitPrice") as CustomError;
        error.statusCode = 400;
        throw error;
      }

      const lineSubtotal = unitPrice * quantity;
      computedSubtotal += lineSubtotal;

      const normalizedArtboardItems = Array.isArray(artboardItems)
        ? artboardItems
            .filter(Boolean)
            .map((it: any) => ({
              id: Number(it.id),
              assetId: String(it.assetId || ""),
              croppedUrl: typeof it.croppedUrl === "string" ? it.croppedUrl : undefined,
              autoCrop: typeof it.autoCrop === "boolean" ? it.autoCrop : undefined,
              widthIn: Number(it.widthIn),
              heightIn: Number(it.heightIn),
              posX: Number(it.posX),
              posY: Number(it.posY),
              rotation: typeof it.rotation === "number" ? it.rotation : 0,
              copies: typeof it.copies === "number" ? it.copies : 1,
              linked: Boolean(it.linked)
            }))
            .filter((it: any) =>
              Number.isFinite(it.id) &&
              it.assetId &&
              Number.isFinite(it.widthIn) &&
              Number.isFinite(it.heightIn) &&
              Number.isFinite(it.posX) &&
              Number.isFinite(it.posY)
            )
        : undefined;

      return {
        type,
        designId,
        name,
        widthIn,
        heightIn,
        quantity,
        unitPrice,
        subtotal: lineSubtotal,
        sheetWidthIn: typeof sheetWidthIn === "number" ? sheetWidthIn : undefined,
        sheetHeightIn: typeof sheetHeightIn === "number" ? sheetHeightIn : undefined,
        previewImage: typeof previewImage === "string" ? previewImage : undefined,
        artboardItems: normalizedArtboardItems && normalizedArtboardItems.length > 0 ? normalizedArtboardItems : undefined
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

    const currentUser = req.user?.id
      ? await User.findById(req.user.id).select("regions").lean()
      : null;

    // Derive region strictly from the shipping address state — same function used during
    // auto-assignment. Returns null for non-US / unknown state codes; never defaults to "West".
    const stateBasedRegion = getRegionFromState(shippingAddress?.state);
    const stateCoord = getLatLngFromState(shippingAddress?.state);

    // customer.region field is cosmetic only — do not use it to override the address region.
    const normalizedCustomer = {
      ...customer,
      region: stateBasedRegion || null
    };

    const nextOrderDisplayId = async () => {
      const counter = await Settings.findOneAndUpdate(
        { key: "order_display_counter" },
        { $inc: { "value.next": 1 } },
        { new: true, upsert: true, runValidators: true }
      ).lean();
      const seq = Number((counter as any)?.value?.next || 1) - 1;
      return `DTF-${String(seq).padStart(4, "0")}`;
    };

    const enrichedShippingAddress = {
      ...shippingAddress,
      // Only store detectedRegion when we have a confirmed US state — never store "West" as a
      // default, because the assignment service reads this field and a stale "West" causes
      // false-positive region matches with West-region printers.
      detectedRegion: stateBasedRegion ?? undefined,
      coordinates: stateCoord ? { lat: stateCoord.lat, lng: stateCoord.lon } : undefined,
      geocoded: false
    };

    const order = new Order({
      user: req.user?.id,
      displayId: await nextOrderDisplayId(),
      items: orderItems,
      customer: normalizedCustomer,
      shippingAddress: enrichedShippingAddress,
      shippingMethod,
      payment,
      pricing,
      status: "PENDING"
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await order.save();
        break;
      } catch (e: any) {
        const isDup = e?.code === 11000 && (e?.keyPattern?.displayId || e?.keyValue?.displayId);
        if (!isDup || attempt === 2) throw e;
        order.displayId = await nextOrderDisplayId();
      }
    }

    // Fire-and-forget: geocode to verify/correct state code and get precise coordinates.
    // The assignment service uses detectedRegion from the order — this updates it in the background.
    const orderId = order.id;
    (async () => {
      try {
        const geo = await geocodeAddress({
          street: shippingAddress.street,
          city: shippingAddress.city,
          state: shippingAddress.state,
          zip: shippingAddress.postalCode,
          country: shippingAddress.country
        });
        if (geo) {
          const geoRegion =
            normalizeRegion(getRegionFromState(geo.state)) ??
            getRegionFromCoords(geo.lat, geo.lng);
          await Order.findByIdAndUpdate(orderId, {
            "shippingAddress.detectedRegion": geoRegion,
            "shippingAddress.coordinates": { lat: geo.lat, lng: geo.lng },
            "shippingAddress.geocoded": true,
            "customer.region": geoRegion
          });
          console.log(`[ORDER_GEO] orderId=${orderId} geocodedState=${geo.state} region=${geoRegion} lat=${geo.lat} lng=${geo.lng}`);
        }
      } catch (err: any) {
        console.warn(`[ORDER_GEO] orderId=${orderId} geocoding failed (non-fatal): ${err?.message}`);
      }
    })();

    notifyAllAdmins({
      category: "orders",
      priority: "medium",
      title: "New order placed",
      message: `${String(customer.firstName)} ${String(customer.lastName)} • $${Number(pricing.total).toFixed(2)}`,
      meta: { orderId: order.id, status: "PENDING" }
    }).catch(() => {});

    const assignment = await Promise.race([
      autoAssignOrder(order.id),
      new Promise<{ assigned: false; orderId: string; reason: string; tookMs: number }>((resolve) =>
        setTimeout(() => resolve({ assigned: false, orderId: order.id, reason: "Assignment timed out", tookMs: 2000 }), 1900)
      )
    ]);

    const refreshed = await Order.findById(order.id)
      .select("status assignedPrinter")
      .populate("assignedPrinter", "companyName name email")
      .lean();

    res.status(201).json({
      id: order.id,
      displayId: (order as any).displayId || null,
      createdAt: order.createdAt,
      status: refreshed?.status || order.status,
      pricing: order.pricing,
      assignment,
      assignedPrinter: refreshed?.assignedPrinter
        ? {
            id: (refreshed.assignedPrinter as any)?._id,
            name: (refreshed.assignedPrinter as any)?.companyName || (refreshed.assignedPrinter as any)?.name,
            email: (refreshed.assignedPrinter as any)?.email
          }
        : null
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

export const getCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user?.id).select("cart");
    res.json({ cart: user?.cart || [] });
  } catch (error) {
    next(error);
  }
};

export const updateCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cart } = req.body || {};
    await User.updateOne({ _id: req.user?.id }, { $set: { cart: cart || [] } });
    res.json({ message: "Cart updated" });
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

    const fileBuffer = req.file.buffer;

    // Deduplication: if this user already uploaded the exact same file, reuse it.
    const contentHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const existingAsset = req.user?.id ? await Asset.findOne({
      user: new mongoose.Types.ObjectId(String(req.user.id)),
      contentHash,
    }).lean() as any : null;
    if (existingAsset) {
      const thumbUrl = computeThumbUrl(existingAsset.trimmedUrl || existingAsset.url);
      const normDpi = existingAsset.dpi || 300;
      return res.json({
        id: String(existingAsset._id),
        url: existingAsset.url,
        trimmedUrl: existingAsset.trimmedUrl || null,
        thumbnailUrl: thumbUrl,
        originalFilename: existingAsset.originalFilename,
        sizeBytes: existingAsset.sizeBytes,
        widthPx: existingAsset.widthPx,
        heightPx: existingAsset.heightPx,
        dpi: normDpi,
        widthIn: existingAsset.widthPx ? +(existingAsset.widthPx / normDpi).toFixed(4) : undefined,
        heightIn: existingAsset.heightPx ? +(existingAsset.heightPx / normDpi).toFixed(4) : undefined,
        trimmedWidthPx: existingAsset.trimmedWidthPx || null,
        trimmedHeightPx: existingAsset.trimmedHeightPx || null,
        trimmedWidthIn: existingAsset.trimmedWidthPx ? +(existingAsset.trimmedWidthPx / normDpi).toFixed(4) : null,
        trimmedHeightIn: existingAsset.trimmedHeightPx ? +(existingAsset.trimmedHeightPx / normDpi).toFixed(4) : null,
        deduplicated: true,
      });
    }

    // Upload original to Cloudinary.
    const { url: fileUrl } = await uploadBufferToCloudinary(fileBuffer, "space-transfers/assets");

    let widthPx: number | undefined, heightPx: number | undefined, dpi: number | undefined;
    try {
      const metadata = await sharp(fileBuffer, { limitInputPixels: false }).metadata();
      widthPx = metadata.width;
      heightPx = metadata.height;
      dpi = metadata.density || 300;
    } catch (err: any) {
      if (err.message && err.message.includes('unsupported image format')) {
        console.log(`Metadata extraction skipped for ${req.file.originalname}: Unsupported format`);
      } else {
        console.error("Error reading image metadata:", err);
      }
    }

    const normalizedDpi = (!dpi || dpi < 150) ? 300 : dpi;
    const widthIn = widthPx && normalizedDpi ? +(widthPx / normalizedDpi).toFixed(4) : undefined;
    const heightIn = heightPx && normalizedDpi ? +(heightPx / normalizedDpi).toFixed(4) : undefined;

    // Trim and upload trimmed version to Cloudinary.
    let trimmedUrl: string | undefined;
    let trimmedWidthPx: number | undefined;
    let trimmedHeightPx: number | undefined;
    let trimmedWidthIn: number | undefined;
    let trimmedHeightIn: number | undefined;
    try {
      const trimmedBuffer = await trimBuffer(fileBuffer);
      const { url: tUrl } = await uploadBufferToCloudinary(trimmedBuffer, "space-transfers/trimmed");
      trimmedUrl = tUrl;
      const trimmedMeta = await sharp(trimmedBuffer, { limitInputPixels: false }).metadata();
      trimmedWidthPx = trimmedMeta.width;
      trimmedHeightPx = trimmedMeta.height;
      trimmedWidthIn = trimmedWidthPx && normalizedDpi ? +(trimmedWidthPx / normalizedDpi).toFixed(4) : undefined;
      trimmedHeightIn = trimmedHeightPx && normalizedDpi ? +(trimmedHeightPx / normalizedDpi).toFixed(4) : undefined;
    } catch {
      trimmedUrl = undefined;
    }

    // Cloudinary thumbnail is derived from the URL — no local generation needed.
    const thumbnailUrl = computeThumbUrl(trimmedUrl || fileUrl);

    // Guest uploads: return metadata without persisting to the database
    if (!req.user?.id) {
      return res.status(201).json({
        url: fileUrl,
        trimmedUrl: trimmedUrl || null,
        thumbnailUrl,
        originalFilename: req.file.originalname,
        sizeBytes: req.file.size,
        widthPx,
        heightPx,
        dpi: normalizedDpi,
        widthIn,
        heightIn,
        trimmedWidthPx: trimmedWidthPx || null,
        trimmedHeightPx: trimmedHeightPx || null,
        trimmedWidthIn: trimmedWidthIn || null,
        trimmedHeightIn: trimmedHeightIn || null,
      });
    }

    const asset = new Asset({
      user: req.user.id,
      url: fileUrl,
      trimmedUrl,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      widthPx,
      heightPx,
      trimmedWidthPx,
      trimmedHeightPx,
      dpi: normalizedDpi,
      contentHash,
    });

    await asset.save();

    res.status(201).json({
      id: asset.id,
      url: asset.url,
      trimmedUrl: asset.trimmedUrl || null,
      thumbnailUrl,
      originalFilename: asset.originalFilename,
      sizeBytes: asset.sizeBytes,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      dpi: asset.dpi,
      widthIn,
      heightIn,
      trimmedWidthPx: asset.trimmedWidthPx || null,
      trimmedHeightPx: asset.trimmedHeightPx || null,
      trimmedWidthIn: trimmedWidthIn || null,
      trimmedHeightIn: trimmedHeightIn || null
    });
  } catch (error) {
    next(error);
  }
};

export const listAssets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pageSize = Math.max(1, Math.min(500, parseInt(String(req.query.limit || "200"), 10) || 200));
    const cursor = typeof req.query.cursor === "string" && mongoose.Types.ObjectId.isValid(req.query.cursor)
      ? req.query.cursor
      : null;

    const query: any = { user: req.user?.id };
    if (cursor) query._id = { $lt: new mongoose.Types.ObjectId(cursor) };

    // Fetch one extra to detect whether a next page exists.
    const assets = await Asset.find(query)
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .select("url trimmedUrl originalFilename sizeBytes widthPx heightPx trimmedWidthPx trimmedHeightPx dpi");

    const hasMore = assets.length > pageSize;
    const page = hasMore ? assets.slice(0, pageSize) : assets;
    const nextCursor = hasMore ? String(page[page.length - 1]._id) : null;

    const items = page.map((asset) => ({
      id: asset.id,
      url: asset.url,
      trimmedUrl: asset.trimmedUrl || null,
      thumbnailUrl: computeThumbUrl(asset.trimmedUrl || asset.url),
      originalFilename: asset.originalFilename,
      sizeBytes: asset.sizeBytes,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      trimmedWidthPx: asset.trimmedWidthPx || null,
      trimmedHeightPx: asset.trimmedHeightPx || null,
      dpi: asset.dpi,
    }));

    res.json({ items, nextCursor });
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
          const baseRatePerSqFt = 3.5;
          unitPrice = design.pricing.areaSqFt * baseRatePerSqFt;
        } else if (typeof widthIn === "number" && typeof heightIn === "number") {
          const areaSqFt = (widthIn * heightIn) / 144;
          const baseRatePerSqFt = 3.5;
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

export const sendGangsheetUtilizationWarning = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { fullSheetPrice, sheetWidthIn, sheetHeightIn, utilizationPct } = req.body;

    const price = Number(fullSheetPrice);
    if (!Number.isFinite(price) || price <= 0) {
      const error = new Error("fullSheetPrice must be a positive number") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const width = Number(sheetWidthIn || 23.5);
    const height = Number(sheetHeightIn || 23.5);
    const pct = utilizationPct != null ? Number(utilizationPct) : null;
    const pctText = pct != null && Number.isFinite(pct) ? `${pct.toFixed(0)}%` : "N/A";

    const amountText = `$${price.toFixed(2)}`;

    const subject = "Unused gang sheet space notice";
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
        <h2 style="margin: 0 0 12px 0;">Unused gang sheet space</h2>
        <p style="margin: 0 0 12px 0;">
          Your gang sheet (${width.toFixed(1)}&quot; × ${height.toFixed(1)}&quot;) is not fully utilized.
        </p>
        <p style="margin: 0 0 12px 0;">
          If you proceed, you will be charged the full gang sheet amount of <strong>${amountText}</strong>.
        </p>
        <p style="margin: 0 0 0 0; color: #6B7280; font-size: 12px;">
          Utilization: ${pctText}
        </p>
      </div>
    `;

    const sendResult = await sendEmail({ to: user.email, subject, html });

    console.log(
      `[GANGSHEET_WARN] user=${user.id} email=${user.email} fullSheetPrice=${amountText} utilization=${pctText} sent=${sendResult.sent}`
    );

    res.status(200).json({ sent: sendResult.sent });
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
