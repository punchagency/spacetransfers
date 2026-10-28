import mongoose from "mongoose";
 import { Request, Response, NextFunction } from "express";
import { Order } from "../models/order.model.js";
import { UserRole } from "../models/user.model.js";
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

    if (!req.user) {
      const error = new Error("Authentication required") as any;
      error.statusCode = 401;
      throw error;
    }

    if (req.user.role === UserRole.ADMIN) {
      // Admin: See everything
      if (typeof status === "string" && status) query.status = status;
    } else if (req.user.role === UserRole.PRINTER) {
      // Printer: Only assigned orders
      query.assignedPrinter = req.user.id;
      if (typeof status === "string" && status) query.status = status;
    } else {
      // Customer: Only own orders
      query.user = req.user.id;                 
      if (typeof status === "string" && status) query.status = status;
    }

    /*
     * Cursor pagination. Validated before it reaches the query: an id that is
     * not an ObjectId made Mongoose throw a CastError, which the error handler
     * returned verbatim — `Cast to ObjectId failed … for model "Order"` — so a
     * malformed query string answered 500 and named our schema to the caller.
     */
    if (cursor) {
      if (!mongoose.Types.ObjectId.isValid(String(cursor))) {
        const error = new Error("Invalid cursor") as any;
        error.statusCode = 400;
        throw error;
      }
      query._id = { $lt: new mongoose.Types.ObjectId(String(cursor)) };
    }

    // 3. Execution
    // Use select to minimize bandwidth and lean for raw objects (faster)
    const orders = await Order.find(query)
      .sort({ _id: -1 })
      .limit(parsedLimit + 1)
      .select("status createdAt")
      .lean();

    const hasNextPage = orders.length > parsedLimit;
    const results = hasNextPage ? orders.slice(0, parsedLimit) : orders;

    // 4. Formatting & Visibility (Post-Processing)
    const formattedOrders = results.map((order) => ({
      id: String(order._id),
      status: order.status,
      createdAt: order.createdAt,
    }));

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
      .select("user assignedPrinter displayId status trackingNumber carrier createdAt updatedAt")
      .lean();

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Authorization check
    const isAdmin = req.user?.role === UserRole.ADMIN;
    const isAssignedPrinter = req.user?.role === UserRole.PRINTER && String(order.assignedPrinter || "") === String(req.user.id);
    const isOwner = req.user?.role === UserRole.CUSTOMER && String(order.user || "") === String(req.user.id);

    if (!isAdmin && !isAssignedPrinter && !isOwner) {
      return res.status(403).json({ message: "You do not have permission to view this order" });
    }

    /*
     * Where the order stands, and nothing else. This used to return the whole
     * record to all three: a partner read what the customer paid, a customer
     * read which partner printed it and what it cost. Each app has its own
     * order endpoint with the fields its side is meant to see.
     */
    res.status(200).json({
      id: String(order._id),
      displayId: (order as any).displayId || null,
      status: order.status,
      trackingNumber: (order as any).trackingNumber || null,
      carrier: (order as any).carrier || null,
      createdAt: order.createdAt,
      updatedAt: (order as any).updatedAt,
    });
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
