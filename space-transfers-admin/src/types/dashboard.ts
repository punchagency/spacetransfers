import type { ReactNode } from "react";

export interface DashboardLayoutProps {
  children: ReactNode;
}

export interface StatCardItem {
  title: string;
  value: string;
  /**
   * Percentage change against the previous equivalent period.
   *
   * `undefined`/`null` means there is nothing to compare against, which is a
   * different thing from 0 (genuinely unchanged) — the card renders no trend
   * for the former and a neutral "0%" for the latter.
   */
  trendPct?: number | null;
  /** Explains what the trend is measured against. Shown on hover. */
  trendHint?: string;
  /**
   * The period the value covers, e.g. "Last 30 days".
   *
   * Without it a card reading "Total Orders: 9" claims to be an all-time total
   * when it is a windowed count — correct only while no data is older than the
   * window.
   */
  subtitle?: string;
}

export interface StatCardProps {
  title: string;
  value: string;
  trendPct?: number | null;
  trendHint?: string;
  subtitle?: string;
}

export interface StatsGridProps {
  cards?: StatCardItem[];
}
