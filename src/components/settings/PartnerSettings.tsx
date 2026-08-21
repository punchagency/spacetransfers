import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { apiFetch } from "../../utils/api";

/**
 * Partner job-assignment rules.
 *
 * Bound to `GET/PATCH /admin/settings/partner-assignment`. Two changes from the
 * previous static mockup:
 *
 *  - The "Price-Based" rule is gone. The server validates `assignmentRule`
 *    against `["nearest-region", "manual"]` and 400s anything else, so offering
 *    it could only ever produce an error.
 *  - The "Partner Onboarding Requirements" checklist is gone. It had no server
 *    counterpart at all — nothing read it and nothing stored it.
 */

type AssignmentRule = "nearest-region" | "manual";

const RULES: Array<{ id: AssignmentRule; label: string; desc: string }> = [
  {
    id: "nearest-region",
    label: "Nearest Region",
    desc: "Auto-assign to the closest available partner in the customer's region",
  },
  {
    id: "manual",
    label: "Manual Assignment",
    desc: "Leave every order unassigned for an admin to assign by hand",
  },
];

export const PartnerSettings = () => {
  const [assignmentRule, setAssignmentRule] = useState<AssignmentRule>("nearest-region");
  const [maxJobsEnabled, setMaxJobsEnabled] = useState(true);
  const [maxJobsValue, setMaxJobsValue] = useState("10");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch("/admin/settings/partner-assignment");
        if (cancelled) return;
        setAssignmentRule(data?.assignmentRule === "manual" ? "manual" : "nearest-region");
        setMaxJobsEnabled(data?.maxJobsEnabled !== false);
        setMaxJobsValue(String(data?.maxJobsValue ?? 10));
      } catch (error: any) {
        if (!cancelled) toast.error(error.message || "Could not load partner settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleMaxJobsToggle = () => {
    if (maxJobsEnabled) {
      setMaxJobsValue("");
    } else {
      setMaxJobsValue("10");
    }
    setMaxJobsEnabled(!maxJobsEnabled);
  };

  const handleSave = async () => {
    const parsed = parseInt(maxJobsValue, 10);
    if (maxJobsEnabled && (!Number.isFinite(parsed) || parsed < 1)) {
      toast.error("Maximum jobs must be at least 1.");
      return;
    }

    setSaving(true);
    try {
      const data = await apiFetch("/admin/settings/partner-assignment", {
        method: "PATCH",
        body: JSON.stringify({
          assignmentRule,
          maxJobsEnabled,
          maxJobsValue: maxJobsEnabled ? parsed : null,
        }),
      });
      // Re-seed from the response: the server clamps the value, so showing what
      // it stored keeps the form honest about what actually took effect.
      setMaxJobsValue(String(data?.maxJobsValue ?? ""));
      toast.success("Partner settings saved");
    } catch (error: any) {
      toast.error(error.message || "Could not save partner settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8">
        <h2 className="text-xl font-bold text-gray-900 mb-6">
          Partner Job Assignment
        </h2>

        <div className="space-y-6">
          <div className="space-y-4">
            <label className="text-sm font-medium text-gray-700">
              Default Job Assignment Rule
            </label>

            <div className="space-y-3">
              {RULES.map((rule) => (
                <label
                  key={rule.id}
                  className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
                    assignmentRule === rule.id
                      ? "border-blue-600 bg-blue-50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center h-5">
                    <input
                      type="radio"
                      name="assignment-rule"
                      checked={assignmentRule === rule.id}
                      disabled={loading}
                      onChange={() => setAssignmentRule(rule.id)}
                      className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                    />
                  </div>
                  <div className="ml-3 text-sm">
                    <span className="block font-medium text-gray-900">{rule.label}</span>
                    <span className="block text-gray-500 mt-0.5">{rule.desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-gray-900">
                  Maximum Jobs Per Partner
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Limit concurrent jobs per partner to manage capacity
                </p>
              </div>
              <button
                type="button"
                aria-pressed={maxJobsEnabled}
                onClick={handleMaxJobsToggle}
                disabled={loading}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
                  maxJobsEnabled ? "bg-blue-600" : "bg-gray-200"
                }`}
              >
                <span
                  className={`${
                    maxJobsEnabled ? "translate-x-6" : "translate-x-1"
                  } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                />
              </button>
            </div>
            <div className="mt-4">
              <input
                type="number"
                min="1"
                value={maxJobsValue}
                onChange={(e) => setMaxJobsValue(e.target.value)}
                disabled={!maxJobsEnabled || loading}
                className={`w-24 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all ${
                  !maxJobsEnabled ? "opacity-50 cursor-not-allowed" : ""
                }`}
              />
              <p className="text-sm text-gray-500 mt-2">
                A partner at this limit is auto-paused and receives no new
                auto-assigned jobs until one completes. Per-partner overrides
                set on a partner's own page take precedence when stricter.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={loading || saving}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
};
