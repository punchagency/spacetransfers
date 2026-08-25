import { formatOrderNumber } from "./orderNumber";
import type { Order as OrderRow } from "../data/orders";

const normalizeStatus = (status: string): OrderRow["status"] => {
  const s = String(status || "").toUpperCase();
  if (s === "PENDING") return "Pending";
  if (s === "PROCESSING") return "Assigned";
  if (s === "PRINTING") return "Processing";
  if (s === "SHIPPED") return "Ready to Ship";
  if (s === "COMPLETED") return "Completed";
  if (s === "REJECTED") return "Rejected";
  if (s === "CANCELLED") return "Cancelled";
  return "Pending";
};

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
    date: new Date(o.createdAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  };
};
