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
  const [bio, setBio] = useState("");
  const [gender, setGender] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [taxId, setTaxId] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateProv, setStateProv] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [initial, setInitial] = useState<{
    name: string;
    email: string;
    phone: string;
    avatarUrl: string;
    bio: string;
    gender: string;
    dateOfBirth: string;
    nationalId: string;
    taxId: string;
    address: {
      street: string;
      city: string;
      state: string;
      postalCode: string;
      country: string;
    };
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
        setBio(String(profile.profile?.bio || ""));
        setGender(String(profile.profile?.gender || ""));
        setDateOfBirth(String(profile.profile?.dateOfBirth || ""));
        setNationalId(String(profile.profile?.nationalId || ""));
        setTaxId(String(profile.profile?.taxId || ""));
        setStreet(String(profile.address?.street || ""));
        setCity(String(profile.address?.city || ""));
        setStateProv(String(profile.address?.state || ""));
        setPostalCode(String(profile.address?.postalCode || ""));
        setCountry(String(profile.address?.country || ""));
        setInitial({
          name: fullName,
          email: String(profile.email || ""),
          phone: String(profile.phone || ""),
          avatarUrl: String(profile.avatarUrl || ""),
          bio: String(profile.profile?.bio || ""),
          gender: String(profile.profile?.gender || ""),
          dateOfBirth: String(profile.profile?.dateOfBirth || ""),
          nationalId: String(profile.profile?.nationalId || ""),
          taxId: String(profile.profile?.taxId || ""),
          address: {
            street: String(profile.address?.street || ""),
            city: String(profile.address?.city || ""),
            state: String(profile.address?.state || ""),
            postalCode: String(profile.address?.postalCode || ""),
            country: String(profile.address?.country || ""),
          },
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
      avatarUrl !== initial.avatarUrl ||
      bio !== initial.bio ||
      gender !== initial.gender ||
      dateOfBirth !== initial.dateOfBirth ||
      nationalId !== initial.nationalId ||
      taxId !== initial.taxId ||
      street !== initial.address.street ||
      city !== initial.address.city ||
      stateProv !== initial.address.state ||
      postalCode !== initial.address.postalCode ||
      country !== initial.address.country
    );
  }, [
    initial,
    fullName,
    email,
    phone,
    avatarUrl,
    bio,
    gender,
    dateOfBirth,
    nationalId,
    taxId,
    street,
    city,
    stateProv,
    postalCode,
    country,
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
          profile: {
            bio,
            gender,
            dateOfBirth,
            nationalId,
            taxId,
          },
          address: {
            street,
            city,
            state: stateProv,
            postalCode,
            country,
          },
        }),
      });
      toast.success("Profile updated");
      setInitial({
        name: fullName,
        email,
        phone,
        avatarUrl,
        bio,
        gender,
        dateOfBirth,
        nationalId,
        taxId,
        address: { street, city, state: stateProv, postalCode, country },
      });

      const stored = localStorage.getItem("admin_user");
      const parsed = stored ? JSON.parse(stored) : {};
      localStorage.setItem(
        "admin_user",
        JSON.stringify({ ...parsed, name: fullName, email, avatarUrl: avatarUrl || null })
      );
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
      /**
       * Uploaded as a file, not a base64 data URL.
       *
       * This previously read the image with FileReader and PATCHed the whole
       * `data:` URL onto the profile, so the image was stored on the user
       * document — and `authenticate` loads that document on every
       * authenticated request. The server now resizes it, encodes WebP and
       * puts it on Cloudinary, and only the URL is stored.
       */
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

          <div className="md:col-span-2 space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Bio</label>
            <input
              type="text"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <div className="md:col-span-2 space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Gender</label>
            <input
              type="text"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              Date of Birth
            </label>
            <input
              type="text"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              National ID
            </label>
            <input
              type="text"
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="mt-10">
        <h3 className="text-base font-bold text-gray-900 mb-6">Address</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Street</label>
            <input
              type="text"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Country</label>
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">City</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">State</label>
            <input
              type="text"
              value={stateProv}
              onChange={(e) => setStateProv(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              Postal Code
            </label>
            <input
              type="text"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">TAX ID</label>
            <input
              type="text"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
        </div>
      </div>
    </>
  );
};
