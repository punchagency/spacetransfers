import mongoose from "mongoose";
import { Order } from "../models/order.model.js";
import { User, UserRoles } from "../models/user.model.js";
import { getLatLngFromState, getRegionFromState, haversineMiles, normalizeRegion } from "../utils/region.js";
import { notifyPrinter } from "./printerNotifications.service.js";
import { isPrinterAvailableAt } from "../utils/businessHours.js";

const ACTIVE_ORDER_STATUSES = ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK"] as const;

type AssignmentResult =
  | {
      assigned: true;
      orderId: string;
      printerId: string;
      printerName: string;
      reason: string;
      tookMs: number;
    }
  | {
      assigned: false;
      orderId: string;
      reason: string;
      tookMs: number;
    };

export const autoAssignOrder = async (orderId: string): Promise<AssignmentResult> => {
  const startedAt = Date.now();

  const order = await Order.findById(orderId).select("assignedPrinter status priority shippingAddress statusTimeline assignmentHistory displayId");
  if (!order) {
    return { assigned: false, orderId, reason: "Order not found", tookMs: Date.now() - startedAt };
  }

  if (order.assignedPrinter) {
    return { assigned: false, orderId: String(order._id), reason: "Order already assigned", tookMs: Date.now() - startedAt };
  }

  const customerState = order.shippingAddress?.state;
  const customerRegion = normalizeRegion(getRegionFromState(customerState));

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const loadAgg = await Order.aggregate([
    { $match: { assignedPrinter: { $ne: null }, status: { $in: ACTIVE_ORDER_STATUSES as any } } },
    { $group: { _id: "$assignedPrinter", activeCount: { $sum: 1 } } }
  ]);

  const dailyAgg = await Order.aggregate([
    { $match: { assignedPrinter: { $ne: null }, createdAt: { $gte: startOfDay } } },
    { $group: { _id: "$assignedPrinter", dailyCount: { $sum: 1 } } }
  ]);

  const activeCountByPrinter = new Map<string, number>(loadAgg.map((r: any) => [String(r._id), Number(r.activeCount || 0)]));
  const dailyCountByPrinter = new Map<string, number>(dailyAgg.map((r: any) => [String(r._id), Number(r.dailyCount || 0)]));

  const printers = await User.find({ role: UserRoles.PRINTER, status: "Active" })
    .select("name companyName email regions rating defaultShippingAddress settings.jobCapacity settings.businessHours")
    .lean();

  const customerCoord = getLatLngFromState(customerState);

  const candidates = printers
    .map((p: any) => {
      const printerId = String(p._id);
      const printerRegions = Array.isArray(p.regions) ? p.regions : [];
      const normalizedRegions = printerRegions.map((r: any) => normalizeRegion(r)).filter(Boolean);
      const printerState = p.defaultShippingAddress?.state;
      const printerRegion = normalizedRegions[0] || (printerState ? normalizeRegion(getRegionFromState(printerState)) : null);
      const printerCoord = getLatLngFromState(printerState);

      const distanceMiles =
        customerCoord && printerCoord ? haversineMiles(customerCoord, printerCoord) : Number.POSITIVE_INFINITY;

      const maxConcurrent = Number(p.settings?.jobCapacity?.maxConcurrent ?? 0) || null;
      const dailyMax = Number(p.settings?.jobCapacity?.dailyMax ?? 0) || null;
      const autoAccept: boolean = p.settings?.jobCapacity?.autoAccept !== false; // default true
      const activeCount = activeCountByPrinter.get(printerId) ?? 0;
      const dailyCount = dailyCountByPrinter.get(printerId) ?? 0;

      const hasConcurrentCapacity = !maxConcurrent || activeCount < maxConcurrent;
      const hasDailyCapacity = !dailyMax || dailyCount < dailyMax;
      // Auto-assign only runs for printers who have auto-accept ON and are within business hours
      const withinBusinessHours = isPrinterAvailableAt(p, now);
      const available = autoAccept && hasConcurrentCapacity && hasDailyCapacity && withinBusinessHours;

      return {
        printerId,
        printerName: String(p.companyName || p.name || "Printer"),
        printerEmail: String(p.email || ""),
        printerRegion,
        printerState: printerState ? String(printerState) : null,
        distanceMiles,
        rating: Number(p.rating ?? 5),
        activeCount,
        dailyCount,
        maxConcurrent,
        dailyMax,
        available
      };
    })
    .filter((c) => c.available);

  const candidatesSameRegion = customerRegion ? candidates.filter((c) => c.printerRegion === customerRegion) : [];
  const pool = candidatesSameRegion.length > 0 ? candidatesSameRegion : candidates;

  if (pool.length === 0) {
    const tookMs = Date.now() - startedAt;
    order.assignmentHistory = order.assignmentHistory || [];
    order.assignmentHistory.push({
      time: new Date(),
      mode: "AUTO",
      selectedPrinterId: null,
      selectedPrinterName: null,
      customerRegion: customerRegion,
      customerState: customerState || null,
      candidatesConsidered: candidates.length,
      candidatesSameRegion: candidatesSameRegion.length,
      reason: "No available printers",
      tookMs
    } as any);
    await order.save();
    return { assigned: false, orderId: String(order._id), reason: "No available printers", tookMs };
  }

  pool.sort((a, b) => {
    const aDist = Number.isFinite(a.distanceMiles) ? a.distanceMiles : Number.POSITIVE_INFINITY;
    const bDist = Number.isFinite(b.distanceMiles) ? b.distanceMiles : Number.POSITIVE_INFINITY;
    if (aDist !== bDist) return aDist - bDist;

    const aUtil = a.maxConcurrent ? a.activeCount / a.maxConcurrent : a.activeCount;
    const bUtil = b.maxConcurrent ? b.activeCount / b.maxConcurrent : b.activeCount;
    if (aUtil !== bUtil) return aUtil - bUtil;

    if (a.rating !== b.rating) return b.rating - a.rating;
    return a.printerId.localeCompare(b.printerId);
  });

  const selected = pool[0];
  const selectedId = selected.printerId;

  order.assignedPrinter = new mongoose.Types.ObjectId(selectedId);
  if (["PENDING", "PROCESSING"].includes(String(order.status || "").toUpperCase())) {
    order.status = "PENDING";
  }
  order.statusTimeline = order.statusTimeline || [];

  const reason =
    candidatesSameRegion.length > 0
      ? `Auto-assigned (same region: ${customerRegion || "Unknown"})`
      : `Auto-assigned (fallback: nearest available printer)`;

  order.statusTimeline.push({
    status: String(order.status || "PENDING"),
    time: new Date(),
    message: `${reason} → ${selected.printerName}`,
    actorRole: "SYSTEM",
    actorId: "AUTO_ASSIGN",
    actorName: selected.printerName
  } as any);

  const tookMs = Date.now() - startedAt;
  order.assignmentHistory = order.assignmentHistory || [];
  order.assignmentHistory.push({
    time: new Date(),
    mode: "AUTO",
    selectedPrinterId: selected.printerId,
    selectedPrinterName: selected.printerName,
    customerRegion: customerRegion,
    customerState: customerState || null,
    candidatesConsidered: candidates.length,
    candidatesSameRegion: candidatesSameRegion.length,
    reason,
    tookMs
  } as any);

  await order.save();

  console.log(
    `[AUTO_ASSIGN] order=${order._id} customerRegion=${customerRegion || "unknown"} selectedPrinter=${selected.printerName} printerId=${selected.printerId} distanceMiles=${Number.isFinite(selected.distanceMiles) ? selected.distanceMiles.toFixed(1) : "n/a"} tookMs=${tookMs}`
  );

  const isUrgent = String((order as any).priority || "").toUpperCase() === "URGENT";
  const displayId = (order as any).displayId ? String((order as any).displayId) : String(order._id).slice(-6).toUpperCase();

  notifyPrinter({
    printerId: selected.printerId,
    category: "jobs",
    priority: isUrgent ? "high" : "medium",
    title: isUrgent ? "Urgent job assigned" : "New job assigned",
    message: `Order #${displayId} has been auto-assigned to you. ${reason}.`,
    meta: { orderId: String(order._id), autoAssigned: true },
    settingsKey: "newJobs",
  }).catch((err) => {
    console.error(`[AUTO_ASSIGN] Notification failed for printer ${selected.printerId}:`, err?.message);
  });

  return {
    assigned: true,
    orderId: String(order._id),
    printerId: selected.printerId,
    printerName: selected.printerName,
    reason,
    tookMs
  };
};
