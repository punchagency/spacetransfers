import {
  FiCalendar,
  FiClock,
  FiCamera,
} from "react-icons/fi";
import { BsBoxSeam } from "react-icons/bs";
import { MdOutlineVerified, MdOutlineVerifiedUser } from "react-icons/md";
import { PrinterProfile } from "../../types/profile";
import { apiFetch, getApiBaseUrl } from "../../utils/api";
import { toast } from "react-hot-toast";
import { useState, useEffect } from "react";
import { useProfileStore } from "../../state/ProfileStore";
import { UserAvatar } from "../common/UserAvatar";

interface ProfileHeaderProps {
  profile: PrinterProfile;
  onUpdate: () => void;
}

export const ProfileHeader = ({ profile, onUpdate }: ProfileHeaderProps) => {
  const [uploading, setUploading] = useState(false);
  const { setAvatarUrl } = useProfileStore();

  const memberSinceDate = new Date(profile.memberSince);
  const memberSinceStr = memberSinceDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const isVerified = Boolean(profile.verificationStatus?.email);

  const hours = profile.performance?.averageProductionHours ?? null;
  const productionLabel =
    hours === null ? "No data yet" : hours < 24 ? `${hours} hrs` : `${(hours / 24).toFixed(1)} days`;
  const sampleNote =
    profile.performance?.sampleSize
      ? `Across ${profile.performance.sampleSize} shipped job${profile.performance.sampleSize === 1 ? "" : "s"}`
      : "Starts once you have shipped a job";

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", "avatar");

    try {
      setUploading(true);
      await apiFetch("/printer/profile/upload", {
        method: "POST",
        body: formData,
      });
      toast.success("Profile photo updated");
      onUpdate();
    } catch (error: any) {
      toast.error(error.message || "Failed to upload photo");
    } finally {
      setUploading(false);
    }
  };

  const avatarUrl = profile.avatarUrl
    ? (profile.avatarUrl.startsWith("http") ? profile.avatarUrl : `${getApiBaseUrl().replace("/api", "")}${profile.avatarUrl}`)
    : null;

  useEffect(() => {
    if (profile.avatarUrl) {
      setAvatarUrl(profile.avatarUrl.startsWith("http")
        ? profile.avatarUrl
        : `${getApiBaseUrl().replace("/api", "")}${profile.avatarUrl}`
      );
    }
  }, [profile.avatarUrl]);

  return (
    <div className="relative overflow-hidden bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] rounded-2xl px-6 py-5 md:px-8 md:py-6 flex items-center shadow-md text-white">
      <div className="flex items-center gap-6">
        <div className="relative group w-24 h-24 rounded-2xl overflow-hidden shadow-lg bg-gray-200 flex-shrink-0">
          <UserAvatar
            src={avatarUrl}
            alt="Profile avatar"
            className="w-full h-full rounded-2xl"
            iconClassName="w-10 h-10"
          />
          <label className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
            <input 
              type="file" 
              className="hidden" 
              accept="image/*" 
              onChange={handleAvatarUpload}
              disabled={uploading}
            />
            <FiCamera className="w-6 h-6 text-white" />
          </label>
          {uploading && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          <div className="absolute inset-0 rounded-2xl border-4 border-white/20 pointer-events-none" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold leading-tight">{profile.businessName}</h2>
            {isVerified ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 border border-emerald-500/30 backdrop-blur text-emerald-50">
                <MdOutlineVerified className="w-3.5 h-3.5" />
                Verified
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 border border-amber-500/30 backdrop-blur text-amber-50">
                <MdOutlineVerifiedUser className="w-3.5 h-3.5" />
                Not Verified
              </span>
            )}
          </div>
          <p className="text-sm text-blue-100 mt-1">
            {profile.name} · {profile.businessDetails?.businessType || "Printer Partner"}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-8 md:gap-40 text-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white/90">
                <BsBoxSeam className="w-5 h-5" />
              </div>
              <div>
                <div className="text-lg font-semibold leading-tight">{profile.totalJobs || 0}</div>
                <div className="text-xs text-blue-100 mt-0.5">Total Jobs</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white/90">
                <FiClock className="w-5 h-5" />
              </div>
              <div title={sampleNote}>
                <div className="text-lg font-semibold leading-tight">
                  {productionLabel}
                </div>
                <div className="text-xs text-blue-100 mt-0.5">
                  Avg. Production Time
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white/90">
                <FiCalendar className="w-5 h-5" />
              </div>
              <div>
                <div className="text-lg font-semibold leading-tight">
                  {memberSinceStr}
                </div>
                <div className="text-xs text-blue-100 mt-0.5">Member Since</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute -top-52 -right-32 w-[320px] h-[320px] bg-[#4A7CFF] border-white/20 rounded-full opacity-50" />
    </div>
  );
};
 