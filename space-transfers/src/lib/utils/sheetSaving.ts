/**
 * The two rules that decide how a gang sheet is saved.
 *
 * Kept out of the editor so they can be tested directly: both were learned from
 * real damage — a design full of artwork nobody could load, and a list of saved
 * sheets all called the same thing.
 */

export const artworkNotUploaded = (items: ReadonlyArray<Record<string, any>>): boolean =>
  items.some((it) =>
    [it?.url, it?.croppedUrl, it?.uncroppedUrl, it?.originalUrl, it?.assetId].some(
      (value) => typeof value === "string" && value.startsWith("blob:"),
    ),
  );

export const UNTITLED_SHEET = "Untitled gang sheet";

/**
 * The next free "Untitled gang sheet" name.
 *
 * Autosave names a sheet before anyone has been asked what to call it, so
 * without numbering a customer's saved list is a column of identical rows.
 */
export const nextUntitledName = (existingTitles: ReadonlyArray<string | null | undefined>): string => {
  const taken = new Set(existingTitles.map((t) => String(t ?? "").trim().toLowerCase()).filter(Boolean));
  if (!taken.has(UNTITLED_SHEET.toLowerCase())) return UNTITLED_SHEET;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${UNTITLED_SHEET} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${UNTITLED_SHEET} ${Date.now()}`;
};

/**
 * Whether a customer already has a sheet by this name. Names are unique per
 * customer (the server enforces it); comparing the same way here lets a clash
 * be caught while naming a sheet that is not saved yet.
 */
export const titleTaken = (title: string, existingTitles: ReadonlyArray<string | null | undefined>): boolean => {
  const key = (t: unknown) => String(t ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return existingTitles.some((t) => key(t) === key(title));
};
