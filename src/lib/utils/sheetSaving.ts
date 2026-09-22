/**
 * The two rules that decide how a gang sheet is saved.
 *
 * Kept out of the editor so they can be tested directly: both were learned from
 * real damage — a design full of artwork nobody could load, and a list of saved
 * sheets all called the same thing.
 */

/**
 * True when any artwork on the board exists only in this browser.
 *
 * A failed upload leaves its image as a `blob:` URL, which no other device and
 * no printer can read. Saving those produced a design that looked right until it
 * was reopened, when every image was gone — which is what the unexplained DPI
 * warnings on a reopened sheet actually were: the board measuring images that
 * could no longer load.
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
 * The name for a sheet branched off another: "Summer shirts (2)", then (3)…
 *
 * Used when a sheet that is in the cart is changed and the customer keeps the
 * cart's version, carrying on with the changes as a separate sheet — it needs a
 * name of its own so the two can be told apart in the cart and the saved list.
 * An untitled sheet just takes the next untitled number.
 */
export const nextCopyName = (title: string, existingTitles: ReadonlyArray<string | null | undefined>): string => {
  const base = String(title ?? "").trim().replace(/\s*\(\d+\)$/, "");
  if (!base || /^untitled gang sheet( \d+)?$/i.test(base)) return nextUntitledName(existingTitles);
  const taken = new Set(existingTitles.map((t) => String(t ?? "").trim().toLowerCase()).filter(Boolean));
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now()})`;
};
