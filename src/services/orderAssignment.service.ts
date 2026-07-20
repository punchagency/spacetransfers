import mongoose from "mongoose";
import { Order } from "../models/order.model.js";
import { User, UserRoles } from "../models/user.model.js";
import {
  getLatLngFromState,
  getRegionFromState,
  haversineMiles,
  normalizeRegion
} from "../utils/region.js";
import { notifyPrinter } from "./printerNotifications.service.js";
import { isPrinterAvailableAt } from "../utils/businessHours.js";
import { computeAssignmentDeadline } from "../utils/assignmentDeadline.js";
import {
  ACTIVE_ORDER_STATUSES,
  getAssignmentSettings,
  getEffectiveMaxConcurrent,
  isAtCapacity,
  syncPartnerCapacitySafe,
} from "./partnerCapacity.service.js";

// ── Pure, DB-free selection logic ─────────────────────────────────────────────
// Exported so it can be unit-tested without a MongoDB connection.

export interface PrinterCandidate {
  printerId: string;
  printerName: string;
  printerState: string | null;
  printerRegion: string | null;
  distanceMiles: number;
  rating: number;
  activeCount: number;
  maxConcurrent: number | null;
}

export type SelectionResult =
  | {
      assigned: true;
      selected: PrinterCandidate;
      customerRegion: string;
      candidatesConsidered: number;
      candidatesSameRegion: number;
    }
  | {
      assigned: false;
      customerRegion: string | null;
      reason: string;
      candidatesConsidered: number;
      candidatesSameRegion: number;
    };

/**
 * Core matching algorithm — pure function, no I/O.
 * Mirrors exactly what autoAssignOrder does after it builds the candidate list.
 * Returns the best printer for the order, or null with a reason.
 */
