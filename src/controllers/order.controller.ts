import { Request, Response, NextFunction } from "express";
import { Order } from "../models/order.model.js";
import { UserRole } from "../models/user.model.js";
import { Design } from "../models/design.model.js";
import { addOrderClient, removeOrderClient } from "../services/orderSyncHub.js";

/**
 * Retrieves recent orders with pagination and role-based visibility rules.
 * Optimized for performance using select, lean, and indexes.
 */
export const getRecentOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { 
      limit = "10", 
      cursor, 
      status 
    } = req.query;

    const parsedLimit = Math.min(parseInt(limit as string, 10) || 10, 50);
    const query: any = {};

    // 1. Authorization & Scoping
    if (!req.user) {
      // Guest Scenario: Public Recent Activity Feed
      // For privacy, we only show public-friendly data
      // Maybe only show orders that are COMPLETED or processing
      query.status = { $in: ["PROCESSING", "PRINTING", "SHIPPED", "COMPLETED"] };
    } else if (req.user.role === UserRole.ADMIN) {
      // Admin: See everything
      if (status) query.status = status;
    } else if (req.user.role === UserRole.PRINTER) {
      // Printer: Only assigned orders
      query.assignedPrinter = req.user.id;
      if (status) query.status = status;
    } else {
      // Customer: Only own orders
      query.user = req.user.id;
      if (status) query.status = status;
    }

    // 2. Cursor-based Pagination for performance
    if (cursor) {
      query._id = { $lt: cursor };
    }

    // 3. Execution
    // Use select to minimize bandwidth and lean for raw objects (faster)
    const orders = await Order.find(query)
      .sort({ _id: -1 })
      .limit(parsedLimit + 1)
      .select("id customer items pricing status createdAt user")
      .lean();

    const hasNextPage = orders.length > parsedLimit;
    const results = hasNextPage ? orders.slice(0, parsedLimit) : orders;

    // 4. Formatting & Visibility (Post-Processing)
    const formattedOrders = results.map(order => {
      const isOwnerOrStaff = req.user && (
        req.user.role === UserRole.ADMIN || 
        req.user.role === UserRole.PRINTER || 
        (req.user.role === UserRole.CUSTOMER && order.user?.toString() === req.user.id)
      );

      if (isOwnerOrStaff) {
        // Return full details for owners/staff
        return {
          id: order._id,
          customer: order.customer,
          items: order.items,
          total: order.pricing.total,
          currency: order.pricing.currency,
          status: order.status,
          createdAt: order.createdAt
        };
      } else {
        // Guest Visibility Rules: Anonymize for privacy
        return {
          id: order._id.toString().substring(0, 8) + "...", // Partial ID
          customer: {
            firstName: order.customer.firstName,
            lastName: order.customer.lastName.charAt(0) + "." // Anonymized
          },
          items: order.items.map(item => ({ name: item.name, quantity: item.quantity })),
          total: order.pricing.total,
          currency: order.pricing.currency,
          status: order.status,
          createdAt: order.createdAt
        };
      }
    });

    const nextCursor = hasNextPage ? results[results.length - 1]._id : null;

    res.status(200).json({
      orders: formattedOrders,
      nextCursor,
      count: formattedOrders.length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieves a single order by ID with role-based access control.
 */
export const getOrderById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .populate("user", "name email")
      .populate("assignedPrinter", "name companyName email")
      .lean();

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Authorization check
    const isAdmin = req.user?.role === UserRole.ADMIN;
    const isAssignedPrinter = req.user?.role === UserRole.PRINTER && order.assignedPrinter?._id.toString() === req.user.id;
    const isOwner = req.user?.role === UserRole.CUSTOMER && order.user?._id.toString() === req.user.id;

    if (!isAdmin && !isAssignedPrinter && !isOwner) {
      return res.status(403).json({ message: "You do not have permission to view this order" });
    }

    // Fetch design thumbnail for the first item if available
    let designThumbnail = null;
    const designId = order.items?.[0]?.designId;
    if (designId && /^[0-9a-fA-F]{24}$/.test(designId)) {
      const design = await Design.findById(designId).select("thumbnail").lean();
      if (design && design.thumbnail) {
        designThumbnail = design.thumbnail;
      }
    }

    const orderResponse = {
      ...order,
      preview: {
        fileUrl: designThumbnail
      }
    };

    res.status(200).json(orderResponse);
  } catch (error) {
    next(error);
  }
};

export const streamOrderEvents = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId).select("user assignedPrinter status updatedAt").lean();
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const isAdmin = req.user?.role === UserRole.ADMIN;
    const isAssignedPrinter =
      req.user?.role === UserRole.PRINTER && String(order.assignedPrinter || "") === String(req.user.id);
    const isOwner = req.user?.role === UserRole.CUSTOMER && String((order as any).user || "") === String(req.user.id);

    if (!isAdmin && !isAssignedPrinter && !isOwner) {
      return res.status(403).json({ message: "You do not have permission to view this order" });
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    res.write(`event: order.snapshot\ndata: ${JSON.stringify({ orderId: String(order._id), status: order.status, updatedAt: order.updatedAt })}\n\n`);

    addOrderClient(String(order._id), res);

    req.on("close", () => {
      removeOrderClient(String(order._id), res);
    });
  } catch (error) {
    next(error);
  }
};
