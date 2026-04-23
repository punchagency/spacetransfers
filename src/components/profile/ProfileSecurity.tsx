import { useEffect, useMemo, useState } from "react";
import { FiEye, FiEyeOff } from "react-icons/fi";
import toast from "react-hot-toast";
import { apiFetch } from "../../utils/api";

export const ProfileSecurity = () => {
  const [loading, setLoading] = useState(true);
  const [lastPasswordChange, setLastPasswordChange] = useState<Date | null>(
    null
  );
  const [sessionLocation, setSessionLocation] = useState<{
    ip?: string;
    city?: string;
    region?: string;
    country?: string;
  } | null>(null);

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
        const res = await apiFetch("/admin/settings/security");
        setLastPasswordChange(res.lastPasswordChange ? new Date(res.lastPasswordChange) : null);

        try {
          const geoRes = await fetch("https://ipapi.co/json/");
          if (geoRes.ok) {
            const geo = await geoRes.json();
            setSessionLocation({
              ip: geo.ip,
              city: geo.city,
              region: geo.region,
              country: geo.country_name || geo.country,
            });
          } else {
            setSessionLocation(null);
          }
        } catch {
          setSessionLocation(null);
        }
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

  const handleUpdatePassword = async () => {
    if (!canUpdatePassword) return;
    setUpdatingPassword(true);
    try {
      await apiFetch("/admin/profile/password", {
        method: "PATCH",
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      toast.success("Password updated");
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

      {/* Change Password */}
      <div className="space-y-6">
        <div>
          <h3 className="text-base font-bold text-gray-900">Change Password</h3>
          {lastPasswordChange && (
            <div className="text-xs text-gray-400 mt-1">
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
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 transition-colors"
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
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 transition-colors"
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
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 transition-colors"
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

      {/* Active Sessions */}
      <div>
        <h3 className="text-base font-bold text-gray-900 mb-6">
          Active Sessions
        </h3>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <div className="font-medium text-gray-900 text-sm">
                Current Session
              </div>
              <div className="text-sm text-gray-500 mt-0.5">This device</div>
              <div className="text-xs text-gray-400 mt-1">
                Location:{" "}
                {sessionLocation?.city || sessionLocation?.region || sessionLocation?.country
                  ? `${[sessionLocation.city, sessionLocation.region, sessionLocation.country].filter(Boolean).join(", ")}`
                  : "Unknown"}
                {sessionLocation?.ip ? ` • IP: ${sessionLocation.ip}` : ""}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Last activity: Just now
              </div>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
              Active
            </span>
          </div>

          <button
            onClick={() => {
              localStorage.removeItem("admin_token");
              localStorage.removeItem("admin_user");
              window.location.href = "/auth";
            }}
            className="w-full flex items-center justify-center px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Sign Out of This Session
          </button>
        </div>
      </div>
    </>
  );
};
