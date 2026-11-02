import { useSyncExternalStore } from "react";

/**
 * Images that were placed on the sheet but never reached the server.
 *
 * The image is on the board from the file the customer picked, so they can keep
 * designing — but it exists only in this browser until it uploads. This keeps
 * each one's file and reason so it can be named, shown and sent again, from
 * wherever the customer is looking: the list on the sheet, the top bar, or the
 * save indicator.
 */
export interface FailedUpload {
  /** The board item's id. */
  id: number;
  name: string;
  file: File;
  /** Why it failed, in the customer's terms. */
  reason: string;
  /** The image the item was given when it was placed; unchanged means it has not been edited since. */
  placedUrl: string;
  retrying: boolean;
}

let entries: FailedUpload[] = [];
let retryHandler: ((ids?: number[]) => Promise<void>) | null = null;
const listeners = new Set<() => void>();
const publish = (next: FailedUpload[]) => {
  entries = next;
  listeners.forEach((notify) => notify());
};

export const failedUploads = {
  list: () => entries,
  get: (id: number) => entries.find((e) => e.id === id),
  add: (entry: Omit<FailedUpload, "retrying">) =>
    publish([...entries.filter((e) => e.id !== entry.id), { ...entry, retrying: false }]),
  remove: (ids: number[]) => {
    if (entries.some((e) => ids.includes(e.id))) publish(entries.filter((e) => !ids.includes(e.id)));
  },
  /** Drops entries whose image is no longer on the board. */
  keepOnly: (ids: ReadonlySet<number>) => {
    if (entries.some((e) => !ids.has(e.id))) publish(entries.filter((e) => ids.has(e.id)));
  },
  update: (id: number, patch: Partial<Pick<FailedUpload, "reason" | "retrying">>) =>
    publish(entries.map((e) => (e.id === id ? { ...e, ...patch } : e))),
  /** The board registers how to send them again; anything may then ask. */
  setRetryHandler: (handler: typeof retryHandler) => {
    retryHandler = handler;
  },
  /** Sends the given images again, or all of them. */
  retry: (ids?: number[]) => retryHandler?.(ids) ?? Promise.resolve(),
};

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};

export const useFailedUploads = (): FailedUpload[] => useSyncExternalStore(subscribe, () => entries, () => entries);

/** "1 image" / "3 images". */
export const imageCount = (n: number) => `${n} ${n === 1 ? "image" : "images"}`;
