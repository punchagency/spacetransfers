const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
type DayKey = (typeof DAY_KEYS)[number];

interface DayConfig {
  isOpen?: boolean;
  start?: string;
  end?: string;
}

/**
 * Parses a time string to total minutes past midnight.
 * Accepts "HH:MM" (24-hour) or legacy "9:00am" / "6:00pm" formats.
 */
function parseToMinutes(timeStr: string | undefined | null): number | null {
  if (!timeStr) return null;

  // "HH:MM" 24-hour
  const h24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const h = parseInt(h24[1], 10);
    const m = parseInt(h24[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return h * 60 + m;
  }

  // "9:00am" / "6:00pm"
  const h12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (h12) {
    let h = parseInt(h12[1], 10);
    const m = parseInt(h12[2], 10);
    const mer = h12[3].toLowerCase();
    if (mer === "pm" && h !== 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    return h * 60 + m;
  }

  return null;
}

/**
 * Returns true if the given date/time falls within the supplied day config.
 * If businessHours is missing or the day has no config, returns true (no restriction).
 */
export function isPrinterAvailableAt(printer: any, at: Date = new Date()): boolean {
  const businessHours = printer?.settings?.businessHours;
  if (!businessHours) return true;

  const dayKey: DayKey = DAY_KEYS[at.getDay()];
  const dayConfig: DayConfig | undefined = businessHours[dayKey];

  if (!dayConfig) return true; // day not configured → no restriction
  if (!dayConfig.isOpen) return false; // explicitly closed

  const startMins = parseToMinutes(dayConfig.start);
  const endMins = parseToMinutes(dayConfig.end);

  // If hours aren't set but the day is open, consider it available all day
  if (startMins === null || endMins === null) return true;

  const nowMins = at.getHours() * 60 + at.getMinutes();
  return nowMins >= startMins && nowMins < endMins;
}

export { DAY_KEYS };
