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

/*
 * `PrintingCapabilitiesSectionProps` and its component were removed. The
 * component was never mounted on the Settings page — it referenced only itself
 * — and the fields it edited (max sheet size, inks, films, DPI) are the same
 * ones the admin console dropped as decorative: nothing in assignment or
 * pricing reads them, so it was a form promising the platform would respect
 * capabilities it does not check.
 */