export const selectPrinterFromCandidates = (
  customerState: string | null | undefined,
  candidates: PrinterCandidate[],
  excludePrinterIds: string[] = []
): SelectionResult => {
  const eligible = excludePrinterIds.length
    ? candidates.filter((c) => !excludePrinterIds.includes(c.printerId))
    : candidates;
  const customerRegion: string | null = getRegionFromState(customerState);

  if (!customerRegion) {
    return {
      assigned: false,
      customerRegion: null,
      reason: `Customer state '${customerState || "not provided"}' is not a recognised US state — region unknown, assignment blocked.`,
      candidatesConsidered: candidates.length,
      candidatesSameRegion: 0,
    };
  }

  // Strict same-region filter — cross-region is always blocked.
  const sameRegion = eligible.filter((c) => c.printerRegion === customerRegion);

  if (sameRegion.length === 0) {
    const reason =
      eligible.length === 0
        ? "No available printers"
        : `No available printers in region (${customerRegion}). Cross-region assignment is disabled.`;
    return {
      assigned: false,
      customerRegion,
      reason,
      candidatesConsidered: candidates.length,
      candidatesSameRegion: 0,
    };
  }

  // Sort: nearest → lowest utilisation → highest rating → stable id
  const sorted = [...sameRegion].sort((a, b) => {
    const aDist = Number.isFinite(a.distanceMiles) ? a.distanceMiles : Infinity;
    const bDist = Number.isFinite(b.distanceMiles) ? b.distanceMiles : Infinity;
    if (aDist !== bDist) return aDist - bDist;
    const aUtil = a.maxConcurrent ? a.activeCount / a.maxConcurrent : a.activeCount;
    const bUtil = b.maxConcurrent ? b.activeCount / b.maxConcurrent : b.activeCount;
    if (aUtil !== bUtil) return aUtil - bUtil;
    if (a.rating !== b.rating) return b.rating - a.rating;
    return a.printerId.localeCompare(b.printerId);
  });

  return {
    assigned: true,
    selected: sorted[0],
    customerRegion,
    candidatesConsidered: candidates.length,
    candidatesSameRegion: sameRegion.length,
  };
};

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

  const order = await Order.findById(orderId).select(
    "assignedPrinter status priority shippingAddress statusTimeline assignmentHistory displayId returnedAt cancelledByPrinterId cancelledByPrinterName"
  );
  if (!order) {
    return { assigned: false, orderId, reason: "Order not found", tookMs: Date.now() - startedAt };
  }

  if (order.assignedPrinter) {
    return {
      assigned: false,
      orderId: String(order._id),
      reason: "Order already assigned",
      tookMs: Date.now() - startedAt
    };
  }

  // Respect the global assignment mode. Auto-assignment only runs in
  // "nearest-region" mode; under "manual" the order stays unassigned until an
  // admin assigns it by hand.
  const assignmentSettings = await getAssignmentSettings();
  if (assignmentSettings.rule === "manual") {
    const tookMs = Date.now() - startedAt;
    const reason = "Manual assignment mode — order left unassigned for admin to assign.";
    console.log(`[AUTO_ASSIGN] SKIPPED orderId=${order._id} reason="${reason}" tookMs=${tookMs}`);
    order.assignmentHistory = order.assignmentHistory || [];
    order.assignmentHistory.push({
      time: new Date(),
      mode: "AUTO",
      selectedPrinterId: null,
      selectedPrinterName: null,
      customerRegion: null,
      customerState: order.shippingAddress?.state || null,
      candidatesConsidered: 0,
      candidatesSameRegion: 0,
      reason,
      tookMs,
    } as any);
    await order.save();
    return { assigned: false, orderId: String(order._id), reason, tookMs };
  }

  const customerState = order.shippingAddress?.state;

  // Always compute the region live from the state code — never trust the stored
  // detectedRegion field, which may contain stale "West" defaults from old orders.
  // getRegionFromState returns null for any unrecognised / non-US state code.
  const customerRegion: string | null = getRegionFromState(customerState);

  // Use stored coordinates when available; fall back to state centroid.
  const storedCoords = (order.shippingAddress as any).coordinates;
  const customerCoord: { lat: number; lon: number } | null =
    storedCoords?.lat != null && storedCoords?.lng != null
      ? { lat: storedCoords.lat, lon: storedCoords.lng }
      : getLatLngFromState(customerState);

  console.log(
    `[AUTO_ASSIGN] START orderId=${order._id} customerState=${customerState || "unknown"} ` +
    `customerRegion=${customerRegion || "null"}`
  );

  // Hard block: if we cannot map the customer's state to a US region, do not assign.
  if (!customerRegion) {
    const tookMs = Date.now() - startedAt;
    const reason = `Customer state '${customerState || "not provided"}' is not a recognised US state — region unknown, assignment blocked.`;
    console.log(`[AUTO_ASSIGN] BLOCKED orderId=${order._id} reason="${reason}" tookMs=${tookMs}`);
    order.assignmentHistory = order.assignmentHistory || [];
    order.assignmentHistory.push({
      time: new Date(),
      mode: "AUTO",
      selectedPrinterId: null,
      selectedPrinterName: null,
      customerRegion: null,
      customerState: customerState || null,
      candidatesConsidered: 0,
      candidatesSameRegion: 0,
      reason,
      tookMs
    } as any);
    await order.save();
    return { assigned: false, orderId: String(order._id), reason, tookMs };
  }

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

  const activeCountByPrinter = new Map<string, number>(
    loadAgg.map((r: any) => [String(r._id), Number(r.activeCount || 0)])
  );
  const dailyCountByPrinter = new Map<string, number>(
    dailyAgg.map((r: any) => [String(r._id), Number(r.dailyCount || 0)])
  );

  const printers = await User.find({ role: UserRoles.PRINTER, status: "Active" })
    .select(
      "name companyName email regions rating defaultShippingAddress settings.jobCapacity settings.businessHours availabilityStatus"
    )
    .lean();

  const candidates = printers
    .map((p: any) => {
      const printerId = String(p._id);
      const printerState = p.defaultShippingAddress?.state;

      // Prefer the live address-state lookup (same pipeline as customer detection).
      // Fall back to the stored regions[0] only when the address gives no result —
      // covers printers created via the admin UI that have a regions[] but no shipping address.
      const printerRegion: string | null =
        normalizeRegion(getRegionFromState(printerState)) ||
        normalizeRegion(p.regions?.[0]) ||
        null;

      const printerCoord = getLatLngFromState(printerState);
      const distanceMiles =
        customerCoord && printerCoord
          ? haversineMiles(customerCoord, printerCoord)
          : Number.POSITIVE_INFINITY;

      // Effective concurrent cap = most restrictive of the global
      // "Maximum Jobs per Partner" limit and any per-partner override.
      const maxConcurrent = getEffectiveMaxConcurrent(p, assignmentSettings);
      const dailyMax = Number(p.settings?.jobCapacity?.dailyMax ?? 0) || null;
      const autoAccept: boolean = p.settings?.jobCapacity?.autoAccept !== false;
      const activeCount = activeCountByPrinter.get(printerId) ?? 0;
      const dailyCount = dailyCountByPrinter.get(printerId) ?? 0;

      const hasConcurrentCapacity = !isAtCapacity(activeCount, maxConcurrent);
      const hasDailyCapacity = !dailyMax || dailyCount < dailyMax;
      const withinBusinessHours = isPrinterAvailableAt(p, now);
      const acceptingOrders = !p.availabilityStatus || p.availabilityStatus === "open";
      const available = acceptingOrders && autoAccept && hasConcurrentCapacity && hasDailyCapacity && withinBusinessHours;

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

  // Never re-assign to the printer who just cancelled this job.
  const cancelledByPrinterId = (order as any).cancelledByPrinterId
    ? String((order as any).cancelledByPrinterId)
    : null;
  const eligibleCandidates = cancelledByPrinterId
    ? candidates.filter((c) => c.printerId !== cancelledByPrinterId)
    : candidates;

  if (cancelledByPrinterId) {
    const excluded = candidates.length - eligibleCandidates.length;
    if (excluded > 0) {
      console.log(`[AUTO_ASSIGN] EXCLUDED cancelling printer ${cancelledByPrinterId} from candidate pool`);
    }
  }

  console.log(
    `[AUTO_ASSIGN] CANDIDATES total=${printers.length} available=${eligibleCandidates.length} ` +
    `regions=[${[...new Set(eligibleCandidates.map((c) => c.printerRegion || "unknown"))].join(",")}]`
  );
  for (const c of eligibleCandidates) {
    console.log(
      `[AUTO_ASSIGN] CANDIDATE printer="${c.printerName}" state=${c.printerState || "?"} ` +
      `region=${c.printerRegion || "unknown"} matchesCustomer=${c.printerRegion === customerRegion}`
    );
  }

  // Preferred region is the customer's own region. When no printers are available
  // there, fall back through adjacent regions in priority order, excluding West
  // as a last resort so domestic assignments avoid cross-continental shipping.
  const REGION_FALLBACKS: Record<string, string[]> = {
    "West":      ["Midwest", "Northeast", "South"],
    "Midwest":   ["Northeast", "South",    "West"],
    "Northeast": ["Midwest",  "South",     "West"],
    "South":     ["Midwest",  "Northeast", "West"],
  };

  const candidatesSameRegion = customerRegion
    ? eligibleCandidates.filter((c) => c.printerRegion === customerRegion)
    : [];

  let pool = candidatesSameRegion;
  let assignedRegion: string = customerRegion || "";
  let isCrossRegion = false;

  if (pool.length === 0) {
    const fallbackChain = REGION_FALLBACKS[customerRegion || ""] || [];
    for (const fallbackRegion of fallbackChain) {
      const regionCandidates = eligibleCandidates.filter((c) => c.printerRegion === fallbackRegion);
      if (regionCandidates.length > 0) {
        pool = regionCandidates;
        assignedRegion = fallbackRegion;
        isCrossRegion = true;
        console.log(
          `[AUTO_ASSIGN] FALLBACK orderId=${order._id} customerRegion=${customerRegion || "unknown"} ` +
          `no same-region printers, using fallback region=${fallbackRegion} count=${regionCandidates.length}`
        );
        break;
      }
    }
  }

  if (pool.length > 0) {
    console.log(
      `[AUTO_ASSIGN] POOL region=${assignedRegion}${isCrossRegion ? " (cross-region fallback)" : ""} count=${pool.length} ` +
      `printers=[${pool.map((c) => `${c.printerName}(${c.printerState})`).join(",")}]`
    );
  }

  if (pool.length === 0) {
    const tookMs = Date.now() - startedAt;
    const noRegionReason =
      eligibleCandidates.length === 0
        ? "No available printers"
        : `No available printers in region (${customerRegion || "unknown"}) or any fallback region.`;

    console.log(
      `[AUTO_ASSIGN] UNASSIGNED orderId=${order._id} customerRegion=${customerRegion || "unknown"} ` +
      `totalAvailable=${eligibleCandidates.length} sameRegion=0 reason="${noRegionReason}" tookMs=${tookMs}`
    );

    order.assignmentHistory = order.assignmentHistory || [];
    order.assignmentHistory.push({
      time: new Date(),
      mode: "AUTO",
      selectedPrinterId: null,
      selectedPrinterName: null,
      customerRegion,
      customerState: customerState || null,
      candidatesConsidered: candidates.length,
      candidatesSameRegion: 0,
      reason: noRegionReason,
      tookMs
    } as any);
    await order.save();
    return { assigned: false, orderId: String(order._id), reason: noRegionReason, tookMs };
  }

  // Sort within the pool: distance → utilization → rating → id (deterministic)
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
  // Start the 24h fulfilment clock from the exact assignment moment.
  const assignedAt = new Date();
  order.assignedAt = assignedAt;
  order.assignmentDeadline = computeAssignmentDeadline(assignedAt);
  if (["PENDING", "PROCESSING"].includes(String(order.status || "").toUpperCase())) {
    order.status = "PENDING";
  }
  order.statusTimeline = order.statusTimeline || [];

  const reason = isCrossRegion
    ? `Auto-assigned (cross-region fallback: ${customerRegion || "?"} → ${assignedRegion})`
    : `Auto-assigned (same region: ${customerRegion || "Unknown"})`;

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
    customerRegion,
    customerState: customerState || null,
    candidatesConsidered: candidates.length,
    candidatesSameRegion: candidatesSameRegion.length,
    reason,
    tookMs
  } as any);

  await order.save();

  // Atomically clear the returned-to-queue markers now that a printer has taken over.
  // Done after save so the main document fields don't need to be in the select.
  await Order.updateOne(
    { _id: order._id },
    { $unset: { returnedAt: "", cancelledByPrinterId: "", cancelledByPrinterName: "" } }
  );

  const distStr = Number.isFinite(selected.distanceMiles)
    ? `${selected.distanceMiles.toFixed(1)}mi`
    : "n/a";

  console.log(
    `[AUTO_ASSIGN] ASSIGNED orderId=${order._id} ` +
    `customerRegion=${customerRegion || "unknown"} printerRegion=${selected.printerRegion || "unknown"} ` +
    `printer="${selected.printerName}"(${selected.printerState}) dist=${distStr} tookMs=${tookMs}`
  );

  const isUrgent = String((order as any).priority || "").toUpperCase() === "URGENT";
  const displayId = (order as any).displayId
    ? String((order as any).displayId)
    : String(order._id).slice(-6).toUpperCase();

  notifyPrinter({
    printerId: selected.printerId,
    category: "jobs",
    priority: isUrgent ? "high" : "medium",
    title: isUrgent ? "Urgent job assigned" : "New job assigned",
    message: `Order #${displayId} has been auto-assigned to you. ${reason}.`,
    meta: { orderId: String(order._id), autoAssigned: true },
    settingsKey: "newJobs"
  }).catch((err) => {
    console.error(
      `[AUTO_ASSIGN] Notification failed for printer ${selected.printerId}: ${err?.message}`
    );
  });

  // This assignment may have pushed the printer to their maximum active load —
  // reconcile their availability (auto-pause + notify) if so.
  syncPartnerCapacitySafe(selected.printerId);

  return {
    assigned: true,
    orderId: String(order._id),
    printerId: selected.printerId,
    printerName: selected.printerName,
    reason,
    tookMs
  };
};
