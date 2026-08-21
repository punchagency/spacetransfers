export type PrimaryMethod = "stripe_connect" | "bank" | "paypal";

export interface NotificationEmailPrefs {
  newJobs: boolean;
  orderUpdates: boolean;
  payoutAlerts: boolean;
  accountUpdates: boolean;
  systemAlerts: boolean;
}

export type NotificationsSectionProps = {
  initialPrefs: NotificationEmailPrefs | null;
};

export type PrintingCapabilitiesSectionProps = {
  sheetSize: string;
  onSheetSizeChange: (value: string) => void;
  maxResolution: string;
  onMaxResolutionChange: (value: string) => void;
  selectedInks: string[];
  onToggleInk: (ink: string) => void;
  selectedFilms: string[];
  onToggleFilm: (film: string) => void;
};

