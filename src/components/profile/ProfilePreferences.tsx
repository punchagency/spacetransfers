import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { apiFetch } from "../../utils/api";

export const ProfilePreferences = () => {
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [settings, setSettings] = useState<{
    email: {
      orderUpdates: boolean;
      partnerActivity: boolean;
      systemAlerts: boolean;
    };
  }>({
    email: { orderUpdates: true, partnerActivity: true, systemAlerts: true },
  });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await apiFetch("/admin/profile/preferences");
        const next = {
          email: {
            orderUpdates: Boolean(res?.email?.orderUpdates),
            partnerActivity: Boolean(res?.email?.partnerActivity),
            systemAlerts: Boolean(res?.email?.systemAlerts),
          },
        };
        setSettings(next);
      } catch (error: any) {
        toast.error(error.message || "Failed to load preferences");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const emailCategories = useMemo(() => {
    return [
      {
        id: "orderUpdates" as const,
        title: "Order Updates",
        description: "New orders, assignments, status changes, printer rejections and returns, shipping, delivery, and fulfilment failures",
      },
      {
        id: "partnerActivity" as const,
        title: "Partner Activity",
        description: "Printer signups, approvals, and rejections",
      },
      {
        id: "systemAlerts" as const,
        title: "System Alerts",
        description: "Sign-in alerts, failed sign-in attempts, and password changes on your account",
      },
    ];
  }, []);

  const toggleEmailCategory = async (key: "orderUpdates" | "partnerActivity" | "systemAlerts") => {
    if (loading) return;
    if (savingKey) return;

    const prevSnapshot = settings;
    const nextEnabled = !settings.email[key];

    const optimistic = {
      ...settings,
      email: {
        ...settings.email,
        [key]: nextEnabled,
      },
    };

    setSettings(optimistic);
    setSavingKey(key);
    try {
      const res = await apiFetch("/admin/profile/preferences", {
        method: "PATCH",
        body: JSON.stringify(optimistic),
      });
      setSettings({
        email: {
          orderUpdates: Boolean(res?.email?.orderUpdates),
          partnerActivity: Boolean(res?.email?.partnerActivity),
          systemAlerts: Boolean(res?.email?.systemAlerts),
        },
      });
    } catch (error: any) {
      setSettings(prevSnapshot);
      toast.error(error.message || "Failed to update preferences");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="mb-8">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Preferences</h1>
          <p className="text-sm text-gray-500 mt-1">
            Choose which events notifies you. Turning a category off stops both the
            emails and the in-app notifications for it.
          </p>
        </div>
      </div>

      {/* Notifications */}
      <div>
        <h3 className="text-base font-bold text-gray-900 mb-6">
          Notifications
        </h3>

        <div className="space-y-4">
          {emailCategories.map((g) => {
            const enabled = Boolean(settings.email[g.id]);
            const isSaving = savingKey === g.id;
            return (
              <div
                key={g.id}
                className="flex items-center justify-between p-5 border border-gray-200 rounded-lg bg-white"
              >
                <div className="pr-4">
                  <div className="font-semibold text-gray-900 text-sm">
                    {g.title}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {g.description}
                  </div>
                </div>
                <button
                  onClick={() => void toggleEmailCategory(g.id)}
                  disabled={loading || Boolean(savingKey)}
                  aria-label={`${g.title} notifications`}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${enabled ? "bg-blue-600" : "bg-gray-200"
                    } ${isSaving ? "opacity-70" : ""}`}
                >
                  <span
                    className={`${enabled ? "translate-x-6" : "translate-x-1"
                      } inline-block h-5 w-5 transform rounded-full bg-white transition-transform`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};
