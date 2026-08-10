export type OrderStatus =
  | "Pending Review"
  | "In Progress - Printing"
  | "Print Shipping Label"
  | "Order Shipped"
  | "Completed"
  | "Cancelled";

export interface Order {
  id: string;
  actualId?: string;
  displayId?: string;
  customerName: string;
  isUrgent: boolean;
  hasWarning: boolean;
  thumbnail: string;
  sheetSize: string;
  filmType: string;
  dueDate: string;
  location: string;
  status: OrderStatus;
  statusDescription?: string;
}

export type OrdersTabLabel =
  | "All Jobs"
  | "Pending"
  | "In Progress - Printing"
  | "Print Shipping Label"
  | "Order Shipped"
  | "Completed"
  | "Cancelled";

export interface OrdersTab {
  label: OrdersTabLabel;
  count: number;
}
