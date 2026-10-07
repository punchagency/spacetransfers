/**
 * The sheet a customer had open, remembered per account in this browser so the
 * store reopens it. An empty value means they deliberately left a blank board.
 */
const key = (userId: string) => `lastSheet:${userId}`;

/** The remembered sheet id, "" for a blank board, or null when nothing was remembered. */
export const readLastSheet = (userId: string): string | null => {
  try {
    return localStorage.getItem(key(userId));
  } catch {
    return null;
  }
};

export const writeLastSheet = (userId: string, designId: string | null) => {
  try {
    localStorage.setItem(key(userId), designId || "");
  } catch {
    /* storage unavailable: the store opens on the most recent sheet instead */
  }
};

/**
 * Which sheet to reopen: the remembered one, nothing after a deliberate blank
 * board, or the most recently saved sheet on a browser that remembers nothing.
 */
export const sheetToReopen = (remembered: string | null, mostRecentId: string | null): string | null => {
  if (remembered === "") return null;
  return remembered || mostRecentId || null;
};
