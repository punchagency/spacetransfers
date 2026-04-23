import type { ReactNode } from "react";

export interface DashboardLayoutProps {
  children: ReactNode;
}

export interface StatCardItem {
  title: string;
  value: string;
  trend: string;
}

export interface StatCardProps {
  title: string;
  value: string;
  trend: string;
}

export interface StatsGridProps {
  cards?: StatCardItem[];
}
