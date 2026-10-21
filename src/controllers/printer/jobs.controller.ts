import { Request, Response, NextFunction } from "express";
import { OrderIssue } from "../../models/orderIssue.model.js";
import { partnerIssueFlags } from "../../services/orderIssue.service.js";
import { partnerTransitionError } from "../../utils/partnerStatusRules.js";
import { orderSheets, sheetSummaries } from "../../utils/orderSheets.js";
import { stageDue } from "../../utils/slaStages.js";
import { orderSheetPrintFileIn } from "../../services/gangsheetExport.service.js";
import { formatSheetSize } from "../../utils/orderPresentation.js";
import { resolveApiFile } from "../../utils/publicApiBase.js";
import { printerStatusLabel, statusChangeMessage, statusesForPrinterLabel } from "../../utils/orderStatusLabels.js";
import { getPartnerPayRate } from "../../services/pricing.service.js";
import { Order } from "../../models/order.model.js";
import { Asset } from "../../models/asset.model.js";
import { Design } from "../../models/design.model.js";
import { User } from "../../models/user.model.js";
import { broadcastToAllAdmins } from "../../services/adminNotificationsHub.js";
import { publishOrderEvent } from "../../services/orderSyncHub.js";
import { notifyPrinter } from "../../services/printerNotifications.service.js";
import { notifyAllAdmins } from "../../services/adminNotifications.service.js";
import mongoose from "mongoose";
import { GangsheetExport } from "../../models/gangsheetExport.model.js";
import { GANGSHEET_PRINT_DPI } from "../../services/gangsheetExport.service.js";
import { getOrderPartnerCostBreakdown, canDerivePartnerEarning, isPartnerEarningRealized } from "../../services/partnerEarnings.service.js";
import { autoAssignOrder } from "../../services/orderAssignment.service.js";
import { syncPartnerCapacitySafe, getAssignmentSettings, ACTIVE_ORDER_STATUSES } from "../../services/partnerCapacity.service.js";
import { triggerShipStationWorkflow } from "../../services/shipstation.service.js";
import { CustomError, isObjectIdString, splitAssetRefs } from "./shared.js";
import { cancellationBlocksPartner, respondToCancellation } from "../../services/cancellationRequest.service.js";

const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

const pickMostPopulatedItem = (items: any[]) => {
  const list = Array.isArray(items) ? items : [];
  let best: any | null = null;
  let bestCopies = -1;
  let bestArea = -1;
  let bestIndex = Number.POSITIVE_INFINITY;

  for (let i = 0; i < list.length; i += 1) {
    const it = list[i];
    if (!it) continue;
    const copies = typeof it.copies === "number" && Number.isFinite(it.copies) ? Math.max(0, it.copies) : 0;
    const w = typeof it.widthIn === "number" && Number.isFinite(it.widthIn) ? Math.max(0, it.widthIn) : 0;
    const h = typeof it.heightIn === "number" && Number.isFinite(it.heightIn) ? Math.max(0, it.heightIn) : 0;
    const area = w * h;

    const isBetter =
      copies > bestCopies ||
      (copies === bestCopies && area > bestArea) ||
      (copies === bestCopies && area === bestArea && i < bestIndex);

    if (isBetter) {
      best = it;
      bestCopies = copies;
      bestArea = area;
      bestIndex = i;
    }
  }

  return best;
};

const resolveThumbnailUrl = (ref: string, assetsById: Map<string, string>) => {
  const s = String(ref || "").trim();
  if (!s) return null;
  if (!isObjectIdString(s)) return s;
  const fromMap = assetsById.get(s);
  return fromMap || null;
};

const computeGangsheetFaceThumbnail = ({
  items,
  assetsById,
}: {
  items: any[];
  assetsById: Map<string, string>;
}) => {
  const gangsheetItem = (Array.isArray(items) ? items : []).find((i: any) => i?.type === "gangsheet") || (items || [])[0] || {};
  const artboardItems = Array.isArray((gangsheetItem as any).artboardItems) ? (gangsheetItem as any).artboardItems : [];
  const best = pickMostPopulatedItem(artboardItems);
  if (!best) return null;

  const croppedUrl = typeof best.croppedUrl === "string" ? best.croppedUrl.trim() : "";
  if (croppedUrl) return croppedUrl;

  return resolveThumbnailUrl(String(best.assetId || ""), assetsById);
};

