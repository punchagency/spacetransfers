import { useEffect, useMemo, useState } from "react";
import { FiEye, FiEyeOff } from "react-icons/fi";
import toast from "react-hot-toast";
import { apiFetch } from "../../utils/api";
import { getUser, setAuth } from "../../utils/auth";
import { PasskeyManager } from "../security/PasskeyManager";
import { AdminPasskeyList } from "../security/AdminPasskeyList";

export const ProfileSecurity = () => {
  const [loading, setLoading] = useState(true);
  const [lastPasswordChange, setLastPasswordChange] = useState<Date | null>(
    null
  );
  const [activity, setActivity] = useState<Array<{
    id: string;
    device: string;
    ip: string;
    location: string;
    status: string;
    time: string;
  }>>([]);

  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [security, log] = await Promise.all([
          apiFetch("/admin/settings/security"),
          apiFetch("/admin/security/login-activity?pageSize=10&page=1"),
        ]);
        setLastPasswordChange(security.lastPasswordChange ? new Date(security.lastPasswordChange) : null);
        setActivity(Array.isArray(log?.activity) ? log.activity : []);
      } catch (error: any) {
        toast.error(error.message || "Failed to load security settings");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const canUpdatePassword = useMemo(() => {
    if (loading) return false;
    if (updatingPassword) return false;
    if (!currentPassword.trim()) return false;
    if (newPassword.length < 8) return false;
    if (newPassword !== confirmPassword) return false;
    return true;
  }, [loading, updatingPassword, currentPassword, newPassword, confirmPassword]);

  const formatTime = (value: string) => {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  };

  const handleUpdatePassword = async () => {
    if (!canUpdatePassword) return;
    setUpdatingPassword(true);
    try {
      const res = await apiFetch("/admin/profile/password", {
        method: "PATCH",
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      // Changing it signs every other device out; this one carries on with a new session.
      const me = getUser();
      if (res?.token && me) setAuth(res.token, me);
      toast.success("Password updated. Other devices have been signed out.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setLastPasswordChange(new Date());
    } catch (error: any) {
      toast.error(error.message || "Failed to update password");
    } finally {
      setUpdatingPassword(false);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-lg font-bold text-gray-900">Security Options</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your account security settings.
        </p>
      </div>

      <div className="mb-10">
        <PasskeyManager account={String(getUser()?.email || "")} />
      </div>

      <div className="mb-10">
        <AdminPasskeyList />
      </div>

      {/* Change Password */}
      <div className="space-y-6">
        <div>
          <h3 className="text-base font-bold text-gray-900">Change Password</h3>
          {lastPasswordChange && (
            <div className="text-xs text-gray-500 mt-1">
              Last password change:{" "}
              {lastPasswordChange.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">
            Current Password
          </label>
          <div className="relative">
            <input
              type={showCurrent ? "text" : "password"}
              placeholder="Enter current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full pr-11 px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-gray-400"
            />
            <button
              type="button"
              aria-label="Toggle current password visibility"
              onClick={() => setShowCurrent((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-600 transition-colors"
            >
              {showCurrent ? <FiEyeOff className="w-4 h-4" /> : <FiEye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">
            New Password
          </label>
          <div className="relative">
            <input
              type={showNew ? "text" : "password"}
              placeholder="Enter new password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full pr-11 px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-gray-400"
            />
            <button
              type="button"
              aria-label="Toggle new password visibility"
              onClick={() => setShowNew((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-600 transition-colors"
            >
              {showNew ? <FiEyeOff className="w-4 h-4" /> : <FiEye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">
            Confirm New Password
          </label>
          <div className="relative">
            <input
              type={showConfirm ? "text" : "password"}
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full pr-11 px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-gray-400"
            />
            <button
              type="button"
              aria-label="Toggle confirm password visibility"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-600 transition-colors"
            >
              {showConfirm ? <FiEyeOff className="w-4 h-4" /> : <FiEye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="pt-2">
          <button
            onClick={handleUpdatePassword}
            disabled={!canUpdatePassword}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-60 disabled:hover:bg-blue-600"
          >
            {updatingPassword ? "Updating..." : "Update Password"}
          </button>
        </div>
      </div>

      <div className="border-t border-gray-100 my-8"></div>

      {/* Login Activity */}
      <div>
        <h3 className="text-base font-bold text-gray-900 mb-1">Login Activity</h3>
        <p className="text-sm text-gray-500 mb-6">
          Your 10 most recent sign-in attempts. The top row is your current session.
        </p>

        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-left text-sm text-gray-500">
            <thead className="bg-gray-50 text-gray-700 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 font-medium">Device / Browser</th>
                <th className="px-4 py-3 font-medium">IP Address</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr className="bg-white"><td className="px-4 py-4" colSpan={5}>Loading…</td></tr>
              ) : activity.length === 0 ? (
                <tr className="bg-white"><td className="px-4 py-4" colSpan={5}>No sign-in activity recorded yet.</td></tr>
              ) : (
                activity.map((log) => (
                  <tr key={log.id} className="bg-white hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{log.device}</td>
                    <td className="px-4 py-3">{log.ip}</td>
                    <td className="px-4 py-3">{log.location}</td>
                    <td className="px-4 py-3">{formatTime(log.time)}</td>
                    <td className="px-4 py-3">
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
    </>
  );
};
