import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { apiFetch } from "../../../utils/api";

export const ProductionNotes = ({ jobId, initialNotes }: { jobId: string; initialNotes: string }) => {
  const [notes, setNotes] = useState(initialNotes || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNotes(initialNotes || "");
  }, [initialNotes]);

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/printer/jobs/${encodeURIComponent(jobId)}/notes`, {
        method: "PATCH",
        body: JSON.stringify({ notes }),
      });
      toast.success("Notes saved");
    } catch (e: any) {
      toast.error(e?.message || "Failed to save notes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
      <h3 className="text-base font-bold text-gray-900 mb-1">
        Production Notes
      </h3>
      {/* Saved on the order and read only here — not by the customer or the admin. */}
      <p className="text-[11px] text-gray-500 mb-3">Only you can see these notes.</p>
      <div className="mb-3">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add production notes or special instructions…"
          className="w-full h-28 p-2.5 text-xs rounded-lg border border-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="px-3 py-1 bg-blue-50 text-blue-600 text-xs font-medium rounded-md hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save Notes"}
          </button>
        </div>
      </div>
    </div>
  );
};
