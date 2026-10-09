import { useEffect, useState } from "react";
import { MdCloudOff, MdExpandLess, MdExpandMore, MdRefresh } from "react-icons/md";
import { failedUploads, imageCount, useFailedUploads } from "../../../../lib/failedUploads";

export interface NotUploadedItem {
  id: number;
  name?: string;
  url: string;
}

/** The server's sentence without the file name it opens with — the row already shows it. */
const shortReason = (reason: string) =>
  reason.replace(/^“[^”]*”\s*/, "").replace(/^./, (c) => c.toUpperCase());

const useOnline = () => {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
};

/**
 * The images on the sheet that did not upload: which ones, why, and the way to
 * fix each — send it again, look at it, or take it off.
 *
 * Docked over the sheet rather than raised as a toast, because it is a state,
 * not an event: it stays for as long as an image is only in this browser, and
 * goes by itself when the last one uploads or is removed.
 */
export default function FailedUploadsPanel({
  items,
  onShow,
  onRemove,
}: {
  /** Every image on the board that is not uploaded, in board order. */
  items: NotUploadedItem[];
  onShow: (id: number) => void;
  onRemove: (ids: number[]) => void;
}) {
  const entries = useFailedUploads();
  const online = useOnline();
  const [open, setOpen] = useState(true);
  // A fresh failure reopens a list the customer had tucked away.
  useEffect(() => {
    if (items.length > 0) setOpen(true);
  }, [items.length]);

  if (items.length === 0) return null;

  const byId = new Map(entries.map((e) => [e.id, e]));
  const retryable = items.filter((it) => byId.has(it.id));
  const anyRetrying = retryable.some((it) => byId.get(it.id)!.retrying);

  return (
    <section
      aria-label="Images that did not upload"
      className="pointer-events-auto absolute bottom-3 left-3 z-[60] w-[340px] max-w-[calc(100%-1.5rem)] overflow-hidden rounded-xl border border-red-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.16)]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-red-50 px-3 py-2.5 text-left"
      >
        <MdCloudOff className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
        <span className="min-w-0 flex-1 text-[13px] font-semibold text-red-900">
          {imageCount(items.length)} didn't upload
        </span>
        {open ? <MdExpandMore className="h-4 w-4 text-red-700" aria-hidden /> : <MdExpandLess className="h-4 w-4 text-red-700" aria-hidden />}
      </button>

      {open && (
        <>
          <p className="border-b border-gray-100 px-3 py-2 text-[12px] leading-[17px] text-gray-600">
            {online
              ? `${items.length === 1 ? "It is" : "They are"} on your sheet, outlined in red, but only on this device. Your sheet is saved without ${items.length === 1 ? "it" : "them"}, and can't go in the cart until ${items.length === 1 ? "it uploads" : "they upload"}.`
              : `You're offline. ${items.length === 1 ? "It" : "They"}'ll be sent again as soon as you're back online.`}
          </p>

          <ul className="max-h-[216px] overflow-y-auto">
            {items.map((item) => {
              const entry = byId.get(item.id);
              return (
                <li key={item.id} className="flex items-center gap-2.5 border-b border-gray-100 px-3 py-2 last:border-0">
                  <button
                    type="button"
                    onClick={() => onShow(item.id)}
                    title="Show on the sheet"
                    className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-[conic-gradient(#e5e7eb_25%,#fff_0_50%,#e5e7eb_0_75%,#fff_0)] bg-[length:10px_10px]"
                  >
                    <img src={item.url} alt="" className="h-full w-full object-contain" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onShow(item.id)}
                      className="block max-w-full truncate text-left text-[12px] font-semibold text-gray-900 hover:underline"
                      title={item.name || "Image"}
                    >
                      {item.name || "Image"}
                    </button>
                    <p className="truncate text-[11px] text-gray-500" title={entry ? shortReason(entry.reason) : undefined}>
                      {entry
                        ? entry.retrying
                          ? "Uploading…"
                          : shortReason(entry.reason)
                        : "Add this file to the sheet again."}
                    </p>
                  </div>
                  {entry && (
                    <button
                      type="button"
                      onClick={() => void failedUploads.retry([item.id])}
                      disabled={entry.retrying}
                      className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {entry.retrying ? "…" : "Retry"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove([item.id])}
                    className="shrink-0 px-1 text-[11px] font-medium text-gray-500 hover:text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center gap-2 border-t border-gray-100 bg-gray-50 px-3 py-2">
            {retryable.length > 0 && (
              <button
                type="button"
                onClick={() => void failedUploads.retry()}
                disabled={anyRetrying}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-gray-900 disabled:opacity-60"
              >
                <MdRefresh className={`h-3.5 w-3.5 ${anyRetrying ? "animate-spin" : ""}`} aria-hidden />
                {anyRetrying ? "Uploading…" : retryable.length === 1 ? "Retry upload" : `Retry all ${retryable.length}`}
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemove(items.map((it) => it.id))}
              className="rounded-lg px-2 py-1.5 text-[12px] font-medium text-gray-600 hover:text-red-600 hover:underline"
            >
              {items.length === 1 ? "Remove it" : "Remove all"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
