import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { apiFetch } from "../../utils/api";

type AssignmentRule = "nearest-region" | "manual";

const RULES: Array<{ id: AssignmentRule; label: string; desc: string }> = [
  {
    id: "nearest-region",
    label: "Nearest Region",
    desc: "Auto-assign to an available partner in the customer's region: one in the customer's own state first, otherwise the nearest. If none is free, falls back to a neighbouring region — flagged on the order and notified to admins. Orders still waiting for a partner are retried every few minutes.",
  },
  {
    id: "manual",
    label: "Manual Assignment",
    desc: "Never auto-assign. Every order waits for an admin to place it by hand.",
  },
];

export const PartnerSettings = () => {
  const [assignmentRule, setAssignmentRule] = useState<AssignmentRule>("nearest-region");
  const [maxJobsEnabled, setMaxJobsEnabled] = useState(true);
  const [maxJobsValue, setMaxJobsValue] = useState("10");
  const lastMaxJobsValue = useRef("10");
  /**
   * Deadlines per stage, per priority.
   *
   * Held as strings because they are text inputs — parsing on save keeps a
   * half-typed "1" from being read as a one-hour window mid-keystroke.
   */
  const [slaEnabled, setSlaEnabled] = useState(false);
  const [sla, setSla] = useState({
    acceptNormal: "24",
    acceptUrgent: "4",
    printNormal: "48",
    printUrgent: "12",
    maxReassignments: "2",
  });
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
        // The server keeps the number even while the limit is off, so it is
        // what switching back on should restore.
        const storedMax = String(data?.maxJobsValue ?? 10);
        lastMaxJobsValue.current = storedMax;
        setMaxJobsValue(data?.maxJobsEnabled === false ? "" : storedMax);
        setSlaEnabled(data?.sla?.enabled === true);
        setSla({
          acceptNormal: String(data?.sla?.acceptHours?.normal ?? 24),
          acceptUrgent: String(data?.sla?.acceptHours?.urgent ?? 4),
          printNormal: String(data?.sla?.printHours?.normal ?? 48),
          printUrgent: String(data?.sla?.printHours?.urgent ?? 12),
          maxReassignments: String(data?.sla?.maxAutoReassignments ?? 2),
        });
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
      if (maxJobsValue.trim()) lastMaxJobsValue.current = maxJobsValue.trim();
      setMaxJobsValue("");
    } else {
      setMaxJobsValue(lastMaxJobsValue.current || "10");
    }
    setMaxJobsEnabled(!maxJobsEnabled);
  };

  const handleSave = async () => {
    const parsed = parseInt(maxJobsValue, 10);
    if (maxJobsEnabled && (!Number.isFinite(parsed) || parsed < 1)) {
      toast.error("Maximum jobs must be at least 1.");
      return;
    }

    const hours = {
      acceptNormal: Number(sla.acceptNormal),
      acceptUrgent: Number(sla.acceptUrgent),
      printNormal: Number(sla.printNormal),
      printUrgent: Number(sla.printUrgent),
    };
    // Only blocked when the monitor is actually on: an operator should be able
    // to leave the fields half-filled while it is switched off.
    if (slaEnabled && Object.values(hours).some((h) => !Number.isFinite(h) || h <= 0)) {
      toast.error("Every deadline must be a number of hours greater than zero.");
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
          sla: {
            enabled: slaEnabled,
            acceptHours: { normal: hours.acceptNormal, urgent: hours.acceptUrgent },
            printHours: { normal: hours.printNormal, urgent: hours.printUrgent },
            maxAutoReassignments: Number(sla.maxReassignments),
          },
        }),
      });
      /*
       * Re-seed from the response: the server clamps the value, so showing what
       * it stored keeps the form honest about what actually took effect. While
       * the limit is off the field stays empty, but the stored number is
       * remembered for when it is switched back on.
       */
      if (data?.maxJobsValue) lastMaxJobsValue.current = String(data.maxJobsValue);
      setMaxJobsValue(maxJobsEnabled ? String(data?.maxJobsValue ?? "") : "");
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
                onChange={(e) => {
                  setMaxJobsValue(e.target.value);
                  if (e.target.value.trim()) lastMaxJobsValue.current = e.target.value.trim();
                }}
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

      {/*
        There has been an SLA in the codebase all along — a flat 24 hours,
        computed at assignment and shown to the partner as a countdown, that
        nothing ever read back. A clock with no consequence, running at one
        speed for a rush job and a normal one.
      */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Deadlines</h2>
        <p className="text-sm text-gray-500 mb-6">
          Acts on jobs that stall. Off unless you turn it on — it moves live work between
          partners.
        </p>

        <div className="flex items-center justify-between pb-6 border-b border-gray-100">
          <div className="pr-6">
            <p className="text-sm font-medium text-gray-900">Enforce deadlines</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Checks every 15 minutes. While off, nothing is moved or alerted.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSlaEnabled((v) => !v)}
            disabled={loading}
            aria-pressed={slaEnabled}
            aria-label="Enforce deadlines"
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              slaEnabled ? "bg-blue-600" : "bg-gray-200"
            }`}
          >
            <span
              className={`${
                slaEnabled ? "translate-x-6" : "translate-x-1"
              } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
            />
          </button>
        </div>

        {/*
          The section is not dimmed as a whole. Greying the labels and guidance
          made the part you need to *read* before switching it on the hardest
          part to read. Only the inputs dim, matching the Maximum Jobs field
          above.
        */}
        <div className="mt-6 space-y-6">
              <div>
                <p className="text-sm font-medium text-gray-900">Not started — hours allowed</p>
                <p className="text-xs text-gray-500 mt-0.5 mb-3">How long a partner has to move a job from Assigned to Printing. Past this, it goes back to the queue and to a different partner.</p>
                <div className="grid grid-cols-2 gap-4 max-w-sm">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-600">Normal</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={sla.acceptNormal}
                        onChange={(e) => setSla((s) => ({ ...s, acceptNormal: e.target.value }))}
                        disabled={loading || !slaEnabled}
                        className={`w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${
                          !slaEnabled ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-600">Urgent</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={sla.acceptUrgent}
                        onChange={(e) => setSla((s) => ({ ...s, acceptUrgent: e.target.value }))}
                        disabled={loading || !slaEnabled}
                        className={`w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${
                          !slaEnabled ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                      />
                    </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-900">On the press — hours allowed</p>
                <p className="text-xs text-gray-500 mt-0.5 mb-3">How long a job may sit in Printing. Past this an admin is alerted — it is never reassigned, because the partner may already have film loaded.</p>
                <div className="grid grid-cols-2 gap-4 max-w-sm">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-600">Normal</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={sla.printNormal}
                        onChange={(e) => setSla((s) => ({ ...s, printNormal: e.target.value }))}
                        disabled={loading || !slaEnabled}
                        className={`w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${
                          !slaEnabled ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-600">Urgent</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={sla.printUrgent}
                        onChange={(e) => setSla((s) => ({ ...s, printUrgent: e.target.value }))}
                        disabled={loading || !slaEnabled}
                        className={`w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${
                          !slaEnabled ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                      />
                    </div>
                </div>
              </div>

          <div>
            <p className="text-sm font-medium text-gray-900">Reassignment limit</p>
            <p className="text-xs text-gray-500 mt-0.5 mb-3">
              How many times one order may be moved before an admin is alerted instead.
              Stops a job nobody wants circling the network. Set to 0 to alert without ever
              moving work.
            </p>
            <input
              type="number"
              min="0"
              step="1"
              value={sla.maxReassignments}
              onChange={(e) => setSla((s) => ({ ...s, maxReassignments: e.target.value }))}
              disabled={loading || !slaEnabled}
              className={`w-24 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${
                !slaEnabled ? "opacity-50 cursor-not-allowed" : ""
              }`}
            />
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
