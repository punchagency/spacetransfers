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
    date: string;
}
