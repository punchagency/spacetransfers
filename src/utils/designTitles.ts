import { Design } from "../models/design.model.js";

/**
 * Sheet names are unique per customer.
 *
 * Nothing enforced it, and a customer ended up with two saved sheets and three
 * cart lines all called "sheet one" — no way to tell which was which. Names are
 * compared ignoring case and repeated spaces, so "Sheet  One" is "sheet one".
 */
export const UNTITLED_SHEET = "Untitled gang sheet";

export const normalizeTitle = (title: unknown): string =>
  String(title ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

export const titleKey = (title: string) => normalizeTitle(title).toLowerCase();

/** The customer's sheet names, keyed for comparison. `exceptId` leaves one sheet out (its own rename). */
const takenTitles = async (userId: unknown, exceptId?: unknown): Promise<Set<string>> => {
  const query: Record<string, unknown> = { user: userId };
  if (exceptId) query._id = { $ne: exceptId };
  const rows = await Design.find(query).select("title").lean();
  return new Set(rows.map((d: any) => titleKey(d.title)));
};

export const isTitleTaken = async (userId: unknown, title: string, exceptId?: unknown): Promise<boolean> =>
  (await takenTitles(userId, exceptId)).has(titleKey(title));

/**
 * The first free name built from `base`: "Untitled gang sheet 2" for untitled
 * sheets, "Summer shirts (2)" for named ones. A numbered base starts from its
 * root, so a copy of "Summer shirts (2)" becomes "(3)", not "(2) (2)".
 */
export const uniqueTitle = async (userId: unknown, base: string, exceptId?: unknown): Promise<string> =>
  freeTitle(base, await takenTitles(userId, exceptId));

/** The name-picking rule on its own, given the names already taken (compared with `titleKey`). */
export const freeTitle = (base: string, taken: Set<string>): string => {
  const clean = normalizeTitle(base) || UNTITLED_SHEET;
  if (!taken.has(titleKey(clean))) return clean;
  const untitled = /^untitled gang sheet( \d+)?$/i.test(clean);
  const root = untitled ? UNTITLED_SHEET : clean.replace(/\s*\(\d+\)$/, "");
  for (let n = 2; n < 10_000; n++) {
    const candidate = untitled ? `${root} ${n}` : `${root} (${n})`;
    if (!taken.has(titleKey(candidate))) return candidate;
  }
  return `${root} (${Date.now()})`;
};

export const titleTakenError = (title: string) =>
  Object.assign(
    new Error(`You already have a sheet called “${normalizeTitle(title)}”. Please choose a different name.`),
    { statusCode: 409, code: "TITLE_TAKEN" },
  );
