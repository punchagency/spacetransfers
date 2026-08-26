import { useNavigate } from "react-router-dom";
import type { Order } from "../../data/orders";
import { GenericTable } from "../common/GenericTable";

/**
 * Keyed on the row's display label via the shared map's inverse — the row only
 * carries the label, and duplicating a second colour table here is how the
 * labels drifted in the first place.
 */
const getStatusColor = (label: string) => {
  switch (label) {
    case "Completed":   return "text-green-600";
    case "Shipped":     return "text-gray-900";
    case "Ready to Ship": return "text-purple-600";
    case "Printing":    return "text-indigo-600";
    case "Assigned":    return "text-blue-600";
    case "Unassigned":  return "text-amber-500";
    case "Cancelled":   return "text-gray-400";
    default:            return "text-gray-500";
  }
};

export const OrdersTable = ({
  orders,
  title = "Recent Orders",
  itemsPerPage = 7,
}: {
  orders: Order[];
  title?: string;
  itemsPerPage?: number;
}) => {
  const navigate = useNavigate();

  const columns = [
    { header: "Order ID", key: "id" as keyof Order, className: "font-medium text-gray-900" },
    { header: "Customer", key: "customer" as keyof Order, className: "text-gray-700 font-medium" },
    {
      header: "Region",
      sortValue: (o: Order) => o.region,
      render: (order: Order) => (
        <div className="flex items-center gap-2">
          <span className="text-gray-500">{order.region}</span>
          {order.crossRegion && (
            <span
              title={`No partner was available in ${order.crossRegion.customerRegion}, so this went to ${order.crossRegion.assignedRegion}. Expect longer, costlier shipping.`}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap"
            >
              → {order.crossRegion.assignedRegion}
            </span>
          )}
        </div>
      )
    },
    {
      header: "Partner",
      sortValue: (o: Order) => o.partner,
      render: (order: Order) => (
        <span className={order.partner === "Unassigned" ? "text-gray-400 italic" : "text-gray-600"}>
          {order.partner}
        </span>
      )
    },
    {
      header: "Status",
      sortValue: (o: Order) => o.status,
      render: (order: Order) => (
        <span className={`font-medium ${getStatusColor(order.status)}`}>
          {order.status}
        </span>
      )
    },
    {
      header: "Amount",
      key: "amount" as keyof Order,
      className: "font-bold text-gray-900",
      sortValue: (o: Order) => Number(String(o.amount || "").replace(/[^0-9.]/g, "")) || 0,
    },
    {
      header: "Profits",
      key: "profit" as keyof Order,
      className: "font-bold text-gray-900",
      sortValue: (o: Order) => Number(String(o.profit || "").replace(/[^0-9.]/g, "")) || 0,
      /**
       * Marked "est." until the order ships.
       *
       * Revenue is counted from the moment an order is placed, and the partner
       * is not paid until it ships, so both halves of this figure are a
       * forecast until then. Presenting it identically to a settled margin
       * overstated how much of it was real.
       *
       * "—" means something different: no sheet dimensions, so no cost could be
       * derived at all. That one carries its own explanation.
       */
      render: (order: Order) => {
        const unknown = order.profit === "—";
        return (
          <span
            className={unknown ? "font-normal text-gray-400 cursor-help" : "font-bold text-gray-900"}
            title={
              unknown
                ? "No sheet dimensions on this order, so no partner cost can be worked out."
                : order.profitRealized
                  ? undefined
                  : "Estimated. The partner is not paid until the order ships, so this is not settled yet."
            }
          >
            {order.profit}
            {!unknown && !order.profitRealized && (
              <span className="ml-1 text-[11px] font-normal text-gray-400">est.</span>
            )}
          </span>
        );
      },
    },
    {
      header: "Date",
      key: "date" as keyof Order,
      className: "text-gray-500",
      sortValue: (o: Order) => o.createdAtMs || 0,
    },
    {
      header: "Action",
      /*
       * A span, not a button. It never had an onClick — it "worked" only
       * because the click bubbled up to the row's own navigate handler, so a
       * stopPropagation anywhere above would have silently killed it while it
       * still looked clickable. The whole row is the control; this is the
       * affordance that says so.
       */
      render: () => (
        <span className="text-gray-400 group-hover:text-gray-600 font-medium text-xs uppercase tracking-wide">
          View
        </span>
      )
    },
  ];

  return (
    <GenericTable
      data={orders}
      columns={columns}
      title={title}
      itemsPerPage={itemsPerPage}
      sortable
      defaultSortColumnIndex={7}
      defaultSortDirection="desc"
      onRowClick={(order) => navigate(`/dashboard/orders/${order.actualId || order.id.replace('#', '')}`)}
    />
  );
};
