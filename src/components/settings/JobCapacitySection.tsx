import { useState } from "react";
import { FiSettings } from "react-icons/fi";
import { Toggle } from "../common/Toggle";
import { apiFetch } from "../../utils/api";
import toast from "react-hot-toast";

const JobCapacitySection = ({ autoAcceptInitial }: { autoAcceptInitial: boolean }) => {
  const [autoAccept, setAutoAccept] = useState(autoAcceptInitial);
  const [saving, setSaving] = useState(false);

  const handleToggle = async (next: boolean) => {
    setAutoAccept(next);
    setSaving(true);
    try {
      await apiFetch("/printer/settings", {
        method: "PATCH",
        body: JSON.stringify({ jobCapacity: { autoAccept: next } }),
      });
      toast.success(
        next
          ? "Auto-Accept enabled — eligible jobs will be assigned automatically"
          : "Auto-Accept disabled — you will receive jobs only when you enable it again"
      );
    } catch (err: any) {
      setAutoAccept(!next); // revert on error
      toast.error(err.message || "Failed to save setting");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <FiSettings className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Job Capacity</h2>
            <p className="text-xs text-gray-500">Configure automatic job assignment behaviour</p>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-5 mt-1">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-800">Auto-Accept Jobs</div>
            <p className="text-xs text-gray-500 mt-1">
              {autoAccept
                ? "Jobs are automatically assigned to you when you are within your business hours and have capacity"
                : "No jobs will be auto-assigned. You must manually enable this to receive new jobs"}
            </p>
          </div>
          <div className="relative">
              <Toggle enabled={autoAccept} setEnabled={handleToggle} />
              {saving && (
                <span className="absolute -bottom-4 right-0 text-[10px] text-gray-400 whitespace-nowrap">
                  Saving…
                </span>
              )}
            </div>
        </div>

        <div
          className={`mt-4 rounded-xl px-4 py-3 border text-xs font-medium ${
            autoAccept
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-orange-50 border-orange-200 text-orange-700"
          }`}
        >
          {autoAccept ? (
            <>
              <span className="font-bold">Auto-Accept ON</span> — The system will automatically assign eligible jobs to
              you during your business hours. Jobs are matched by proximity and capacity.
            </>
          ) : (
            <>
              <span className="font-bold">Auto-Accept OFF</span> — You will not receive any new auto-assigned jobs
              until this setting is turned back on. Jobs currently in progress are not affected.
            </>
          )}
        </div>
      </div>
    </section>
  );
};

export default JobCapacitySection;
