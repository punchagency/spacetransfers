import { formatOrderNumber } from "./orderNumber";
import { formatOrderStatus } from "./orderStatus";
import type { Order as OrderRow } from "../data/orders";

/**
 * Display label for a row. Delegates to the shared map so the table, the detail
 * header and the timeline cannot drift apart — which is exactly what happened
 * when each kept its own copy.
 */
const normalizeStatus = (status: string): OrderRow["status"] =>
    formatOrderStatus(status) as OrderRow["status"];

export const mapAdminOrderToRow = (o: any): OrderRow => {
  const id = o.id?.toString?.() || String(o.id || "");
  const customer =
    typeof o.customer === "string"
      ? o.customer
      : o.customer && typeof o.customer === "object"
        ? `${o.customer.firstName || ""} ${o.customer.lastName || ""}`.trim() ||
          o.customer.email ||
          "N/A"
        : "N/A";

  return {
    id: formatOrderNumber(o.displayId, id),
    actualId: id,
    createdAtMs: new Date(o.createdAt).getTime(),
    customer,
    region: o.region || "Unknown",
    crossRegion: o.crossRegion || null,
    partner: o.assignedPartner || "Unassigned",
    status: normalizeStatus(o.status),
    amount: `$${Number(o.total || 0).toFixed(2)}`,
    /**
     * "—" when the server could not derive a partner cost, which is not the
     * same as a cost of zero.
     *
     * `Number(o.profits || 0)` collapsed the two, and because the server used
     * to send `total - 0` for such orders, the table showed profit equal to the
     * full amount — reporting 100% margin on orders it had no cost data for.
     */
    profit:
      o.profits === null || o.profits === undefined
        ? "—"
        : `$${Number(o.profits).toFixed(2)}`,
    profitRealized: Boolean(o.profitsRealized),
    // Already on the wire from listOrders and rendered nowhere: an admin could
    // add 10% to a payout and then never see which orders carried it.
    isUrgent: Boolean(o.isUrgent),
    date: new Date(o.createdAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  };
};
