import toast from "react-hot-toast";
import { NoticeCard } from "./UnsupportedFilesWarning";

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
