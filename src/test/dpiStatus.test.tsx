import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import toast, { Toaster } from "react-hot-toast";
import {
  DpiStatusChip,
  dpiClause,
  dpiStatusAriaLabel,
  dpiStatusBody,
  dpiStatusLines,
  dpiStatusTitle,
  showLowDpiWarning,
} from "../components/common/DpiStatus";
import { NoticeCard } from "../components/common/UnsupportedFilesWarning";
import { uploadQueuedText } from "../components/common/UploadQueueNotice";
import { showLargeImageWarning } from "../components/common/LargeImageWarning";
import ArtboardWarning from "../components/artboard/features/canvas/ArtboardWarning";
import {
  isDpiFlagged,
  isLowDpi,
  isUnknownDpi,
} from "../components/artboard/lib/utils/layoutHelpers";

/** Stand-in for the toast handle react-hot-toast passes to a custom renderer. */
const t = { visible: true, id: "test-toast" };

/**
 * The top-bar chip and the docked banner describe the same three counts on two
 * surfaces. These lock the wording and the render conditions so the two cannot
 * drift back into disagreeing about what the same numbers mean — which is the
 * state this system replaced.
 */

describe("dpi status copy", () => {
  it("titles by which conditions are present", () => {
    expect(dpiStatusTitle(2, 0)).toBe("Low DPI");
    expect(dpiStatusTitle(0, 2)).toBe("Unknown DPI Detected");
    expect(dpiStatusTitle(2, 3)).toBe("DPI Issues Detected");
  });

  it("includes a count in the clause only when it is non-zero", () => {
    expect(dpiClause(2, 0)).toBe("(2) images have a resolution below 300 DPI");
    expect(dpiClause(0, 1)).toBe("(1) image has an undetermined resolution");
    expect(dpiClause(1, 2)).toBe(
      "(1) image has a resolution below 300 DPI and (2) images have an undetermined resolution",
    );
  });

  it("adds the verify-undetermined guidance only when some resolution is unknown", () => {
    expect(dpiStatusBody(3, 0)).toBe(
      "(3) images have a resolution below 300 DPI. For optimal DTF printing quality, images should be at least 300 DPI at print size.",
    );
    expect(dpiStatusBody(0, 1)).toContain("enhance them to be safe.");
  });

  it("splits the tooltip breakdown one line per condition", () => {
    expect(dpiStatusLines(0, 0)).toHaveLength(0);
    expect(dpiStatusLines(4, 0)).toEqual(["4 images are below 300 DPI"]);
    expect(dpiStatusLines(1, 1)).toEqual([
      "1 image is below 300 DPI",
      "1 image has an undetermined resolution",
    ]);
  });

  it("summarises both conditions for assistive tech", () => {
    // The breakdown lives in a hover tooltip, which is never announced — so the
    // label has to carry it or the chip reads as a bare number.
    expect(dpiStatusAriaLabel(1, 2)).toBe(
      "DPI Issues Detected: (1) image has a resolution below 300 DPI and (2) images have an undetermined resolution.",
    );
  });
});

