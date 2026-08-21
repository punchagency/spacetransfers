import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { apiFetch } from "../../utils/api";

/**
 * Account security: password change, 2FA toggle, and real login history.
 *
 * Bound to `PATCH /admin/profile/password`, `GET/PATCH /admin/settings/security`
 * and `GET /admin/security/login-activity`. The previous static mockup had a
 * password form with no submit handler and a login table of three hardcoded
 * rows dated 2023 — that table was the most misleading thing in the app, since
 * a fabricated security log reads as real evidence.
 */

interface ActivityRow {
  id: string;
  device: string;
  ip: string;
  location: string;
  status: string;
  time: string;
}

const inputClass =
  "w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-gray-400";

export const SecuritySettings = () => {
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [savingTwoFactor, setSavingTwoFactor] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [security, log] = await Promise.all([
          apiFetch("/admin/settings/security"),
          apiFetch("/admin/security/login-activity?pageSize=10&page=1"),
        ]);
        if (cancelled) return;
        setTwoFactorEnabled(Boolean(security?.twoFactorEnabled));
        setActivity(Array.isArray(log?.activity) ? log.activity : []);
      } catch (error: any) {
        if (!cancelled) toast.error(error.message || "Could not load security settings");
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleTwoFactor = async () => {
    const next = !twoFactorEnabled;
    setTwoFactorEnabled(next);
    setSavingTwoFactor(true);
    try {
      await apiFetch("/admin/settings/security", {
        method: "PATCH",
        body: JSON.stringify({ twoFactorEnabled: next }),
      });
      toast.success(next ? "Two-factor authentication enabled" : "Two-factor authentication disabled");
    } catch (error: any) {
      setTwoFactorEnabled(!next);
      toast.error(error.message || "Could not update two-factor authentication");
    } finally {
      setSavingTwoFactor(false);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword.trim()) {
      toast.error("Enter your current password.");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Your new password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("The new passwords don't match.");
      return;
    }

    setUpdatingPassword(true);
    try {
      await apiFetch("/admin/profile/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated");
    } catch (error: any) {
      toast.error(error.message || "Could not update password");
    } finally {
      setUpdatingPassword(false);
    }
  };

  const formatTime = (value: string) => {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Change Password */}
      <form
        onSubmit={handlePasswordUpdate}
        className="bg-white rounded-lg border border-gray-200 shadow-sm p-8"
      >
        <h2 className="text-xl font-bold text-gray-900 mb-6">Change Password</h2>
        <div className="space-y-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700" htmlFor="current-password">
              Current Password
            </label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700" htmlFor="new-password">
                New Password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
              />
              <p className="text-sm text-gray-500">At least 8 characters.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700" htmlFor="confirm-password">
                Confirm New Password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={updatingPassword}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
            >
              {updatingPassword ? "Updating…" : "Update Password"}
            </button>
          </div>
        </div>
      </form>

      {/* Two-Factor Authentication */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              Two-Factor Authentication
            </h2>
            <p className="text-gray-500 mt-1 text-sm">
              Add an extra layer of security to your account
            </p>
          </div>
          <button
            type="button"
            aria-pressed={twoFactorEnabled}
            aria-label="Two-factor authentication"
            onClick={toggleTwoFactor}
            disabled={savingTwoFactor}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
              twoFactorEnabled ? "bg-blue-600" : "bg-gray-200"
            }`}
          >
            <span
              className={`${
                twoFactorEnabled ? "translate-x-6" : "translate-x-1"
              } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
            />
          </button>
        </div>
      </div>

      {/* Login Activity History */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Login Activity History</h2>
          <p className="text-sm text-gray-500 mt-1">
            Your 10 most recent sign-in attempts.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-500">
            <thead className="bg-gray-50 text-gray-700 uppercase">
              <tr>
                <th className="px-6 py-3 font-medium">Device / Browser</th>
                <th className="px-6 py-3 font-medium">IP Address</th>
                <th className="px-6 py-3 font-medium">Location</th>
                <th className="px-6 py-3 font-medium">Time</th>
                <th className="px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {activityLoading ? (
                <tr className="bg-white">
                  <td className="px-6 py-4" colSpan={5}>
                    Loading…
                  </td>
                </tr>
              ) : activity.length === 0 ? (
                <tr className="bg-white">
                  <td className="px-6 py-4" colSpan={5}>
                    No sign-in activity recorded yet.
                  </td>
                </tr>
              ) : (
                activity.map((log) => (
                  <tr key={log.id} className="bg-white hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{log.device}</td>
                    <td className="px-6 py-4">{log.ip}</td>
                    <td className="px-6 py-4">{log.location}</td>
                    <td className="px-6 py-4">{formatTime(log.time)}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          log.status === "Success"
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
