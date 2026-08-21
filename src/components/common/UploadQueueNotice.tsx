import toast from "react-hot-toast";
import { NoticeCard } from "./UnsupportedFilesWarning";

/**
 * Notice for files dropped while a batch is still processing.
 *
 * The artboard used to start the new batch immediately, alongside the running
 * one. Both then competed for the same six upload slots, the same decode
 * budget and the same packer, which is what made a second large drop stall the
 * board — and the progress overlay, which reports one batch's counts, became
 * unreadable while two were in flight.
 *
 * The files are now held until the active batch finishes. That is a *deferral*,
 * not a rejection, and the wording has to say so precisely: a customer who
 * thinks their drop was ignored will drop it again, which is the exact input
 * this is meant to damp. So the notice names the count, says it is queued, and
 * says what it is waiting for.
 *
 * Renders through `NoticeCard`, so it stacks with the low-DPI and large-image
 * notices rather than introducing another surface.
 */

/** Matches the other drop notices, so everything from one drop ages out together. */
const NOTICE_DURATION_MS = 7000;

/**
 * Title and body, worded for one file or several.
 *
 * Exported so the wording is testable without rendering a toast — "queued", and
 * the fact that it will be added automatically, are the load-bearing parts and
 * should not drift into sounding like a failure.
 */
export const uploadQueuedText = (queuedFiles: number, activeTotal: number) => {
  const isSingle = queuedFiles === 1;
  return {
    title: isSingle ? "1 image queued" : `${queuedFiles} images queued`,
    body:
      `Images are still processing. ${isSingle ? "It" : "They"} will be added automatically once the ` +
      `current batch of ${activeTotal} finishes — please wait before adding more.`,
  };
};

/**
 * Shows the notice.
 *
 * A fixed `id` is what makes rapid repeated attempts graceful: each further
 * drop replaces the card with an updated total instead of stacking another
 * copy of the same sentence. The count passed in is the whole pending queue,
 * not just the newest drop, so the replacement always reads as a running total.
 */
export const showUploadQueuedNotice = (queuedFiles: number, activeTotal: number) => {
  if (queuedFiles < 1) return;
  const { title, body } = uploadQueuedText(queuedFiles, activeTotal);

  toast.custom((t) => <NoticeCard t={t} title={title} body={body} />, {
    duration: NOTICE_DURATION_MS,
    id: "upload-queued-notice",
  });
};