describe("dpi status chip", () => {
  it("renders nothing when there is nothing to report", () => {
    const { container } = render(<DpiStatusChip lowDpiCount={0} unknownDpiCount={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows one combined count rather than a badge per condition", () => {
    render(<DpiStatusChip lowDpiCount={2} unknownDpiCount={3} />);
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("caps the displayed count so the chip cannot widen without bound", () => {
    render(<DpiStatusChip lowDpiCount={150} unknownDpiCount={0} />);
    expect(screen.getByText("99+")).toBeTruthy();
  });

  it("uses the same amber the rest of the advisory system uses", () => {
    // Locks the chip to the "files skipped" / "large image" palette so it
    // can't quietly drift back into its own colour.
    const { container } = render(<DpiStatusChip lowDpiCount={1} unknownDpiCount={0} />);
    expect(container.innerHTML).toContain("#FFFBEB");
    expect(container.innerHTML).toContain("#F59E0B");
  });
});

describe("dpi chip highlight control", () => {
  const counts = { lowDpiCount: 2, unknownDpiCount: 1 };

  it("stays a passive readout when nothing can be highlighted", () => {
    // No handler means no working control — a pressable-looking chip that does
    // nothing is worse than a plain readout.
    render(<DpiStatusChip {...counts} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("reveals the flagged artwork when clicked", () => {
    const onToggleHighlight = vi.fn();
    render(<DpiStatusChip {...counts} onToggleHighlight={onToggleHighlight} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggleHighlight).toHaveBeenCalledTimes(1);
  });

  it("reports its pressed state to assistive tech", () => {
    const { rerender } = render(
      <DpiStatusChip {...counts} onToggleHighlight={() => {}} isHighlighting={false} />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");

    rerender(
      <DpiStatusChip {...counts} onToggleHighlight={() => {}} isHighlighting />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("names the action in its label, not just the counts", () => {
    // The chip's whole subtree is hover-only apart from the button, so the
    // label is the only place a screen-reader user learns it does something.
    render(<DpiStatusChip {...counts} onToggleHighlight={() => {}} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain(
      "Show them on the sheet",
    );
  });

  it("carries the marker the outside-click dismissal keys off", () => {
    // Without it the pointerdown that opens the highlight counts as an outside
    // click and closes it again on the same gesture.
    const { container } = render(
      <DpiStatusChip {...counts} onToggleHighlight={() => {}} />,
    );
    expect(container.querySelector("[data-dpi-chip]")).toBeTruthy();
  });
});

describe("dpi flag predicates", () => {
  // 600px across 1in = 600 DPI; across 4in = 150 DPI.
  const sharp = { nativeWidthPx: 600, widthIn: 1, heightIn: 1 };
  const soft = { nativeWidthPx: 600, widthIn: 4, heightIn: 4 };
  const unmeasurable = { widthIn: 4, heightIn: 4 };

  it("separates measurably-soft from unmeasurable", () => {
    expect(isLowDpi(soft)).toBe(true);
    expect(isLowDpi(unmeasurable)).toBe(false);
    expect(isUnknownDpi(unmeasurable)).toBe(true);
    expect(isUnknownDpi(soft)).toBe(false);
  });

  it("leaves print-ready artwork alone", () => {
    expect(isLowDpi(sharp)).toBe(false);
    expect(isUnknownDpi(sharp)).toBe(false);
    expect(isDpiFlagged(sharp)).toBe(false);
  });

  it("flags exactly what the chip counts", () => {
    // The invariant the highlight depends on: the number on the chip and the
    // set of highlighted images are derived from the same verdict, so a chip
    // reading "2" can never light up one image or three.
    const board = [sharp, soft, unmeasurable, sharp];
    const chipTotal =
      board.filter(isLowDpi).length + board.filter(isUnknownDpi).length;
    const highlighted = board.filter(isDpiFlagged).length;

    expect(chipTotal).toBe(2);
    expect(highlighted).toBe(chipTotal);
  });

  it("treats exactly 300 DPI as print-ready", () => {
    // `computeEffectiveDpi` rounds, so 599/2in = 299.5 reports as 300 and is
    // not flagged. Documented rather than tightened: a half-DPI shortfall is
    // not a print defect, and warning about one would be noise.
    expect(isDpiFlagged({ nativeWidthPx: 600, widthIn: 2, heightIn: 2 })).toBe(false);
    expect(isDpiFlagged({ nativeWidthPx: 599, widthIn: 2, heightIn: 2 })).toBe(false);
    expect(isDpiFlagged({ nativeWidthPx: 598, widthIn: 2, heightIn: 2 })).toBe(true);
  });
});

describe("low dpi notice", () => {
  afterEach(() => {
    toast.remove();
  });

  it("goes through the shared toast queue", async () => {
    render(<Toaster />);
    showLowDpiWarning(2);
    expect(await screen.findByText("Low DPI")).toBeTruthy();
  });

  it("stands alongside the large-image notice instead of replacing it", async () => {
    // The headline requirement: two conditions from one drop are two
    // notifications. Distinct toast ids are what keep both alive — react-hot-
    // toast treats a repeated id as an update, so sharing one would silently
    // collapse them into whichever fired last.
    render(<Toaster />);
    showLargeImageWarning(3);
    showLowDpiWarning(2);

    expect(await screen.findByText("Low DPI")).toBeTruthy();
    expect(screen.getByText("3 Large Images Detected")).toBeTruthy();
  });

  it("carries no outer margin, so toast stacking can measure it", () => {
    // react-hot-toast offsets each toast by the measured height of the ones
    // above it, and `getBoundingClientRect()` excludes margins. A margin on the
    // outermost element is therefore invisible to that maths and lands the
    // second notice on top of the first. Interior margins are fine — they sit
    // inside the measured box — so this checks the root only.
    const { container } = render(<NoticeCard t={t} title="x" body="y" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toMatch(/(^|\s)-?m[tbxy]?-/);
  });
});

describe("artboard warning banner", () => {
  it("renders nothing when there is no fade", () => {
    const { container } = render(<ArtboardWarning fadeCount={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("no longer merges resolution into the fade banner", () => {
    // Low DPI is a toast now, so a sheet with both conditions shows two
    // independent notices rather than one merged "Print Issues" sentence.
    render(<ArtboardWarning fadeCount={1} />);
    expect(screen.getByText("Fade Detected")).toBeTruthy();
    expect(screen.queryByText("Print Issues Detected")).toBeNull();
  });

  it("is announced politely — a fade did not block the customer's work", () => {
    render(<ArtboardWarning fadeCount={1} />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });
});

describe("upload queue notice", () => {
  it("says the files are queued, not rejected", () => {
    // A customer who reads this as a failure will drop the same folder again —
    // the exact input the queue exists to damp.
    const { title, body } = uploadQueuedText(40, 120);
    expect(title).toBe("40 images queued");
    expect(body).toContain("added automatically");
    expect(body).toContain("120");
  });

  it("reads naturally for a single file", () => {
    const { title, body } = uploadQueuedText(1, 100);
    expect(title).toBe("1 image queued");
    expect(body).toContain("It will be added");
  });
});
