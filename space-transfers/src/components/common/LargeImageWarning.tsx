import toast from "react-hot-toast";
import { NoticeCard } from "./UnsupportedFilesWarning";

const WARNING_DURATION_MS = 7000;

// Rounded down, never up past what fits — with a hair of tolerance, because
// 23.2 * 100 is 2319.9999999999995 and a plain floor shows 23.19.
const inches = (n: number) => `${Math.floor(n * 100 + 1e-6) / 100}in`;

/** Body copy, worded for one image or several. Exported so the wording is testable. */
export const largeImageWarningText = (count: number, printableWidthIn: number) => {
  const isSingle = count <= 1;
  const width = inches(printableWidthIn);
  return {
    title: isSingle ? "Image Resized to Fit" : `${count} Images Resized to Fit`,
    body: isSingle
      ? `This image was wider than the sheet's printable width, so it was scaled down to fit within ${width}. Check that it still prints at the size you need.`
      : `These images were wider than the sheet's printable width, so they were scaled down to fit within ${width}. Check that they still print at the size you need.`,
  };
};

/**
 * Shows the notice. `count` aggregates one change into one message, so several
 * pieces resized at once do not stack identical cards.
 */
export const showLargeImageWarning = (count: number, printableWidthIn: number) => {
  if (count < 1) return;
  const { title, body } = largeImageWarningText(count, printableWidthIn);

  toast.custom(
    (t) => <NoticeCard t={t} title={title} body={body} />,
    { duration: WARNING_DURATION_MS, id: "large-image-warning" },
  );
};
