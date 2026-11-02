export interface NotificationEmailPrefs {
  newJobs: boolean;
  orderUpdates: boolean;
  payoutAlerts: boolean;
  accountUpdates: boolean;
}

export type NotificationsSectionProps = {
  initialPrefs: NotificationEmailPrefs | null;
};

