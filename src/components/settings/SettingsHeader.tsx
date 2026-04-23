import { FiSave } from "react-icons/fi";

const SettingsHeader = () => {
  return (
    <div className="flex items-center justify-between sticky top-0 z-20 bg-gray-50 -mx-6 -mt-6 px-6 pt-6 pb-4 border-b border-gray-200">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">
          Manage your partner profile and preferences
        </p>
      </div>
      <button className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-sm hover:bg-blue-700 transition-colors">
        <FiSave className="w-4 h-4" />
        <span>Save Changes</span>
      </button>
    </div>
  );
};

export default SettingsHeader;

