import { Request, Response, NextFunction } from "express";
import { publishOrderEvent } from "../../services/orderSyncHub.js";
import { canPayPartnerOnCancel, cancelOrderWithRefund } from "../../services/orderCancellation.service.js";
import { sendOrderCancelledEmail, sendOrderRefundedEmail } from "../../services/orderEmails.service.js";
import { refundOrderPayment, refundableAmount } from "../../services/orderRefund.service.js";
import { describeTimelineMessage } from "../../utils/orderStatusLabels.js";
import { computeOrderFinancials, isOrderProfitSettled } from "../../services/orderFinancials.service.js";
import { recordMissingProcessingFee } from "../../services/paymentVerification.service.js";
import { formatSheetSize, orderChargeLines, orderInvoiceNote } from "../../utils/orderPresentation.js";
import { orderSheets, pickOrderSheet, sheetContents, sheetSummaries } from "../../utils/orderSheets.js";
import { Asset } from "../../models/asset.model.js";
import { apiFileUrl, resolveApiFile } from "../../utils/publicApiBase.js";
import { resolveOrderPriorityInput, resolveOrderStatusInput } from "../../utils/orderStatusInput.js";
import { getRegionFromState, normalizeRegion, resolveOrderRegion, resolveRegionInfo } from "../../utils/region.js";
import mongoose from "mongoose";
import { renderInvoicePdf } from "../../services/invoicePdf.service.js";
import { Order } from "../../models/order.model.js";
import { User, UserRoles, IUser } from "../../models/user.model.js";
import { Design } from "../../models/design.model.js";
import { notifyAllAdmins } from "../../services/adminNotifications.service.js";
import { notifyPrinter } from "../../services/printerNotifications.service.js";
import { canDerivePartnerEarning } from "../../services/partnerEarnings.service.js";
import { getPartnerPayRate } from "../../services/pricing.service.js";
import {
  syncPartnerCapacitySafe,
  getAssignmentSettings,
  getEffectiveMaxConcurrent,
  countActiveJobs,
  isAtCapacity,
} from "../../services/partnerCapacity.service.js";
import { exportGangsheetPng24, orderSheetWidthIn } from "../../services/gangsheetExport.service.js";
import { computePartnerCostBreakdown } from "../../utils/partnerPricingCost.js";
import { computeAssignmentDeadlineFor } from "../../utils/assignmentDeadline.js";
import { CustomError } from "./shared.js";

