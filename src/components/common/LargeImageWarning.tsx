import toast from "react-hot-toast";
import { NoticeCard } from "./UnsupportedFilesWarning";

/**
 * Non-blocking notice for artwork larger than the sheet's printable area.
 *
 * This used to be `toast.error("Image width cannot exceed the printable area
 * …")`, which was wrong in both tone and substance. The upload had in fact
 * succeeded, so a red error stated a failure that had not happened — and it
 * gave no indication of what to do about it. Being oversized is a thing worth
 * knowing before printing, not a thing that went wrong.
 *
 * Amber rather than red is the whole point: red is reserved for states that
 * actually block progress (a corrupt file, a failed upload). Using it here
 * taught customers to distrust it.
 *
 * Renders through `NoticeCard`, the shell the "files skipped" notice defines,
 * so every amber toast in the app shares one visual definition rather than
 * three hand-matched copies of the same card.
 */

/** Mid-point of the requested 6–8s window. */
const WARNING_DURATION_MS = 7000;

/**
 * Body copy, worded for one image or several.
 *
 * Exported so its wording is testable without rendering a toast — the exact
 * reassurance ("added successfully") is the part that stops this reading as a
 * failure, and it should not be able to drift unnoticed.
 */
export const largeImageWarningText = (count: number) => {
  const isSingle = count <= 1;
  return {
    title: isSingle ? "Large Image Detected" : `${count} Large Images Detected`,
    body: isSingle
      ? "This image is larger than the recommended printable area for the selected gang sheet. It has been added successfully, but you may need to resize or reposition it to ensure it fits within the printable area before printing."
      : `These images are larger than the recommended printable area for the selected gang sheet. They have been added successfully, but you may need to resize or reposition them to ensure they fit within the printable area before printing.`,
  };
};

/**
 * Shows the notice.
 *
 * `count` aggregates a whole drop into one message. Files upload concurrently,
 * so a per-file toast would stack several overlapping copies of the same
 * advice — which is how a helpful notice becomes noise people dismiss without
 * reading.
 */
export const showLargeImageWarning = (count = 1) => {
  if (count < 1) return;
  const { title, body } = largeImageWarningText(count);

  toast.custom(
    (t) => <NoticeCard t={t} title={title} body={body} />,
    { duration: WARNING_DURATION_MS, id: "large-image-warning" },
  );
};
