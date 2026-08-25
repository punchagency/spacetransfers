export interface Order {
    id: string;
    actualId?: string;
    createdAtMs?: number;
    customer: string;
    region: string;
    /** Set when the order was fulfilled outside the customer's own region. */
    crossRegion?: { customerRegion: string; assignedRegion: string } | null;
    partner: string;
    status: "Assigned" | "Completed" | "Ready to Ship" | "Processing" | "Pending" | "Rejected" | "Shipped" | "Cancelled";
    amount: string;
    profit: string;
    /**
     * False while the order has not shipped. Partners are not paid before then
     * and revenue is counted from placement, so the figure is a forecast — the
     * table marks it rather than presenting it as money already made.
     */
    profitRealized?: boolean;
    date: string;
}