export const getJobDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const printerId = req.user?.id;

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const firstItem = job.items[0] || {};
    const sheetSize = (firstItem.widthIn && firstItem.heightIn) 
      ? `${firstItem.widthIn}x${firstItem.heightIn}` 
      : "N/A";

    res.json({
      id: job.id,
      orderId: (job as any)?.displayId ? String((job as any).displayId) : job.id,
      displayId: (job as any)?.displayId ? String((job as any).displayId) : null,
      status: job.status,
      specs: {
        sheetSize,
        filmType: firstItem.type === "gangsheet" ? "DTF" : "Unknown"
      },
      notes: job.notes || "No production notes",
      timeline: (job.statusTimeline || []).map(t => ({
        status: t.status,
        time: t.time
      }))
    });
  } catch (error) {
    next(error);
  }
};

export const updateJobNotes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;
    const { notes } = req.body;
    const printerId = req.user?.id;

    if (typeof notes !== "string") {
      const error = new Error("Notes must be a string") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    if (notes.length > 2000) {
      const error = new Error("Notes maximum length is 2000 characters") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: jobId, assignedPrinter: printerId });

    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    job.notes = notes;
    await job.save();

    res.json({
      id: job.id,
      notes: job.notes,
      updatedAt: job.updatedAt.toISOString()
    });
  } catch (error) {
    next(error);
  }
};

