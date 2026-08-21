import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { apiFetch } from "../../utils/api";

/**
 * Admin email notification preferences.
 *
 * Bound to `GET/PATCH /admin/settings/notifications`. The server stores exactly
 * three boolean keys, each mapping to one notification category
 * (`orders` / `partners` / `system`), and a disabled category suppresses the
 * in-app record as well as the email.
 *
 * The previous static mockup offered seven invented email toggles and two SMS
 * toggles. None of them existed server-side — the API returns `sms: {}` and has
 * no SMS support at all — so every one of those switches was decorative. Only
 * the three real preferences are offered here.
 */

type PrefKey = "orderUpdates" | "partnerActivity" | "systemAlerts";

const PREFS: Array<{ id: PrefKey; label: string; desc: string }> = [
  {
    id: "orderUpdates",
    label: "Order Activity",
    desc: "New orders, rejections, shipping failures and deliveries",
  },
  {
    id: "partnerActivity",
    label: "Partner Activity",
    desc: "New partner signups and partner status changes",
  },
  {
    id: "systemAlerts",
    label: "System Alerts",
    desc: "Sign-in alerts and platform-level warnings",
  },
];

type Prefs = Record<PrefKey, boolean>;

const DEFAULTS: Prefs = {
  orderUpdates: true,
  partnerActivity: true,
  systemAlerts: true,
};

export const NotificationSettings = () => {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch("/admin/settings/notifications");
        if (cancelled) return;
        const email = data?.email || {};
        setPrefs({
          orderUpdates: email.orderUpdates !== false,
          partnerActivity: email.partnerActivity !== false,
          systemAlerts: email.systemAlerts !== false,
        });
      } catch (error: any) {
        if (!cancelled) toast.error(error.message || "Could not load preferences");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Saves on toggle rather than behind a Save button.
   *
   * A single switch has no intermediate state worth batching, and the optimistic
   * flip is reverted on failure so the control never shows a preference the
   * server didn't accept.
   */
  const toggle = async (key: PrefKey) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(true);
    try {
      await apiFetch("/admin/settings/notifications", {
        method: "PATCH",
        body: JSON.stringify({ email: next }),
      });
    } catch (error: any) {
      setPrefs(prefs);
      toast.error(error.message || "Could not save preference");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8">
        <h2 className="text-xl font-bold text-gray-900 mb-1">
          Email Notifications
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          Turning a category off stops both the emails and the in-app
          notifications for it. Emails are batched, so a burst of activity
          arrives as one message.
        </p>

        <div className="space-y-3">
          {PREFS.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
            >
              <div>
                <h3 className="text-sm font-medium text-gray-900">{item.label}</h3>
                <p className="text-sm text-gray-500 mt-1">{item.desc}</p>
              </div>
              <button
                type="button"
                aria-pressed={prefs[item.id]}
                aria-label={item.label}
                onClick={() => toggle(item.id)}
                disabled={loading || saving}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
                  prefs[item.id] ? "bg-blue-600" : "bg-gray-200"
                }`}
              >
                <span
                  className={`${
                    prefs[item.id] ? "translate-x-6" : "translate-x-1"
                  } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
