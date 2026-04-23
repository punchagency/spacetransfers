import { useState } from "react";
import { ProfileHeader } from "../components/profile/ProfileHeader";
import { ProfileOverview } from "../components/profile/ProfileOverview";
import { ProfileBusinessInfo } from "../components/profile/ProfileBusinessInfo";
import type { ProfileTabId } from "../types/profile";

const Profile = () => {
  const [activeTab, setActiveTab] = useState<ProfileTabId>("overview");

  return (
    <div className="flex flex-col gap-8">
      <div className="sticky top-0 z-20 bg-gray-50 -mx-6 -mt-6 px-6 pt-6 pb-4 border-b border-gray-200">
        <h1 className="text-3xl font-bold text-gray-900">Profile</h1>
        <p className="text-gray-500 mt-1">
          Manage your account information and business details
        </p>
      </div>

      <ProfileHeader />

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

      {activeTab === "overview" && <ProfileOverview />}

      {activeTab === "business" && <ProfileBusinessInfo />}
    </div>
  );
};

export default Profile;
