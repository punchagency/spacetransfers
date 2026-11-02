import { useState } from "react";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import { ProfileSidebar } from "../components/profile/ProfileSidebar";
import { ProfileInfo } from "../components/profile/ProfileInfo";
import { ProfilePreferences } from "../components/profile/ProfilePreferences";
import { ProfileSecurity } from "../components/profile/ProfileSecurity";

export const Profile = () => {
  const [activeTab, setActiveTab] = useState("security");

  return (
    <DashboardLayout>
      <div className="flex flex-col lg:flex-row gap-6 font-sans">
        {/* Sidebar */}
        <ProfileSidebar activeTab={activeTab} setActiveTab={setActiveTab} />

        {/* Main Content */}
        <div className="flex-1">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
            {activeTab === "profile" && <ProfileInfo />}
            {activeTab === "preferences" && <ProfilePreferences />}
            {activeTab === "security" && <ProfileSecurity />}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};
