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
import { notifyAllAdmins } from "./adminNotifications.service.js";
import { computeAssignmentDeadlineFor } from "../utils/assignmentDeadline.js";
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
      /** The region the selected printer is in — differs from `customerRegion` on a fallback. */
      assignedRegion: string;
      isCrossRegion: boolean;
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
 * Region fallback order, used when the customer's own region has no available
 * partner. West is last in every chain so a domestic order only crosses the
 * continent as a genuine last resort.
 */
export const REGION_FALLBACKS: Record<string, string[]> = {
  West:      ["Midwest", "Northeast", "South"],
  Midwest:   ["Northeast", "South", "West"],
  Northeast: ["Midwest", "South", "West"],
  South:     ["Midwest", "Northeast", "West"],
};

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

  let pool = sameRegion;
  let assignedRegion = customerRegion;
  let isCrossRegion = false;

  if (pool.length === 0) {
    for (const fallbackRegion of REGION_FALLBACKS[customerRegion] || []) {
      const regionCandidates = eligible.filter((c) => c.printerRegion === fallbackRegion);
      if (regionCandidates.length > 0) {
        pool = regionCandidates;
        assignedRegion = fallbackRegion;
        isCrossRegion = true;
        break;
      }
    }
  }

  if (pool.length === 0) {
    const reason =
      eligible.length === 0
        ? "No available printers"
        : `No available printers in region (${customerRegion}) or any fallback region.`;
    return {
      assigned: false,
      customerRegion,
      reason,
      candidatesConsidered: candidates.length,
      candidatesSameRegion: 0,
    };
  }

  // Sort: nearest → lowest utilisation → highest rating → stable id
  const sorted = [...pool].sort((a, b) => {
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
    assignedRegion,
    isCrossRegion,
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
      "name companyName email regions rating defaultShippingAddress settings.jobCapacity availabilityStatus"
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
      const acceptingOrders = !p.availabilityStatus || p.availabilityStatus === "open";
      const available = acceptingOrders && autoAccept && hasConcurrentCapacity && hasDailyCapacity;

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

  const selection = selectPrinterFromCandidates(customerState, eligibleCandidates);
  const candidatesSameRegion = eligibleCandidates.filter(
    (c) => c.printerRegion === customerRegion,
  );

  if (!selection.assigned) {
    const tookMs = Date.now() - startedAt;
    console.log(
      `[AUTO_ASSIGN] UNASSIGNED orderId=${order._id} customerRegion=${customerRegion || "unknown"} ` +
      `totalAvailable=${eligibleCandidates.length} sameRegion=${candidatesSameRegion.length} ` +
      `reason="${selection.reason}" tookMs=${tookMs}`
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
      reason: selection.reason,
      tookMs
    } as any);
    await order.save();
    return { assigned: false, orderId: String(order._id), reason: selection.reason, tookMs };
  }

  const assignedRegion = selection.assignedRegion;
  const isCrossRegion = selection.isCrossRegion;

  if (isCrossRegion) {
    console.log(
      `[AUTO_ASSIGN] FALLBACK orderId=${order._id} customerRegion=${customerRegion || "unknown"} ` +
      `no same-region printers, assigned in region=${assignedRegion}`
    );
  }

  const selected = eligibleCandidates.find(
    (c) => c.printerId === selection.selected.printerId,
  )!;
  const selectedId = selected.printerId;

  order.assignedPrinter = new mongoose.Types.ObjectId(selectedId);
  // Start the 24h fulfilment clock from the exact assignment moment.
  const assignedAt = new Date();
  order.assignedAt = assignedAt;
  order.assignmentDeadline = computeAssignmentDeadlineFor(
      assignedAt,
      (order as any).priority,
      (await getAssignmentSettings()).sla.acceptHours,
    );
  if (String(order.status || "").toUpperCase() === "PENDING") {
    order.status = "PROCESSING";
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

  (order as any).crossRegionAssignment = isCrossRegion
    ? { customerRegion: customerRegion || "Unknown", assignedRegion, at: assignedAt }
    : null;

  const tookMs = Date.now() - startedAt;
  order.assignmentHistory = order.assignmentHistory || [];
  order.assignmentHistory.push({
    time: new Date(),
    mode: "AUTO",
    selectedPrinterId: selected.printerId,
    selectedPrinterName: selected.printerName,
    customerRegion,
    assignedRegion,
    isCrossRegion,
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

  // A cross-region assignment means longer, costlier shipping. It is a
  // deliberate fallback rather than an error, so this is informational — but it
  // should never happen silently, because a region that keeps triggering it is
  // a capacity problem worth acting on.
  if (isCrossRegion) {
    notifyAllAdmins({
      category: "orders",
      priority: "medium",
      title: "Order assigned outside its region",
      message:
        `Order #${displayId} is a ${customerRegion || "Unknown"} order but no partner there was available, ` +
        `so it went to ${selected.printerName} in ${assignedRegion}. Expect longer, costlier shipping.`,
      meta: {
        orderId: String(order._id),
        displayId,
        customerRegion,
        assignedRegion,
        printerId: selected.printerId,
        printerName: selected.printerName,
        type: "cross_region_assignment",
      },
    }).catch(() => {});
  }

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

export interface PredictedOrigin {
  postalCode: string;
  state: string;
  city: string;
  region: string;
  printerName: string;
  /** True when no printer serves the customer's own region and a fallback was used. */
  /**
   * True when the likely partner is outside the customer's own region.
   *
   * Deliberately internal — not surfaced at checkout. It was considered and
   * decided against: the shipping quote is already taken from this predicted
   * origin, so a cross-region order is priced and estimated accordingly, and a
   * notice would tell the customer about a capacity problem they cannot act on.
   * It stays as an operational signal (admins are alerted separately when a
   * cross-region assignment actually happens).
   *
   * It is also only a prediction: assignment runs after checkout, so a local
   * partner may free up, or the predicted one may hit capacity.
   */
  isFallbackRegion: boolean;
}

/**
 * Where an order will most likely ship *from*, worked out before any printer is
 * assigned.
 *
 * Shipping rates were quoted from a single fixed origin in the environment
 * (`SHIPSTATION_FROM_*`, an Austin postcode) while the label ships from the
 * assigned partner's own address. Quote and label therefore described different
 * journeys — and the error was systematic, not random: assignment matches
 * partners to the customer's region, so real shipments are short local hops
 * that were being priced as though they crossed the country.
 *
 * The exact partner cannot be known at quote time — assignment needs a saved
 * order, and the customer is charged before one exists. But it does not need to
 * be: partners are chosen by region, and a region's partners are by definition
 * clustered, so any partner in the serving region gives the right origin
 * geography. That is what this returns.
 *
 * Deliberately ignores capacity, business hours and load. Those decide *which*
 * partner, not *where from*, and consulting them here would couple the quote to
 * state that changes between quoting and assigning.
 */
export const predictShippingOrigin = async (
  customerState: string | null | undefined
): Promise<PredictedOrigin | null> => {
  const customerRegion = normalizeRegion(getRegionFromState(customerState));
  if (!customerRegion) return null;

  const printers = await User.find({ role: UserRoles.PRINTER, status: "Active" })
    .select("name companyName regions businessAddress defaultShippingAddress")
    .lean();

  // Same order assignment would try: the customer's own region first, then its
  // configured fallbacks.
  for (const region of [customerRegion, ...(REGION_FALLBACKS[customerRegion] || [])]) {
    for (const p of printers as any[]) {
      // businessAddress first — it is what `createShipStationLabel` uses as the
      // ship-from, so the quote and the label agree on the origin.
      const addr = p.businessAddress?.postalCode ? p.businessAddress : p.defaultShippingAddress;
      if (!addr?.postalCode) continue;

      const printerRegion =
        normalizeRegion(getRegionFromState(addr.state)) || normalizeRegion(p.regions?.[0]);
      if (printerRegion !== region) continue;

      return {
        postalCode: String(addr.postalCode),
        state: String(addr.state || ""),
        city: String(addr.city || ""),
        region,
        printerName: String(p.companyName || p.name || "Print Partner"),
        isFallbackRegion: region !== customerRegion,
      };
    }
  }

  return null;
};