export const listOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      status,
      partnerId,
      priority,
      search,
      cursor,
      limit = "20"
    } = req.query;

    const query: any = {};
    // Extra compound filters that can't be merged directly into query
    const extraFilters: any[] = [];

    if (status) {
      // Shared with updateOrderStatus, so the value that filters a list and the
      // value that writes a status can never disagree again.
      query.status = resolveOrderStatusInput(status) ?? String(status).toUpperCase();
    }

    if (priority) {
      const resolved = resolveOrderPriorityInput(priority);
      if (resolved === "URGENT") query.priority = "URGENT";
      // NORMAL must also match orders placed before priority existed, which
      // carry no field at all — matching only "NORMAL" would hide them.
      else if (resolved === "NORMAL") query.priority = { $ne: "URGENT" };
    }

    if (partnerId) {
      query.assignedPrinter = partnerId;
    }

    if (search) {
      const searchRegex = new RegExp((search as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const searchOr: any[] = [
        { "customer.firstName": searchRegex },
        { "customer.lastName": searchRegex },
        { "customer.email": searchRegex },
        // The human-readable id (DTF-0242) is what the UI shows everywhere, so
        // it is the first thing anyone types into the box. Searching only the
        // raw ObjectId meant pasting a visible order number returned nothing.
        { displayId: searchRegex }
      ];
      if (mongoose.Types.ObjectId.isValid(search as string)) {
        searchOr.push({ _id: search as string });
      }
      extraFilters.push({ $or: searchOr });
    }

    /*
     * Unassigned orders come first, then everything else, each block ordered
     * most-recently-touched first.
     *
     * An unassigned order is the only kind that needs an admin to act, so it is
     * what the table should open on. Sorting the fetched page in the browser
     * would not achieve it: with keyset pagination an unassigned order sitting
     * on page three stays on page three, which is exactly where nobody looks.
     *
     * MongoDB cannot sort a `find()` on a computed flag, and sorting on
     * `assignedPrinter` itself would group the assigned block by partner
     * ObjectId instead of by recency. So the two blocks are paged explicitly —
     * same filters, same populate — and the cursor records which block it left
     * off in.
     *
     * Cursor: "${block}_${updatedAt.getTime()}_${_id}", block being "u"
     * (unassigned) or "a" (assigned). updatedAt is bumped on every write, so it
     * remains the reliable within-block sort key.
     */
    const UNASSIGNED: any = { assignedPrinter: null };
    const ASSIGNED: any = { assignedPrinter: { $ne: null } };

    let cursorBlock: "u" | "a" = "u";
    let cursorFilter: any = null;

    if (cursor && typeof cursor === "string" && cursor.includes("_")) {
      const parts = cursor.split("_");
      const [blockRaw, tsRaw, idRaw] =
        parts.length >= 3 ? parts : ["a", parts[0], parts[1]];
      const cursorTs = Number(tsRaw);
      if (
        (blockRaw === "u" || blockRaw === "a") &&
        Number.isFinite(cursorTs) &&
        mongoose.Types.ObjectId.isValid(idRaw)
      ) {
        cursorBlock = blockRaw;
        const cursorDate = new Date(cursorTs);
        const cursorObjId = new mongoose.Types.ObjectId(idRaw);
        cursorFilter = {
          $or: [
            { updatedAt: { $lt: cursorDate } },
            { updatedAt: cursorDate, _id: { $lt: cursorObjId } },
          ],
        };
      }
    }

    const pageSize = parseInt(limit as string);

    const buildQuery = (block: any, withCursor: boolean) => {
      const filters = [...extraFilters, block];
      if (withCursor && cursorFilter) filters.push(cursorFilter);
      return { ...query, $and: filters };
    };

    const fetchBlock = (block: any, withCursor: boolean, take: number) =>
      Order.find(buildQuery(block, withCursor))
        .select("-items.artboardItems")
        .sort({ updatedAt: -1, _id: -1 })
        .limit(take)
        .populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName regions settings.pricing defaultShippingAddress businessAddress")
        .lean();

    // One extra row tells us whether another page exists, without a count().
    let orders: any[] = [];

    if (cursorBlock === "u") {
      orders = await fetchBlock(UNASSIGNED, true, pageSize + 1);
      if (orders.length <= pageSize) {
        // The unassigned block is exhausted, so top the page up from the start
        // of the assigned block.
        const remaining = pageSize + 1 - orders.length;
        const assigned = await fetchBlock(ASSIGNED, false, remaining);
        if (assigned.length > 0) orders = [...orders, ...assigned];
      }
    } else {
      orders = await fetchBlock(ASSIGNED, true, pageSize + 1);
    }

    const hasNextPage = orders.length > pageSize;
    const results = hasNextPage ? orders.slice(0, pageSize) : orders;

    // The block the final returned row belongs to is what the next cursor must
    // continue from — not necessarily the block the request started in.
    const lastRow: any = results[results.length - 1];
    const lastRowBlock: "u" | "a" = lastRow && lastRow.assignedPrinter ? "a" : "u";

    const userIds = Array.from(
      new Set(
        results
          .map((o: any) => (o.user ? String(o.user) : null))
          .filter(Boolean)
      )
    ) as string[];
    const users = userIds.length > 0
      ? await User.find({ _id: { $in: userIds } }).select("regions").lean()
      : [];
    const userRegionMap = new Map<string, string | null>(
      users.map((u: any) => [String(u._id), Array.isArray(u.regions) ? (u.regions[0] || null) : null])
    );

    const partnerPayRate = await getPartnerPayRate();

    const formattedOrders = results.map(order => {
      // Every sheet, not the first one's size for the whole order.
      const sheetList = sheetSummaries(order.items);
      const sheetSize = sheetList.length > 1
        ? `${sheetList.length} sheets`
        : formatSheetSize(sheetList[0]?.widthIn, sheetList[0]?.heightIn) || "N/A";

      // Same source as the dashboard and as real payouts — see
      // calculateOrderFinancials above for why the flat rate was wrong.
      const regionInfo = resolveRegionInfo(order, userRegionMap);
      const profits = computeOrderFinancials(order, partnerPayRate).profit;
  
      return {
        id: order._id,
        customer: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
        total: order.pricing?.total || 0,
        profits: profits === null ? null : Number(profits.toFixed(2)),
        profitsRealized: isOrderProfitSettled(order),
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: (order as any).updatedAt ? new Date((order as any).updatedAt).toISOString() : null,
        returnedAt: (order as any).returnedAt ? new Date((order as any).returnedAt).toISOString() : null,
        cancelledByPrinterName: (order as any).cancelledByPrinterName || null,
        isReturnedToQueue: !!(order as any).returnedAt,
        assignedPartnerId: (order.assignedPrinter as any)?._id
          ? String((order.assignedPrinter as any)._id)
          : (order.assignedPrinter ? String(order.assignedPrinter) : null),
        assignedPartner: (order.assignedPrinter as any)?.companyName || null,
        sheetSize,
        isUrgent: order.priority === "URGENT",
        displayId: (order as any).displayId || null,
        region: regionInfo.customerRegion,
        // Surfaced so the orders table can badge a fallback assignment rather
        // than the fact being buried in a timeline message.
        crossRegion: regionInfo.crossRegion
          ? {
              customerRegion: regionInfo.customerRegion,
              assignedRegion: regionInfo.printerRegion,
            }
          : null
      };
    });

    let nextCursor = null;
    if (hasNextPage) {
      const lastOrder = results[results.length - 1];
      const lastUpdatedAt = (lastOrder as any).updatedAt ?? lastOrder.createdAt;
      nextCursor = `${lastRowBlock}_${new Date(lastUpdatedAt).getTime()}_${lastOrder._id}`;
    }

    res.status(200).json({
      orders: formattedOrders,
      nextCursor
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

    const { partnerId, force = false } = req.body;

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

    // Region check — warn on cross-region unless admin explicitly passes force:true.
    const customerRegion = normalizeRegion(getRegionFromState(order.shippingAddress?.state || "")) || null;
    const printerRegion = normalizeRegion(getRegionFromState((partner.defaultShippingAddress as any)?.state || ""))
      || normalizeRegion(getRegionFromState((partner as any).businessAddress?.state || ""))
      || partner.regions?.[0]
      || null;
    const isCrossRegion = customerRegion && printerRegion && customerRegion !== printerRegion;
    if (isCrossRegion && !force) {
      return res.status(409).json({
        code: "CROSS_REGION_ASSIGNMENT",
        message: `Customer is in ${customerRegion} but printer is in ${printerRegion}. Pass force:true to override.`,
        customerRegion,
        printerRegion,
      });
    }
    if (isCrossRegion) {
      console.warn(
        `[MANUAL_ASSIGN] CROSS-REGION override: order=${order._id} customerRegion=${customerRegion} printerRegion=${printerRegion} admin=${req.user?.email}`
      );
    }

    const previousPartnerId = order.assignedPrinter;
    const isReassignment = previousPartnerId && previousPartnerId.toString() !== partnerId;

    // Capacity guard — a printer at its maximum active job limit cannot receive
    // additional work, whether the assignment is automatic or manual. Enforced
    // here on the backend so it can't be bypassed via direct API calls. Skipped
    // only for a no-op re-assign to the printer who already holds this order
    // (that adds no new load).
    const alreadyHoldsThisOrder = previousPartnerId && String(previousPartnerId) === String(partnerId);
    if (!alreadyHoldsThisOrder) {
      const assignmentSettings = await getAssignmentSettings();
      const effectiveMax = getEffectiveMaxConcurrent(partner as any, assignmentSettings);
      if (effectiveMax != null) {
        const activeCount = await countActiveJobs(String(partnerId));
        if (isAtCapacity(activeCount, effectiveMax)) {
          // Make sure the partner's availability reflects the capacity state.
          syncPartnerCapacitySafe(String(partnerId));
          return res.status(409).json({
            code: "AT_MAX_CAPACITY",
            message:
              "This printer has reached its maximum active job limit and cannot accept additional jobs until one or more active jobs are completed or reassigned.",
            partnerId: String(partnerId),
            activeJobs: activeCount,
            maxJobs: effectiveMax,
          });
        }
      }
    }

    order.assignedPrinter = partnerId;
    // (Re)start the 24h fulfilment clock from this assignment moment. A no-op
    // re-assign to the printer who already holds the order keeps its existing
    // deadline (nothing changed); a first assignment or a hand-off to a different
    // printer resets it — the new printer gets a fresh 24 hours.
    if (!alreadyHoldsThisOrder || !order.assignmentDeadline) {
      const assignedAt = new Date();
      order.assignedAt = assignedAt;
      order.assignmentDeadline = computeAssignmentDeadlineFor(
      assignedAt,
      (order as any).priority,
      (await getAssignmentSettings()).sla.acceptHours,
    );
    }
    // Same rule as auto-assignment: attaching a partner moves PENDING to
    // PROCESSING, and never drags a further-along order backwards.
    if (String(order.status || "").toUpperCase() === "PENDING") {
      order.status = "PROCESSING";
    }

    const message = isReassignment 
      ? `Order reassigned from previous partner to ${partner.companyName || partner.name}`
      : `Order assigned to ${partner.companyName || partner.name}`;

    if (!order.statusTimeline) order.statusTimeline = [];
    order.statusTimeline.push({
      status: String(order.status || "PENDING"),
      time: new Date(),
      message,
      actorRole: "ADMIN",
      actorId: String(req.user?.id || ""),
      actorName: String(req.user?.name || req.user?.email || "") || null
    });

    if (!order.assignmentHistory) order.assignmentHistory = [];
    order.assignmentHistory.push({
      time: new Date(),
      mode: "MANUAL",
      selectedPrinterId: String(partnerId),
      selectedPrinterName: partner.companyName || partner.name,
      customerRegion,
      customerState: order.shippingAddress?.state || null,
      printerRegion,
      crossRegion: Boolean(isCrossRegion),
      forceOverride: Boolean(isCrossRegion && force),
      candidatesConsidered: 0,
      candidatesSameRegion: 0,
      reason: isCrossRegion ? `[CROSS-REGION OVERRIDE] ${message}` : message,
      tookMs: 0
    } as any);

    await order.save();

    // Reconcile capacity: the newly-assigned partner may now be at their max
    // (auto-pause), and on a reassignment the previous partner frees a slot
    // (possible auto-reopen).
    syncPartnerCapacitySafe(String(partnerId));
    if (isReassignment && previousPartnerId) syncPartnerCapacitySafe(String(previousPartnerId));

    notifyAllAdmins({
      category: "orders",
      priority: "medium",
      title: "Order assigned",
      message: `Order ${String(order._id)} → ${partner.companyName || partner.name}`,
      meta: { orderId: String(order._id), partnerId: String(partnerId) }
    }).catch(() => {});

    notifyPrinter({
      printerId: String(partnerId),
      category: "jobs",
      priority: order.priority === "URGENT" ? "high" : "medium",
      title: isReassignment ? "Job reassigned to you" : "New job assigned",
      message: `Order ${(order as any).displayId || String(order._id)} has been assigned to you and is ready to start.`,
      meta: { orderId: String(order._id) },
      settingsKey: "newJobs",
    }).catch(() => {});

    console.log(
      `[MANUAL_ASSIGN] order=${order._id} partnerId=${partnerId} partnerName=${partner.companyName || partner.name} ` +
      `priority=${order.priority} customerRegion=${customerRegion} printerRegion=${printerRegion} crossRegion=${Boolean(isCrossRegion)}`
    );

    res.status(200).json({
      orderId: order._id,
      assignedPartnerId: partnerId,
      status: "Pending",
      regionInfo: { customerRegion, printerRegion, crossRegion: Boolean(isCrossRegion) }
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
      .populate<{ assignedPrinter: IUser }>("assignedPrinter", "companyName email regions defaultShippingAddress businessAddress")
      .lean();

    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const formattedItems = (order.items || []).map(item => ({
      name: item.name,
      size: formatSheetSize((item as any).sheetWidthIn ?? item.widthIn, (item as any).sheetHeightIn ?? item.heightIn) || "Custom",
      quantity: item.quantity,
      price: item.unitPrice,
      subtotal: item.subtotal,
      // The sheet's own picture; the list showed a blank icon for every sheet.
      fileUrl: resolveApiFile(req, (item as any).previewImage) || undefined,
    }));

    const breakdown = computePartnerCostBreakdown({
      items: Array.isArray(order.items) ? order.items : [],
      partnerPricing: await getPartnerPayRate(),
      priority: (order as any).priority,
      adjustments: (order as any)?.pricing?.adjustments || []
    });
    /**
     * Null when there is nothing to derive a cost from — the fourth surface
     * that needed this. An order whose items carry no sheet dimensions has an
     * unknown partner cost, not a zero one, and `customerPaid - 0` reported
     * 100% margin on orders with no cost data at all.
     */
    const costDerivable = canDerivePartnerEarning(order);
    // An order from before fees were recorded gets its Stripe fee now, once.
    await recordMissingProcessingFee(order);
    const money = computeOrderFinancials(order, await getPartnerPayRate());

    const gangsheetOrderItem = (order.items || []).find((it: any) => it?.type === "gangsheet") as any | null;
    const designId = gangsheetOrderItem?.designId || order.items?.[0]?.designId || null;
    let designThumbnail = null;
    let designSize: { widthIn: number; heightIn: number } | null = null;
    let designArtboardItems: any[] | null = null;
    let gangsheetItems: any[] = [];
    const storedArtboardItems = Array.isArray(gangsheetOrderItem?.artboardItems) ? gangsheetOrderItem.artboardItems : null;
    const storedSheetWidthIn =
      typeof gangsheetOrderItem?.sheetWidthIn === "number"
        ? gangsheetOrderItem.sheetWidthIn
        : typeof gangsheetOrderItem?.widthIn === "number"
          ? gangsheetOrderItem.widthIn
          : null;
    const storedSheetHeightIn =
      typeof gangsheetOrderItem?.sheetHeightIn === "number"
        ? gangsheetOrderItem.sheetHeightIn
        : typeof gangsheetOrderItem?.heightIn === "number"
          ? gangsheetOrderItem.heightIn
          : null;

    if (storedArtboardItems && storedSheetWidthIn && storedSheetHeightIn) {
      designArtboardItems = storedArtboardItems;
      designSize = { widthIn: storedSheetWidthIn, heightIn: storedSheetHeightIn };
      designThumbnail = resolveApiFile(req, gangsheetOrderItem?.previewImage);
      gangsheetItems = storedArtboardItems.map((it: any) => {
        const url = it.croppedUrl || it.assetId || null;
        const rawSku = typeof it.assetId === "string" ? it.assetId : "";
        const sku = rawSku ? rawSku.split("/").filter(Boolean).slice(-1)[0] : `ITEM-${it.id}`;
        const baseName = sku ? sku.replace(/\.[a-z0-9]+$/i, "") : `Artwork ${it.id}`;
        return {
          name: baseName || `Artwork ${it.id}`,
          sku,
          quantity: typeof it.copies === "number" ? it.copies : 1,
          size: (typeof it.widthIn === "number" && typeof it.heightIn === "number")
            ? `${it.widthIn.toFixed(2)}\" × ${it.heightIn.toFixed(2)}\"`
            : "N/A",
          color: "N/A",
          customAttributes: {
            linked: Boolean(it.linked),
            autoCrop: it.autoCrop !== false,
            rotation: typeof it.rotation === "number" ? it.rotation : 0
          },
          fileUrl: url
        };
      });
    } else if (designId && /^[0-9a-fA-F]{24}$/.test(designId)) {
      const design = await Design.findById(designId).select("thumbnail size artboardData").lean();
      if (design && design.thumbnail) {
        designThumbnail = design.thumbnail;
      }
      if (design && design.size?.widthIn && design.size?.heightIn) {
        designSize = { widthIn: design.size.widthIn, heightIn: design.size.heightIn };
      }
      if (design && Array.isArray((design as any).artboardData?.items)) {
        const artboardItems = ((design as any).artboardData.items as any[]) || [];
        designArtboardItems = artboardItems;
        gangsheetItems = artboardItems.map((it: any) => {
          const url = it.croppedUrl || it.assetId || null;
          const rawSku = typeof it.assetId === "string" ? it.assetId : "";
          const sku = rawSku ? rawSku.split("/").filter(Boolean).slice(-1)[0] : `ITEM-${it.id}`;
          const baseName = sku ? sku.replace(/\.[a-z0-9]+$/i, "") : `Artwork ${it.id}`;
          return {
            name: baseName || `Artwork ${it.id}`,
            sku,
            quantity: typeof it.copies === "number" ? it.copies : 1,
            size: (typeof it.widthIn === "number" && typeof it.heightIn === "number")
              ? `${it.widthIn.toFixed(2)}\" × ${it.heightIn.toFixed(2)}\"`
              : "N/A",
            color: "N/A",
            customAttributes: {
              linked: Boolean(it.linked),
              autoCrop: it.autoCrop !== false,
              rotation: typeof it.rotation === "number" ? it.rotation : 0
            },
            fileUrl: url
          };
        });
      }
    }

    const regionUser = order.user
      ? await User.findById(order.user).select("regions").lean()
      : null;
    const oneUserRegionMap = new Map<string, string | null>(
      order.user
        ? [[String(order.user), Array.isArray((regionUser as any)?.regions) ? ((regionUser as any).regions[0] || null) : null]]
        : []
    );

    const orderSummary = {
      id: order._id,
      // The canonical human-readable order number, so every surface shows the
      // same identifier instead of deriving its own from the ObjectId.
      displayId: (order as any).displayId || null,
      status: order.status,
      priority: String((order as any).priority || "NORMAL").toUpperCase(),
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
        region: resolveOrderRegion(order, oneUserRegionMap)
      },

      items: formattedItems,

      statusTimeline: (order.statusTimeline || []).map(entry => ({
        status: entry.status,
        time: entry.time,
        // Older entries read "Printer updated status to QUALITY_CHECK".
        message: describeTimelineMessage((entry as any).message),
        actorRole: (entry as any).actorRole || null,
        actorId: (entry as any).actorId || null,
        actorName: (entry as any).actorName ?? null
      })),

      financials: {
        customerPaid: money.customerPaid,
        cancelled: money.cancelled,
        refunded: money.refunded,
        // What can still be returned to the card, and each refund already made.
        refundable: refundableAmount(order),
        refunds: (((order as any).payment?.refunds || []) as any[]).map((r) => ({
          id: String(r.id || ""),
          amount: Number(r.amount) || 0,
          reason: String(r.reason || ""),
          at: r.at,
          byName: String(r.byName || ""),
        })),
        keptOnCancel: money.keptOnCancel,
        partnerPaidOnCancel: money.partnerPaidOnCancel,
        canPayPartnerOnCancel: canPayPartnerOnCancel(order),
        // What the business does not keep, listed so the profit below adds up.
        tax: money.tax,
        shippingCharged: money.shippingCharged,
        shippingCost: money.shippingCost,
        shippingCostSource: money.shippingCostSource,
        processingFees: money.processingFee,
        /**
         * The rush surcharge, broken out.
         *
         * URGENT adds the partner's `rushPct` to what they are owed — 10% on
         * every seeded partner — and it was folded silently into partnerCost.
         * An admin could raise a payout by a tenth and see only the new total,
         * with nothing on screen saying why.
         */
        rushFee: costDerivable ? Number(breakdown.rushFee.toFixed(2)) : null,
        baseCost: costDerivable ? Number(breakdown.base.toFixed(2)) : null,
        partnerCost: money.partnerCost,
        adminProfit: money.profit,
        // False until the job ships: the partner is not paid before then, so
        // the margin is a forecast — same rule the Orders table uses.
        profitRealized: money.profitRealized,
        unavailableReason: costDerivable
          ? undefined
          : "This order has no sheet dimensions, so no partner cost can be worked out.",
        currency: order.pricing?.currency || "USD"
      },

      assignedPartner: order.assignedPrinter ? {
        id: (order.assignedPrinter as unknown as IUser)._id,
        name: (order.assignedPrinter as unknown as IUser).companyName,
        email: (order.assignedPrinter as unknown as IUser).email
      } : null,

      regionInfo: resolveRegionInfo(order, oneUserRegionMap),

      // A free replacement names the order it replaces, and that order names it back.
      reprintOf: (order as any).reprintOf?.orderId
        ? { orderId: String((order as any).reprintOf.orderId), displayId: String((order as any).reprintOf.displayId || "") }
        : null,
      reprints: (
        await Order.find({ "reprintOf.orderId": String(order._id) }).select("displayId status createdAt").sort({ createdAt: 1 }).lean()
      ).map((r: any) => ({ orderId: String(r._id), displayId: String(r.displayId || r._id), status: String(r.status || "") })),

      preview: {
        designId,
        sheetSize: formattedItems[0]?.size || "N/A",
        fileUrl: designThumbnail,
        sheetWidthIn: designSize?.widthIn || null,
        sheetHeightIn: designSize?.heightIn || null,
        artboardItems: designArtboardItems
      }
    };

    // Uploaded file names for every graphic on the order, to label the contents.
    const assetObjectIds = [
      ...new Set(
        orderSheets(order.items).flatMap((sh: any) =>
          (Array.isArray(sh.artboardItems) ? sh.artboardItems : [])
            .map((it: any) => String(it?.assetId || ""))
            .filter((id: string) => /^[0-9a-fA-F]{24}$/.test(id)),
        ),
      ),
    ];
    const assetNames = new Map<string, string>(
      (assetObjectIds.length
        ? await Asset.find({ _id: { $in: assetObjectIds } }).select("originalFilename").lean()
        : []
      )
        .filter((a: any) => a?.originalFilename)
        .map((a: any) => [String(a._id), String(a.originalFilename)]),
    );
    (orderSummary as any).cancellation = (order as any).cancellation || null;
    (orderSummary as any).gangsheetItems = designArtboardItems ? sheetContents(designArtboardItems, assetNames) : gangsheetItems;
    /*
     * Every sheet on the order. `preview` and `gangsheetItems` above describe
     * the first only (kept for older screens); a second sheet was invisible to
     * the admin, though the customer paid for it.
     */
    (orderSummary as any).sheets = sheetSummaries(order.items, (v) => resolveApiFile(req, v)).map((summary) => ({
      ...summary,
      sheetSize: formatSheetSize(summary.widthIn, summary.heightIn) || "N/A",
      gangsheetItems: sheetContents(orderSheets(order.items)[summary.index]?.artboardItems, assetNames),
    }));

    res.status(200).json(orderSummary);
  } catch (error) {
    next(error);
  }
};

export const getOrderGangsheetPreview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    const id = Array.isArray(orderId) ? String(orderId[0] || "") : String(orderId || "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error("Invalid order id") as CustomError;
      error.statusCode = 400;
      throw error;
    }

    const requestedResolution = Math.max(72, Math.min(100, parseInt(req.query.resolution as string) || 72));

    // Project only the 8 rendering fields from artboard items — all items, minimal payload.
    const [orderRaw] = await (Order as any).aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
      { $project: {
        assignedPrinter: 1,
        items: {
          $map: {
            input: { $ifNull: ["$items", []] },
            as: "item",
            in: {
              type: "$$item.type",
              widthIn: "$$item.widthIn",
              heightIn: "$$item.heightIn",
              sheetWidthIn: "$$item.sheetWidthIn",
              rollWidthIn: "$$item.rollWidthIn",
              sheetHeightIn: "$$item.sheetHeightIn",
              artboardItems: {
                $map: {
                  input: { $ifNull: ["$$item.artboardItems", []] },
                  as: "ai",
                  in: {
                    assetId: "$$ai.assetId",
                    croppedUrl: "$$ai.croppedUrl",
                    widthIn: "$$ai.widthIn",
                    heightIn: "$$ai.heightIn",
                    posX: "$$ai.posX",
                    posY: "$$ai.posY",
                    rotation: "$$ai.rotation",
                    // Flip and the auto-nest layout fields were not projected, so
                    // the admin preview drew mirrored and nested pieces wrongly.
                    flipped: "$$ai.flipped",
                    copies: "$$ai.copies",
                    nestRotation: "$$ai.nestRotation",
                    flowCols: "$$ai.flowCols",
                  },
                },
              },
            },
          },
        },
      }},
    ]);

    if (!orderRaw) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const { sheet: gangsheetItem } = pickOrderSheet(orderRaw.items, req.query?.sheet);
    const artboardItems = Array.isArray(gangsheetItem.artboardItems) ? gangsheetItem.artboardItems : [];
    if (artboardItems.length === 0) {
      const error = new Error("No artboard items found for this order") as CustomError;
      error.statusCode = 422;
      throw error;
    }

    /**
     * The roll width this order was built on — see `orderSheetWidthIn`.
     *
     * Never the artwork's bounding width: item `posX` values are absolute
     * against the roll, so a canvas sized to anything else puts every
     * x-coordinate in the wrong place and clips what falls past its edge.
     */
    const sheetWidthIn = orderSheetWidthIn(gangsheetItem);
    const sheetHeightIn = typeof gangsheetItem.sheetHeightIn === "number" && Number.isFinite(gangsheetItem.sheetHeightIn)
      ? gangsheetItem.sheetHeightIn : typeof gangsheetItem.heightIn === "number" && Number.isFinite(gangsheetItem.heightIn)
      ? gangsheetItem.heightIn : 23.5;

    const printerId = String((orderRaw as any).assignedPrinter || "admin");

    // Cap DPI so the canvas never exceeds ~15 Mpx: prevents a single 1200"-sheet
    // preview from allocating a 550+ MB RGBA buffer and exceeding browser image limits.
    const MAX_PREVIEW_PIXELS = 15_000_000;
    const pixelBudgetDPI = Math.floor(
      Math.sqrt(MAX_PREVIEW_PIXELS / Math.max(0.01, sheetWidthIn * sheetHeightIn))
    );
    const resolution = Math.max(10, Math.min(requestedResolution, pixelBudgetDPI));

    const rendered = await exportGangsheetPng24({
      jobId: id,
      printerId,
      sheetWidthIn,
      sheetHeightIn,
      artboardItems,
      dpi: resolution,
      maxComposites: 500, // Cap admin previews to first 500 composites for instant response
      format: "webp",
      useLossyPreview: true, // Use fast lossy WebP for admin preview
    });

    // The API's own address, not APP_URL (the store's) — see utils/publicApiBase.ts.
    const previewDataUrl = apiFileUrl(req, rendered.relativePath);

    res.json({
      previewDataUrl,
      resolutionDPI: rendered.dpi,
      sheetWidthIn,
      sheetHeightIn,
      totalItems: artboardItems.length,
      cacheKey: rendered.cacheKey,
      previewNote: artboardItems.length > 500 ? "Preview shows first 500 items" : undefined,
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

    const formattedItems = (order.items || []).map((item) => {
      const description =
        formatSheetSize((item as any).sheetWidthIn ?? item.widthIn, (item as any).sheetHeightIn ?? item.heightIn) || "";
      return {
        name: item.name || "Unknown Item",
        description: description,
        quantity: item.quantity || 0,
        unitPrice: (item.unitPrice || 0).toFixed(2),
        subtotal: (item.subtotal || 0).toFixed(2)
      };
    });

    const pricing = order.pricing || {};
    // Shared with the customer's invoice, so both copies list the same charges.
    const lineItems = orderChargeLines(order);

    const data = {
      // The invoice is the most customer-visible document there is, so it
      // carries the canonical DTF-#### number rather than the raw ObjectId.
      orderId: (order as any).displayId || String(order._id),
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
      },
      note: orderInvoiceNote(order) || undefined,
    };

    const pdfBuffer = await renderInvoicePdf(data);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${data.orderId}.pdf"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.send(pdfBuffer);

  } catch (error) {
    next(error);
  }
};

