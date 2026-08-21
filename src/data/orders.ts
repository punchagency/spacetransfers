export interface Order {
    id: string;
    actualId?: string;
    createdAtMs?: number;
    customer: string;
    region: string;
    partner: string;
    status: "Assigned" | "Completed" | "Ready to Ship" | "Processing" | "Pending" | "Rejected" | "Shipped" | "Cancelled";
    amount: string;
    profit: string;
    date: string;
}
