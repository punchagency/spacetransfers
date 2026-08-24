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
    profit: `$${Number(o.profits || 0).toFixed(2)}`,
    date: new Date(o.createdAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  };
};
