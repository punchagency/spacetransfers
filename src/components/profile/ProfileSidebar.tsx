import { FiUser, FiShield, FiSettings, FiChevronRight } from "react-icons/fi";

interface ProfileSidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const ProfileSidebar = ({
  activeTab,
  setActiveTab,
}: ProfileSidebarProps) => {
  return (
    <div className="w-full lg:w-64 flex-shrink-0 lg:sticky lg:top-6 lg:h-fit">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-900">Profile</h2>
        <p className="text-xs text-gray-500 mt-1 mb-6">
          You can find all settings here.
        </p>

        <nav className="space-y-1">
          <button
            onClick={() => setActiveTab("profile")}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "profile"
                ? "bg-blue-50 text-blue-600"
                : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            <div className="flex items-center gap-3">
              <FiUser className="w-4 h-4" />
              <span>My Profile</span>
            </div>
            {activeTab === "profile" && <FiChevronRight className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setActiveTab("security")}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "security"
                ? "bg-blue-50 text-blue-600"
                : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            <div className="flex items-center gap-3">
              <FiShield className="w-4 h-4" />
              <span>Security Options</span>
            </div>
            {activeTab === "security" && <FiChevronRight className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setActiveTab("preferences")}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "preferences"
                ? "bg-blue-50 text-blue-600"
                : "text-gray-700 hover:bg-gray-50"
            }`} 
          >
            <div className="flex items-center gap-3">
              <FiSettings className="w-4 h-4" />
              <span>Preferences</span>
            </div>
            {activeTab === "preferences" && (
              <FiChevronRight className="w-4 h-4" />
            )}
          </button>
        </nav>
      </div>
    </div>
  );
};