export const listPrinterOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const { status, q, limit = "30", cursor } = req.query;

    const query: any = { assignedPrinter: printerId };

    /*
     * The shared vocabulary, not a second copy. This map had PROCESSING under
     * "In Progress - Printing" while `PRINTER_STATUS_LABEL` puts it under
     * "Pending Review" — on purpose, because a partner has not started a
     * PROCESSING job. So one job read two different ways depending on which page
     * you were on, and this page told them it was on the press.
     */
    const requestedStatuses = statusesForPrinterLabel(status);
    if (requestedStatuses) {
      query.status = { $in: requestedStatuses };
    }

    if (typeof q === "string" && q.trim()) {
      const raw = q.trim();
      const re = new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { "customer.firstName": re },
        { "customer.lastName": re },
        { "customer.email": re },
        { "shippingAddress.city": re },
        { "shippingAddress.state": re },
        { displayId: re }
      ];
      if (mongoose.Types.ObjectId.isValid(raw)) {
        query.$or.push({ _id: new mongoose.Types.ObjectId(raw) });
      }
    }

    const pageSize = Math.max(1, Math.min(100, parseInt(String(limit), 10) || 30));
    if (typeof cursor === "string" && cursor.includes("_")) {
      const [createdAtMsRaw, idRaw] = cursor.split("_");
      const createdAtMs = Number(createdAtMsRaw);
      if (Number.isFinite(createdAtMs) && mongoose.Types.ObjectId.isValid(idRaw)) {
        query.$and = [
          ...(query.$and || []),
          {
            $or: [
              { createdAt: { $lt: new Date(createdAtMs) } },
              { createdAt: new Date(createdAtMs), _id: { $lt: new mongoose.Types.ObjectId(idRaw) } }
            ]
          }
        ];
      }
    }

    // Exclude artboardItems — they can be 10k+ elements per order and are never needed
    // in list view. Use previewImage for thumbnails instead.
    const orders = await Order.find(query)
      .select("-items.artboardItems")
      .sort({ createdAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const formatDueDate = (d: Date) => {
      const now = new Date();
      const startToday = new Date(now);
      startToday.setHours(0, 0, 0, 0);
      const startTomorrow = new Date(startToday);
      startTomorrow.setDate(startTomorrow.getDate() + 1);
      const startDayAfter = new Date(startToday);
      startDayAfter.setDate(startDayAfter.getDate() + 2);

      if (d >= startToday && d < startTomorrow) return "Due Today";
      if (d >= startTomorrow && d < startDayAfter) return "Due Tomorrow";
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    const statusDescription = (label: string) => {
      if (label === "Pending Review") return "Review artwork and accept this job";
      if (label === "In Progress - Printing") return "Currently printing";
      if (label === "Print Shipping Label") return "Ready to ship — print the label";
      // "Order Shipped" had no case and fell through to an empty string, so the
      // one status a partner most wants confirmed said nothing.
      if (label === "Order Shipped") return "On its way to the customer";
      if (label === "Completed") return "Delivered and complete";
      if (label === "Cancelled") return "This job has been cancelled";
      return "";
    };

    const hasNextPage = orders.length > pageSize;
    const pageOrders = hasNextPage ? orders.slice(0, pageSize) : orders;

    const sla = (await getAssignmentSettings()).sla;
    const issueFlags = partnerIssueFlags(
      await OrderIssue.find({ order: { $in: pageOrders.map((o) => o._id) }, partner: printerId, status: "OPEN" }).lean(),
      String(printerId),
    );

    const formattedOrders = pageOrders.map((order) => {
      const firstItem = (Array.isArray(order.items) ? order.items[0] : null) || ({} as any);
      const sheets = sheetSummaries(order.items);
      const sheetSize =
        sheets.length > 1
          ? `${sheets.length} sheets`
          : formatSheetSize(sheets[0]?.widthIn, sheets[0]?.heightIn) || "N/A";

      const location = order.shippingAddress
        ? `${order.shippingAddress.city}, ${order.shippingAddress.state}`
        : "N/A";

      const displayStatus = printerStatusLabel(order.status);

      const thumbnail = typeof firstItem.previewImage === "string" && firstItem.previewImage
        ? resolveApiFile(req, firstItem.previewImage)
        : null;

      const orderId = String((order as any)._id);
      /*
       * What is due next, and when — the same clock the SLA enforces. This was
       * the accept-by deadline shown as "Due Date" on every job: still there
       * after the job was accepted, and on shipped, completed and cancelled jobs.
       * Now: accept by (not started), print by (printing), nothing after that.
       */
      const due = stageDue(order as any, sla);
      return {
        id: orderId,
        actualId: orderId,
        displayId: (order as any)?.displayId ? String((order as any).displayId) : null,
        /** The order this job reprints for free, when it is one. */
        reprintOf: (order as any)?.reprintOf?.displayId ? String((order as any).reprintOf.displayId) : null,
        /** The customer has asked to cancel and is waiting for this partner's answer. */
        cancelRequested: (order as any)?.cancellationRequest?.status === "PENDING",
        customerName: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim() || "—",
        sheetSize,
        filmType: firstItem.type === "gangsheet" ? "DTF" : "Unknown",
        location,
        status: displayStatus,
        dueDate: due ? formatDueDate(due.dueAt) : "",
        deadline: due ? due.dueAt.toISOString() : null,
        dueStage: due ? due.stage : null,
        assignedAt: (order as any).assignedAt ? new Date((order as any).assignedAt).toISOString() : null,
        createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : null,
        isUrgent: order.priority === "URGENT",
        statusDescription: statusDescription(displayStatus),
        thumbnail,
        // A question from the admin about a problem the customer reported.
        issue: issueFlags.get(orderId) || null,
      };
    });

    const lastOrder = pageOrders[pageOrders.length - 1];
    const nextCursor =
      hasNextPage && lastOrder
        ? `${new Date(lastOrder.createdAt).getTime()}_${String(lastOrder._id)}`
        : null;

    res.json({ orders: formattedOrders, nextCursor });
  } catch (error) {
    next(error);
  }
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           

export const getPrinterJobOverview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slaSettings = (await getAssignmentSettings()).sla;
    const { jobId } = req.params as any;
    const printerId = req.user?.id;
    const id = Array.isArray(jobId) ? String(jobId[0] || "") : String(jobId || "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error("Invalid job id") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: id, assignedPrinter: printerId }).lean();
    if (!job) {
      const error = new Error("Job not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const items = Array.isArray((job as any).items) ? (job as any).items : [];
    const firstItem: any = (job as any).items?.[0] || {};
    // Each sheet with the size of the file its export produces.
    const storedSheets = orderSheets(items);
    const sheets = sheetSummaries(items, (v) => resolveApiFile(req, v)).map((summary, i) => ({
      ...summary,
      printFile: orderSheetPrintFileIn(storedSheets[i] || {}),
    }));
    const sheetSize =
      sheets.length > 1
        ? `${sheets.length} sheets`
        : formatSheetSize(sheets[0]?.widthIn, sheets[0]?.heightIn) || "N/A";

    const designIdsRaw =
      (job as any).items?.filter((i: any) => i.designId).map((i: any) => String(i.designId)) || [];
    const designIds = designIdsRaw
      .filter((id: string) => /^[0-9a-fA-F]{24}$/.test(id))
      .map((id: string) => new mongoose.Types.ObjectId(id));
    const designs = designIds.length ? await Design.find({ _id: { $in: designIds } }).lean() : [];
    const assetIds = new Set<string>();
    for (const d of designs as any[]) {
      d.artboardData?.items?.forEach((item: any) => {
        if (item.assetId) assetIds.add(String(item.assetId));
      });
    }
    for (const sheet of orderSheets(items)) {
      (Array.isArray(sheet.artboardItems) ? sheet.artboardItems : []).forEach((it: any) => {
        if (it?.assetId) assetIds.add(String(it.assetId));
      });
    }
    const { ids, urls } = splitAssetRefs(assetIds);
    const assets =
      ids.length || urls.length
        ? await Asset.find({
            $or: [
              ...(ids.length ? [{ _id: { $in: ids } }] : []),
              ...(urls.length ? [{ url: { $in: urls } }, { trimmedUrl: { $in: urls } }] : [])
            ]
          }).lean()
        : [];
    const hasWarning = assets.length < assetIds.size || assets.some((a: any) => !a.dpi || a.dpi < 150);
    const assetsById = new Map<string, string>();
    assets.forEach((a: any) => {
      const id = a?._id ? String(a._id) : "";
      const url = typeof a?.trimmedUrl === "string" ? a.trimmedUrl : typeof a?.url === "string" ? a.url : "";
      if (id && url) assetsById.set(id, url);
    });
    const faceThumbnail = computeGangsheetFaceThumbnail({ items, assetsById });

    const exports = await GangsheetExport.find({
      jobId: new mongoose.Types.ObjectId(String((job as any)._id)),
      printerId: new mongoose.Types.ObjectId(String(printerId))
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(5)
      .lean();

    const storedPricing = (job as any).pricing || {};
    const currency = String(storedPricing.currency || "USD");

    // Use the same cost formula the admin sees: printer's configured rate applied to sheet dimensions.
    // The partner sees the same rate everyone is paid; they do not set it.
    const partnerPricing = await getPartnerPayRate();
    // Same single definition — see `partnerEarnings.service`.
    const breakdown = getOrderPartnerCostBreakdown(job, partnerPricing);
    const earning = roundMoney(breakdown.subtotal);
    // Whether a cost can be derived at all: an order whose items carry no
    // printable dimensions has an unknown payout, not a zero one.
    const earningDerivable = canDerivePartnerEarning(job);

    res.json({
      id: String((job as any)._id),
      orderId: (job as any)?.displayId ? String((job as any).displayId) : String((job as any)._id),
      displayId: (job as any)?.displayId ? String((job as any).displayId) : null,
      reprintOf: (job as any)?.reprintOf?.displayId
        ? {
            displayId: String((job as any).reprintOf.displayId),
            /** False when Space Transfers chose not to pay for this reprint. */
            partnerPaid: (job as any).reprintOf.partnerPaid !== false,
            // Linked only when the original was this partner's, so the link opens.
            orderId: (await Order.exists({ _id: (job as any).reprintOf.orderId, assignedPrinter: (job as any).assignedPrinter }))
              ? String((job as any).reprintOf.orderId)
              : null,
          }
        : null,
      status: String((job as any).status),
      cancellationRequest: (job as any)?.cancellationRequest && (job as any).cancellationRequest.status !== "WITHDRAWN"
        ? {
            status: String((job as any).cancellationRequest.status),
            reason: (job as any).cancellationRequest.reason || null,
            requestedAt: (job as any).cancellationRequest.requestedAt || null,
            declineReason: (job as any).cancellationRequest.declineReason || null,
          }
        : null,
      /*
       * The label, decided here. The page carried its OWN fourth copy of the
       * status vocabulary which disagreed with the shared map twice — it called
       * a PROCESSING job "In Progress - Printing" (the shared map says Pending
       * Review, because the partner has not started it) and COMPLETED
       * "Delivered". So one order read differently on Home, on Jobs & Orders,
       * and on its own detail page.
       */
      statusLabel: printerStatusLabel((job as any).status),
      priority: String((job as any).priority || "NORMAL"),
      createdAt: (job as any).createdAt,
      updatedAt: (job as any).updatedAt,
      assignedAt: (job as any).assignedAt ? new Date((job as any).assignedAt).toISOString() : null,
      ...(() => {
        const due = stageDue(job as any, slaSettings);
        return { deadline: due ? due.dueAt.toISOString() : null, dueStage: due ? due.stage : null };
      })(),
      faceThumbnail,
      sheets,
      customer: {
        name: `${(job as any).customer?.firstName || ""} ${(job as any).customer?.lastName || ""}`.trim(),
        email: (job as any).customer?.email || null,
        phone: (job as any).customer?.phone || null,
        region: (job as any).customer?.region || null
      },
      shippingAddress: (job as any).shippingAddress || null,
      specs: {
        sheetSize,
        filmType: firstItem.type === "gangsheet" ? "DTF" : "Unknown",
        itemsCount: Array.isArray((job as any).items) ? (job as any).items.length : 0,
        // What is actually on the order: sheets, the graphics placed on them,
        // and how many prints in total (a sheet can be ordered more than once).
        sheetCount: sheets.length,
        graphicCount: sheets.reduce((n, sh) => n + sh.itemCount, 0),
        printCount: sheets.reduce((n, sh) => n + sh.quantity, 0),
        // The resolution print files are exported at — the page said 600.
        printDpi: GANGSHEET_PRINT_DPI,
      },
      notes: (job as any).notes || "",
      timeline: ((job as any).statusTimeline || []).map((t: any) => ({
        status: t.status,
        time: t.time,
        message: t.message || null,
        actorRole: t.actorRole || null,
        actorId: t.actorId || null,
        actorName: t.actorName ?? null
      })),
      payment: {
        method: (job as any).payment?.method || null,
      },
      /*
       * The real breakdown, not three hardcoded zeros. `rushFee` was reported as
       * 0 while the rush pay was folded into the total — so an urgent job paid
       * a surcharge the partner could see in the sum and not in the line, and
       * the admin's order page named a rush fee this page denied. `tax` and
       * `commission` were likewise flat zeros dressed as a calculation.
       */
      pricing: {
        base: roundMoney(breakdown.base),
        rushFee: roundMoney(breakdown.rushFee),
        specialInkFee: roundMoney(breakdown.specialInkFee),
        partnerCost: earning,
        total: earning,
        currency,
      },
      earnings: {
        net: earning,
        // Partners are paid once a job ships, so before that this is a forecast.
        realized: isPartnerEarningRealized(job),
        derivable: earningDerivable,
        currency,
      },
      warnings: { hasWarning },
      // Shipping & ShipStation fields — needed by the printer app to show tracking info
      // and to determine whether ShipStation is still processing.
      trackingNumber: (job as any).trackingNumber || null,
      carrier: (job as any).carrier || null,
      trackingUrl: (job as any).trackingUrl || null,
      shipStationTriggeredAt: (job as any).shipStationTriggeredAt
        ? new Date((job as any).shipStationTriggeredAt).toISOString()
        : null,
      shipStationLabelUrl: (job as any).shipStationLabelUrl || null,
      shipStationError: (job as any).shipStationError || null,
      recentExports: exports.map((e: any) => ({
        id: String(e._id),
        fileName: e.fileName,
        dpi: e.dpi,
        createdAt: e.createdAt,
        drive: e.drive?.status === "uploaded" ? { webViewLink: e.drive.webViewLink } : null
      }))
    });
  } catch (error) {
    next(error);
  }
};

export const getPrinterOrdersSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.user?.id;
    const match: any = { assignedPrinter: new mongoose.Types.ObjectId(printerId) };

    const [counts, urgentCount] = await Promise.all([
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 }
          }
        }
      ]),
      Order.countDocuments({
        assignedPrinter: printerId,
        priority: "URGENT",
        // The same "still live" set the capacity meter and Home use.
        status: { $in: ACTIVE_ORDER_STATUSES as any },
      })
    ]);

    const byStatus = new Map<string, number>(counts.map((c: any) => [String(c._id), Number(c.count || 0)]));

    /*
     * Grouped by the same labels the list and every other surface use, so a tab
     * count and the rows under it can never describe different sets. PROCESSING
     * counted as "In Progress" here while the shared vocabulary calls it Pending
     * Review — so the Pending tab under-counted and In Progress over-counted, by
     * exactly the jobs a partner had been given and not yet started.
     */
    const countFor = (label: string) =>
      (statusesForPrinterLabel(label) || []).reduce((sum, st) => sum + (byStatus.get(st) || 0), 0);

    const pendingReview = countFor("Pending Review");
    const inProgress = countFor("In Progress - Printing");
    const ready = countFor("Print Shipping Label");
    const shipped = (byStatus.get("SHIPPED") || 0);
    const completed = (byStatus.get("COMPLETED") || 0);
    const cancelled = (byStatus.get("CANCELLED") || 0);

    res.json({
      counts: {
        all: Array.from(byStatus.values()).reduce((a, b) => a + b, 0),
        pending: pendingReview,
        inProgress,
        ready,
        shipped,
        completed,
        cancelled,
        urgent: urgentCount
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updatePrinterOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params as any;
    const printerId = req.user?.id;
    const id = Array.isArray(orderId) ? String(orderId[0] || "") : String(orderId || "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error("Invalid order id") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const { status } = req.body || {};
    const input = String(status || "").trim();
    if (!input) {
      const error = new Error("status is required") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const allowedLabels: Record<string, string> = {
      // PROCESSING, not PENDING: the job is still assigned to this partner —
      // they are moving it back to "not started", not releasing it. PENDING now
      // means "no partner attached", so mapping here would have produced an
      // order that was pending and assigned at the same time.
      "Pending Review": "PROCESSING",
      "In Progress": "PRINTING",
      "In Progress - Printing": "PRINTING",
      "Print Shipping Label": "QUALITY_CHECK",
      "Ready": "QUALITY_CHECK",
      "Order Shipped": "SHIPPED",
      "Completed": "COMPLETED",
      "Cancelled": "CANCELLED"
    };

    const normalized = allowedLabels[input] || input.toUpperCase();
    const allowedBackend = ["PENDING", "PROCESSING", "PRINTING", "QUALITY_CHECK", "SHIPPED", "COMPLETED", "CANCELLED"];
    if (!allowedBackend.includes(normalized)) {
      const error = new Error("Invalid status") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const job = await Order.findOne({ _id: id, assignedPrinter: printerId });
    if (!job) {
      const error = new Error("Order not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const current = String((job as any).status || "").toUpperCase();
    const next = normalized;

    const refusal = (next !== current && cancellationBlocksPartner(job)) || partnerTransitionError(current, next, Boolean((job as any).shipStationLabelUrl));
    if (refusal) {
      const error = new Error(refusal) as CustomError;
      error.statusCode = 409;
      throw error;
    }

    if (!job.statusTimeline) job.statusTimeline = [];
    const now = new Date();
    const timelineHas = (s: string) =>
      (job.statusTimeline || []).some((t: any) => String(t?.status || "").toUpperCase() === s);
    const pushStatus = (s: string) => {
      (job.statusTimeline as any).push({
        status: s as any,
        time: now,
        message: statusChangeMessage("PRINTER", s),
        actorRole: "PRINTER",
        actorId: String(printerId || ""),
        actorName: null
      } as any);
    };

    if (next === "QUALITY_CHECK" && !timelineHas("PRINTING")) pushStatus("PRINTING");

    job.status = next as any;
    pushStatus(next);
    await job.save();

    // Reconcile capacity — a move to SHIPPED/COMPLETED/CANCELLED frees a slot.
    syncPartnerCapacitySafe(String(printerId));

    // When the printer marks a job "Ready for Packaging" (QUALITY_CHECK), fire the
    // ShipStation workflow async: create a shipping order, generate a label, retrieve
    // the tracking number, and auto-advance the job to SHIPPED.
    if (next === "QUALITY_CHECK") {
      triggerShipStationWorkflow(String(job._id)).catch((err: any) => {
        console.error(
          `[SS] Fire-and-forget workflow error for order ${job._id}: ${err?.message}`
        );
      });
    }

    /*
     * The shared map again. This copy called SHIPPED "Confirmed for Pickup" and
     * had no entry for PROCESSING at all — so the notification a partner
     * received named the new status differently from every screen they could
     * open to look at it.
     */
    const statusLabel = printerStatusLabel(next);
    notifyPrinter({
      printerId: String(printerId),
      category: "jobs",
      priority: next === "COMPLETED" || next === "SHIPPED" ? "medium" : "low",
      title: `Job moved to ${statusLabel}`,
      message: `Order ${(job as any).displayId || job.id} status updated to ${statusLabel}.`,
      meta: { orderId: job.id, status: next },
      settingsKey: "orderUpdates",
    }).catch(() => {});

    // When printer confirms shipment (QUALITY_CHECK → SHIPPED), notify customer + admins.
    if (next === "SHIPPED") {
      const trackingNumber = String((job as any).trackingNumber || "");
      const carrier = String((job as any).carrier || "");
      const displayId = String((job as any).displayId || job.id);
      publishOrderEvent(String(job._id), "order.status.changed", {
        orderId: String(job._id),
        status: "SHIPPED",
        from: current,
        to: "SHIPPED",
        trackingNumber,
        carrier,
        updatedAt: now,
        lastTimelineEntry: (job.statusTimeline as any)[(job.statusTimeline as any).length - 1],
      });
      notifyAllAdmins({
        category: "orders",
        priority: "medium",
        title: "Order confirmed for pickup",
        message: `Order #${displayId} label printed — printer confirmed package is ready. Carrier: ${carrier}, Tracking: ${trackingNumber}.`,
        meta: { orderId: String(job._id), displayId, trackingNumber, carrier },
      }).catch(() => {});
    }

    res.json({ updated: true, id: job.id, status: normalized, updatedAt: job.updatedAt.toISOString() });
  } catch (error) {
    next(error);
  }
};

export const cancelPrinterOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params as any;
    const printerId = req.user?.id;
    const id = Array.isArray(orderId) ? String(orderId[0] || "") : String(orderId || "");

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(String(printerId || ""))) {
      const error = new Error("Invalid order id") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const { reason } = req.body || {};
    const cancelReason = typeof reason === "string" ? reason.trim() : "";

    // Load the job — must belong to this printer
    const job = await Order.findOne({
      _id: new mongoose.Types.ObjectId(id),
      assignedPrinter: new mongoose.Types.ObjectId(String(printerId)),
    }).select("status displayId statusTimeline assignmentHistory customer cancellationRequest");

    if (!job) {
      const error = new Error("Order not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const current = String((job as any).status || "").toUpperCase();
    if (current === "CANCELLED") {
      const error = new Error("Order is already cancelled") as CustomError;
      error.statusCode = 409;
      throw error;
    }
    if (current === "COMPLETED") {
      const error = new Error("Cannot cancel a completed order") as CustomError;
      error.statusCode = 409;
      throw error;
    }
    // Handing it back would leave the customer's question with nobody to answer it.
    const pendingRequest = cancellationBlocksPartner(job);
    if (pendingRequest) {
      const error = new Error(pendingRequest) as CustomError;
      error.statusCode = 409;
      throw error;
    }

    // Look up printer name for logging
    const printerUser = await User.findById(printerId).select("name companyName").lean();
    const printerName = String((printerUser as any)?.companyName || (printerUser as any)?.name || printerId);

    const displayId = (job as any).displayId || String(job._id).slice(-6).toUpperCase();
    const now = new Date();

    const timelineEntry = {
      status: "PENDING",
      time: now,
      message: cancelReason
        ? `Returned to admin queue — cancelled by printer (${printerName}): ${cancelReason}`
        : `Returned to admin queue — cancelled by printer (${printerName})`,
      actorRole: "PRINTER",
      actorId: String(printerId),
      actorName: printerName,
    };

    const historyEntry = {
      time: now,
      mode: "AUTO",
      selectedPrinterId: null,
      selectedPrinterName: null,
      customerRegion: null,
      customerState: null,
      candidatesConsidered: 0,
      candidatesSameRegion: 0,
      reason: `Cancelled by printer ${printerName}${cancelReason ? `: ${cancelReason}` : ""}`,
      tookMs: 0,
    };

    const setFields: Record<string, any> = {
      status: "PENDING",
      returnedAt: now,
      cancelledByPrinterId: new mongoose.Types.ObjectId(String(printerId)),
      cancelledByPrinterName: printerName,
      updatedAt: now,   // updateOne() skips Mongoose timestamps middleware; set explicitly
    };
    if (cancelReason) setFields.rejectionReason = cancelReason;

    // Use a direct MongoDB updateOne so that:
    //   $unset  — atomically removes the assignedPrinter field (doc.save() with null is unreliable for ObjectId refs)
    //   $set    — writes status, returnedAt, cancelledByPrinterName in one round-trip
    //   $push   — appends audit entries without re-loading the full arrays
    await Order.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      {
        $set: setFields,
        $unset: { assignedPrinter: "" },
        $push: {
          statusTimeline: timelineEntry,
          assignmentHistory: historyEntry,
        },
      }
    );

    console.log(
      `[REASSIGN] Printer "${printerName}" released order ${id} (${displayId}) → PENDING, assignedPrinter cleared` +
        (cancelReason ? ` — reason: ${cancelReason}` : "")
    );

    // Releasing the job frees one of the cancelling printer's slots — auto-reopen
    // them if they were paused because they were at capacity.
    syncPartnerCapacitySafe(String(printerId));

    // Fire the customer-facing SSE event so their order page updates immediately
    publishOrderEvent(id, "order.status.changed", {
      orderId: id,
      status: "PENDING",
      from: current,
      to: "PENDING",
      updatedAt: now,
      lastTimelineEntry: timelineEntry,
    });

    // Notify all admins — persists in notification feed AND pushes via SSE
    notifyAllAdmins({
      category: "orders",
      priority: "high",
      title: "Job returned to admin queue",
      message: `Order #${displayId} was cancelled by ${printerName} and returned to the queue.${cancelReason ? ` Reason: ${cancelReason}` : ""}`,
      meta: {
        orderId: id,
        displayId,
        printerId: String(printerId),
        printerName,
        cancelledAt: now.toISOString(),
        cancelReason: cancelReason || null,
        type: "printer_cancelled",
      },
    }).catch(() => {});

    // Instant SSE push to every connected admin browser tab — triggers live orders-list refresh
    broadcastToAllAdmins("order.returned_to_queue", {
      orderId: id,
      displayId,
      printerId: String(printerId),
      printerName,
      cancelledAt: now.toISOString(),
      cancelReason: cancelReason || null,
    });

    // Notify the cancelling printer
    notifyPrinter({
      printerId: String(printerId),
      category: "jobs",
      priority: "medium",
      title: "Job returned to queue",
      message: `Order #${displayId} has been released and returned to the admin queue.`,
      meta: { orderId: id, status: "PENDING" },
      settingsKey: "orderUpdates",
    }).catch(() => {});

    // Attempt auto-reassignment — fire and forget; the order is already in the queue either way
    autoAssignOrder(id)
      .then((result) => {
        if (result.assigned) {
          console.log(`[REASSIGN] SUCCESS orderId=${id} → printer="${(result as any).printerName}"`);
        } else {
          console.log(`[REASSIGN] NO_MATCH orderId=${id} reason="${result.reason}" — stays in admin queue`);
        }
      })
      .catch((err: any) => {
        console.error(`[REASSIGN] ERROR orderId=${id}: ${err?.message}`);
      });

    res.json({ cancelled: true, id, status: "PENDING", reassigning: true });
  } catch (error) {
    next(error);
  }
};

export const getOrderSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const printerId = req.user?.id;

    const order = await Order.findOne({ _id: orderId, assignedPrinter: printerId });

    if (!order) {
      const error = new Error("Order not found or not assigned to this printer") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    // The shared map. This held its own copy with PROCESSING under
    // "In Progress - Printing" — the same disagreement the job list had.
    const displayStatus = printerStatusLabel(order.status);

    res.json({
      id: order.id,
      displayId: (order as any)?.displayId ? String((order as any).displayId) : null,
      status: displayStatus,
      items: order.items.length,
      amount: order.pricing?.total || 0,
      customer: `${order.customer.firstName} ${order.customer.lastName}`,
      createdAt: order.createdAt
    });
  } catch (error) {
    next(error);
  }
};

/** The partner's answer to a customer asking to cancel. */
export const answerCancellationRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await respondToCancellation(String(req.params.orderId || ""), String(req.user?.id || ""), req.body?.decision, req.body?.reason));
  } catch (error) {
    next(error);
  }
};
