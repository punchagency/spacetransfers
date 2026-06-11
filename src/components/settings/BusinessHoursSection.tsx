import { useRef, useState } from "react";
import { FiClock, FiSave, FiRefreshCw, FiAlertCircle } from "react-icons/fi";
import { Toggle } from "../common/Toggle";
import { apiFetch } from "../../utils/api";
import toast from "react-hot-toast";

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type DayKey = (typeof DAY_KEYS)[number];

const DAY_LABELS: Record<DayKey, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

interface DayState {
  isOpen: boolean;
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

type BusinessHoursState = Record<DayKey, DayState>;

const DEFAULT_HOURS: BusinessHoursState = {
  monday:    { isOpen: true,  start: "09:00", end: "18:00" },
  tuesday:   { isOpen: true,  start: "09:00", end: "18:00" },
  wednesday: { isOpen: false, start: "09:00", end: "18:00" },
  thursday:  { isOpen: false, start: "09:00", end: "18:00" },
  friday:    { isOpen: false, start: "09:00", end: "18:00" },
  saturday:  { isOpen: false, start: "09:00", end: "18:00" },
  sunday:    { isOpen: false, start: "09:00", end: "18:00" },
};

/** Convert legacy "9:00am"/"6:00pm" → "HH:MM" 24-hour */
function normalizeTo24h(value: string | undefined): string {
  if (!value) return "09:00";
  if (/^\d{2}:\d{2}$/.test(value)) return value;
  const m = value.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return "09:00";
  let h = parseInt(m[1], 10);
  const min = m[2];
  const mer = m[3].toLowerCase();
  if (mer === "pm" && h !== 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

function validateDay(day: DayState): string | null {
  if (!day.isOpen) return null;
  if (!day.start || !day.end) return "Start and end times are required when the day is open";
  const [sh, sm] = day.start.split(":").map(Number);
  const [eh, em] = day.end.split(":").map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  if (startMins >= endMins) return "End time must be after start time";
  return null;
}

const BusinessHoursSection = ({ initialData }: { initialData: any }) => {
  const [hours, setHours] = useState<BusinessHoursState>(() => {
    const bh = initialData?.businessHours || {};
    const merged: BusinessHoursState = { ...DEFAULT_HOURS };
    for (const day of DAY_KEYS) {
      if (bh[day]) {
        merged[day] = {
          isOpen: !!bh[day].isOpen,
          start: normalizeTo24h(bh[day].start),
          end: normalizeTo24h(bh[day].end),
        };
      }
    }
    return merged;
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<DayKey, string>>>({});
  const hasUnsaved = useRef(false);

  const validate = (): boolean => {
    const newErrors: Partial<Record<DayKey, string>> = {};
    for (const day of DAY_KEYS) {
      const err = validateDay(hours[day]);
      if (err) newErrors[day] = err;
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      toast.error("Fix validation errors before saving");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/printer/settings", {
        method: "PATCH",
        body: JSON.stringify({ businessHours: hours }),
      });
      hasUnsaved.current = false;
      toast.success("Business hours saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const updateDay = (day: DayKey, patch: Partial<DayState>) => {
    hasUnsaved.current = true;
    setHours((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
    // Clear error for that day on any change
    setErrors((prev) => ({ ...prev, [day]: undefined }));
  };

  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <FiClock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Business Hours</h2>
            <p className="text-xs text-gray-500">
              Jobs are only auto-assigned during your open hours
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-60"
        >
          {saving ? (
            <FiRefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <FiSave className="w-3.5 h-3.5" />
          )}
          Save
        </button>
      </div>

      <div className="space-y-1">
          {DAY_KEYS.map((day) => {
            const d = hours[day];
            const err = errors[day];
            return (
              <div key={day}>
                <div className="flex items-center justify-between py-3 border-b last:border-b-0 border-gray-100">
                  <div className="flex items-center gap-3">
                    <Toggle
                      enabled={d.isOpen}
                      setEnabled={(v) => updateDay(day, { isOpen: v })}
                    />
                    <span
                      className={`text-sm font-medium w-24 ${
                        d.isOpen ? "text-gray-900" : "text-gray-400"
                      }`}
                    >
                      {DAY_LABELS[day]}
                    </span>
                  </div>

                  {d.isOpen ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={d.start}
                        onClick={(e) => (e.currentTarget as any).showPicker?.()}
                        onChange={(e) => updateDay(day, { start: e.target.value })}
                        className={`w-28 px-3 py-2 text-sm border rounded-lg bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 ${
                          err ? "border-red-400" : "border-gray-200"
                        }`}
                      />
                      <span className="text-gray-400 text-xs">to</span>
                      <input
                        type="time"
                        value={d.end}
                        onClick={(e) => (e.currentTarget as any).showPicker?.()}
                        onChange={(e) => updateDay(day, { end: e.target.value })}
                        className={`w-28 px-3 py-2 text-sm border rounded-lg bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 ${
                          err ? "border-red-400" : "border-gray-200"
                        }`}
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 italic">Closed</span>
                  )}
                </div>
                {err && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 pb-1 pl-1">
                    <FiAlertCircle className="w-3 h-3 flex-shrink-0" />
                    {err}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      <p className="mt-4 text-xs text-gray-400">
        All times are in your local timezone. Jobs assigned outside these hours will not be available for acceptance until your next open window.
      </p>
    </section>
  );
};

export default BusinessHoursSection;
