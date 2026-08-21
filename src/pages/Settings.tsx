import { useState } from "react";
import { DashboardLayout } from "../components/layout/DashboardLayout";
import { GeneralSettings } from "../components/settings/GeneralSettings";
import { PartnerSettings } from "../components/settings/PartnerSettings";
import { NotificationSettings } from "../components/settings/NotificationSettings";
import { SecuritySettings } from "../components/settings/SecuritySettings";

export const Settings = () => {
  const [activeTab, setActiveTab] = useState("General");

  const tabs = [
    { name: "General", label: "General" },
    { name: "Partner Settings", label: "Partner Settings" },
    { name: "Notifications", label: "Notifications" },
    { name: "Security", label: "Security" },
  ];

  return (
    <DashboardLayout>
      <div className="font-sans max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500 mt-1">
            Manage your DTF fulfillment platform configuration and preferences
          </p>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-8">
          <nav className="-mb-px flex justify-center space-x-32">
            {tabs.map((tab) => (
              <button
                key={tab.name}
                onClick={() => setActiveTab(tab.name)}
                className={`
                  whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${
                    activeTab === tab.name
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }
                `}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        {activeTab === "General" && <GeneralSettings />}
        {activeTab === "Partner Settings" && <PartnerSettings />}
        {activeTab === "Notifications" && <NotificationSettings />}
        {activeTab === "Security" && <SecuritySettings />}
      </div>
    </DashboardLayout>
  );
};
