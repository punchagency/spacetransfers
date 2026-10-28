import { useState } from "react";
import { FiBell, FiSave, FiRefreshCw } from "react-icons/fi";
import { Toggle } from "../common/Toggle";
import { apiFetch } from "../../utils/api";
import toast from "react-hot-toast";
import type { NotificationEmailPrefs, NotificationsSectionProps } from "../../types/settings";

const DEFAULT_PREFS: NotificationEmailPrefs = {
  newJobs: true,
  orderUpdates: true,
  payoutAlerts: true,
  accountUpdates: true,
};

const EMAIL_EVENTS: { key: keyof NotificationEmailPrefs; label: string; description: string }[] = [
  {
    key: "newJobs",
    label: "New Orders",
    description: "When a new job is assigned or auto-assigned to you",
  },
  {
    key: "orderUpdates",
    label: "Order Status Updates",
    description: "When an order moves through print stages (accepted, printing, completed, cancelled)",
  },
  {
    key: "payoutAlerts",
    label: "Payout Alerts",
    description: "When a payout is processed, scheduled, or your Stripe status changes",
  },
  {
    key: "accountUpdates",
    label: "Account Updates",
    description: "Email verification, profile or account setting changes",
  },
];

const NotificationsSection = ({ initialPrefs }: NotificationsSectionProps) => {
  const [prefs, setPrefs] = useState<NotificationEmailPrefs>(() => ({
    ...DEFAULT_PREFS,
    ...initialPrefs,
  }));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch("/printer/settings", {
        method: "PATCH",
        body: JSON.stringify({ notifications: { email: prefs } }),
      });
      toast.success("Notification preferences saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <FiBell className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Notifications</h2>
            <p className="text-xs text-gray-500">
              Email alerts mirror your in-app notifications — disable here to silence both
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-60"
        >
          {saving ? (
            <FiRefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <FiSave className="w-3.5 h-3.5" />
          )}
          Save
        </button>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
          Email Notifications
        </h3>
        <div className="space-y-1">
          {EMAIL_EVENTS.map(({ key, label, description }) => (
            <div
              key={key}
              className="flex items-center justify-between py-3 border-b last:border-b-0 border-gray-100"
            >
              <div>
                <p className="text-sm font-medium text-gray-800">{label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{description}</p>
              </div>
              <Toggle
                label={label}
                enabled={prefs[key]}
                setEnabled={(v) => setPrefs((prev) => ({ ...prev, [key]: v }))}
              />
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs text-gray-500">
        Turning off a notification suppresses both the in-app alert and the corresponding email for that event.
      </p>
    </section>
  );
};

export default NotificationsSection;
