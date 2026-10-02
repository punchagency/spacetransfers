import { useEffect, useMemo, useState } from "react";
import { FiCamera, FiSave, FiUser } from "react-icons/fi";
import toast from "react-hot-toast";
import { apiFetch } from "../../utils/api";
import { getUser, getToken, setAuth } from "../../utils/auth";

export const ProfileInfo = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [initial, setInitial] = useState<{
    name: string;
    email: string;
    phone: string;
    avatarUrl: string;
  } | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const profile = await apiFetch("/admin/profile");

        const fullName = String(profile.name || "");
        const parts = fullName.trim().split(/\s+/).filter(Boolean);
        const first = parts[0] || "";
        const last = parts.slice(1).join(" ");

        setFirstName(first);
        setLastName(last);
        setEmail(String(profile.email || ""));
        setPhone(String(profile.phone || ""));
        setAvatarUrl(String(profile.avatarUrl || ""));
        setInitial({
          name: fullName,
          email: String(profile.email || ""),
          phone: String(profile.phone || ""),
          avatarUrl: String(profile.avatarUrl || ""),
        });
      } catch (error: any) {
        toast.error(error.message || "Failed to load profile");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const fullName = useMemo(() => {
    return `${firstName} ${lastName}`.trim();
  }, [firstName, lastName]);

  const isDirty = useMemo(() => {
    if (!initial) return false;
    return (
      fullName !== initial.name ||
      email !== initial.email ||
      phone !== initial.phone ||
      avatarUrl !== initial.avatarUrl
    );
  }, [
    initial,
    fullName,
    email,
    phone,
    avatarUrl,
  ]);

  const canSave = !loading && isDirty && !saving && !!fullName && !!email.trim();

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await apiFetch("/admin/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: fullName,
          email,
          phone: phone || null,
          avatarUrl: avatarUrl || null,
        }),
      });
      toast.success("Profile updated");
      setInitial({
        name: fullName,
        email,
        phone,
        avatarUrl,
      });

      // The save has succeeded; refreshing the cached copy must not turn that
      // into a reported failure if storage is blocked or holds a bad value.
      try {
        const stored = localStorage.getItem("admin_user");
        const parsed = stored ? JSON.parse(stored) : {};
        localStorage.setItem(
          "admin_user",
          JSON.stringify({ ...parsed, name: fullName, email, avatarUrl: avatarUrl || null })
        );
      } catch {
        /* the next sign-in refreshes it */
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be 2MB or less");
      return;
    }

    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append("file", file);

      const res = await apiFetch("/admin/profile/upload", {
        method: "POST",
        body: form,
      });

      const url = String(res?.avatarUrl || "");
      if (!url) throw new Error("Upload succeeded but no image URL was returned");

      setAvatarUrl(url);
      setInitial((prev) => (prev ? { ...prev, avatarUrl: url } : prev));

      // setAuth rather than a bare localStorage write: it notifies subscribers,
      // so the header avatar updates immediately instead of staying stale until
      // the next full page load.
      const current = getUser() || {};
      setAuth(getToken() || "", { ...current, avatarUrl: url });

      toast.success("Profile picture updated");
    } catch (error: any) {
      toast.error(error.message || "Failed to upload profile picture");
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-gray-100 pb-8">
        <div>
          <h1 className="text-lg font-bold text-gray-900">
            Profile Information
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Update your account's profile information.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-60 disabled:hover:bg-blue-600"
        >
          <FiSave className="w-4 h-4" />
          <span>{saving ? "Saving..." : "Save"}</span>
        </button>
      </div>

      {/* Avatar Section */}
      <div className="mt-8 flex items-center gap-5">
        <div className="relative">
          <input
            data-testid="profile-avatar-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleAvatarFile(file);
              e.currentTarget.value = "";
            }}
            id="admin-profile-avatar"
          />
          <button
            type="button"
            aria-label="Upload profile picture"
            className="relative block rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            onClick={() => {
              const el = document.getElementById("admin-profile-avatar") as HTMLInputElement | null;
              el?.click();
            }}
            disabled={loading || uploadingAvatar}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="avatar"
                className={`w-20 h-20 rounded-full object-cover border border-gray-200 ${uploadingAvatar ? "opacity-60" : ""}`}
              />
            ) : (
              <div className={`w-20 h-20 rounded-full bg-blue-600 flex items-center justify-center text-white text-3xl ${uploadingAvatar ? "opacity-60" : ""}`}>
                <FiUser />
              </div>
            )}
            <div className="absolute bottom-0 right-0 p-1.5 bg-white rounded-full border border-gray-200 shadow-sm text-gray-600">
              <FiCamera className="w-3.5 h-3.5" />
            </div>
          </button>
        </div>
        <div>
          <h3 className="text-base font-bold text-gray-900">{fullName || "Admin"}</h3>
          <div className="mt-1">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-600">
              Admin
            </span>
          </div>
        </div>
      </div>

      {/* Personal Details */}
      <div className="mt-10">
        <h3 className="text-base font-bold text-gray-900 mb-6">
          Personal Details
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              First Name
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              Last Name
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
        </div>
      </div>
    </>
  );
};
