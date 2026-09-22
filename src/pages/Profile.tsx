import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { ProfileHeader } from "../components/profile/ProfileHeader";
import { ProfileOverview } from "../components/profile/ProfileOverview";
import { ProfileBusinessInfo } from "../components/profile/ProfileBusinessInfo";
import type { ProfileTabId, PrinterProfile } from "../types/profile";
import { apiFetch } from "../utils/api";
import { SpaceLoader } from "../components/common/SpaceLoader";
import { toast } from "react-hot-toast";
import { useNotificationsStore } from "../state/NotificationsStore";

const Profile = () => {
  const [activeTab, setActiveTab] = useState<ProfileTabId>("overview");
  const [profile, setProfile] = useState<PrinterProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // Why the profile didn't load, so the page can say so instead of "not found".
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const { notifications } = useNotificationsStore();

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const data = await apiFetch("/printer/profile");
      setProfile(data);
      setLoadError(null);
    } catch (error: any) {
      setLoadError(error.message || "Failed to fetch profile");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  // Show success toast + refetch when returning from email verification link
  useEffect(() => {
    if (searchParams.get("emailVerified") === "1") {
      setSearchParams({}, { replace: true });
      toast.success("Email verified successfully!");
      fetchProfile();
    }
  }, []);

  // Real-time: refetch when the SSE system pushes an email_verified notification
  useEffect(() => {
    const latest = notifications[0];
    if (latest?.meta?.type === "email_verified" && !latest.readAt) {
      fetchProfile();
    }
  }, [notifications]);

  return (
    <div className="flex flex-col gap-8">
      <div className="sticky top-0 z-20 bg-gray-50 -mx-6 -mt-6 px-6 pt-6 pb-4 border-b border-gray-200">
        <h1 className="text-3xl font-bold text-gray-900">Profile</h1>
        <p className="text-gray-500 mt-1">
          Manage your account information and business details
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <SpaceLoader />
        </div>
      ) : !profile ? (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          {/* It exists — it just didn't load. "Profile not found" said otherwise. */}
          <p className="text-gray-900 font-semibold">Your profile couldn't be loaded</p>
          {loadError && <p className="text-gray-500 text-sm mt-1 max-w-md text-center">{loadError}</p>}
          <button
            onClick={fetchProfile}
            className="mt-4 text-blue-600 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <ProfileHeader profile={profile} onUpdate={fetchProfile} />

          <div className="border-b border-gray-200 flex items-center gap-6">
            <button
              onClick={() => setActiveTab("overview")}
              className={`pb-3 text-sm font-medium ${
                activeTab === "overview"
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab("business")}
              className={`pb-3 text-sm font-medium ${
                activeTab === "business"
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Business Info
            </button>
          </div>

          {activeTab === "overview" && (
            <ProfileOverview profile={profile} onUpdate={fetchProfile} />
          )}

          {activeTab === "business" && (
            <ProfileBusinessInfo profile={profile} onUpdate={fetchProfile} />
          )}
        </>
      )}
    </div>
  );
};

export default Profile;