/**
 * Cancels an order and refunds the customer. The refund and the status change
 * are in `orderCancellation.service`; this adds what follows from them.
 */
export const cancelOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = String(req.params.orderId || "");
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }
    const order = await Order.findById(orderId).lean();
    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const admin = await User.findById(req.user?.id).select("name email").lean();
    const reason = String(req.body?.reason || "").trim();
    const result = await cancelOrderWithRefund(
      order,
      { id: String(req.user?.id || ""), name: String((admin as any)?.name || (admin as any)?.email || "Admin") },
      reason,
      undefined,
      {
        payPartner: req.body?.payPartner === true,
        refundAmount: req.body?.refundAmount === undefined || req.body?.refundAmount === null ? undefined : Number(req.body.refundAmount),
      },
    );

    const displayId = String((order as any).displayId || orderId);
    const partnerId = (order as any).assignedPrinter ? String((order as any).assignedPrinter) : null;
    if (partnerId) {
      // The job no longer counts against the partner's limit, and they need to stop work.
      syncPartnerCapacitySafe(partnerId);
      notifyPrinter({
        printerId: partnerId,
        category: "jobs",
        priority: "high",
        title: "Order cancelled",
        message: result.partnerPaid
          ? `Order ${displayId} was cancelled by Space Transfers. Please stop work on it. You'll still be paid for this job.`
          : `Order ${displayId} was cancelled by Space Transfers. Please stop work on it.`,
        meta: { orderId, status: "CANCELLED" },
        settingsKey: "orderUpdates",
      }).catch(() => {});
    }
    publishOrderEvent(orderId, "order.status.changed", { orderId, status: "CANCELLED", updatedAt: new Date() });
    const mail = await sendOrderCancelledEmail(order, result.refundAmount, reason);

    res.json({
      cancelled: true,
      ...result,
      customerNotified: Boolean(mail?.sent),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Refunds part or all of an order's payment without cancelling it. The order
 * carries on; only the money changes.
 */
export const refundOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = String(req.params.orderId || "");
    const order = mongoose.Types.ObjectId.isValid(orderId) ? await Order.findById(orderId).lean() : null;
    if (!order) {
      const error = new Error("Order not found") as CustomError;
      error.statusCode = 404;
      throw error;
    }

    const admin = await User.findById(req.user?.id).select("name email").lean();
    const reason = String(req.body?.reason || "").trim();
    const result = await refundOrderPayment(
      order,
      { id: String(req.user?.id || ""), name: String((admin as any)?.name || (admin as any)?.email || "Admin") },
      { amount: Number(req.body?.amount), reason },
    );

    publishOrderEvent(orderId, "order.financials.changed", { orderId, updatedAt: new Date() });
    const mail = await sendOrderRefundedEmail(order, result, reason);

    res.json({ refunded: true, ...result, customerNotified: Boolean(mail?.sent) });
  } catch (error) {
    next(error);
  }
};
