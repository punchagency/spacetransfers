import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import QueueBadge from "../components/artboard/features/canvas/QueueBadge";
import BulkLoadOverlay from "../components/artboard/features/canvas/BulkLoadOverlay";

/**
 * The queued-batch card.
 *
 * Two properties are load-bearing. Its *exit*: when the queue drains, the count
 * it is displaying goes to zero in the same frame, so a naive render would blank
 * the circle before the animation could play. And its *separation* from the
 * progress card: the bar's percentage only means something because it describes
 * exactly one batch, so nothing about the queue may leak into it.
 */

const EXIT_MS = 320;

describe("queued batch badge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays out of the way when nothing is queued", () => {
    const { container } = render(<QueueBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the number of images waiting", () => {
    render(<QueueBadge count={42} />);
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByLabelText(/42 images queued/)).toBeTruthy();
  });

  it("shows the exact count, however large", () => {
    // The question a customer has after dropping a big folder is "did all of
    // them register?" — an abbreviated count refuses to answer it.
    render(<QueueBadge count={1247} />);
    expect(screen.getByText("1247")).toBeTruthy();
    expect(screen.queryByText(/\+/)).toBeNull();
  });

  it("reads naturally for a single image", () => {
    render(<QueueBadge count={1} />);
    expect(screen.getByLabelText(/1 image queued/)).toBeTruthy();
  });

  it("keeps showing its last count while animating away", () => {
    const { rerender } = render(<QueueBadge count={7} />);
    expect(screen.getByText("7")).toBeTruthy();

    rerender(<QueueBadge count={0} />);
    expect(screen.getByText("7")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(EXIT_MS + 20);
    });
    expect(screen.queryByText("7")).toBeNull();
  });

  it("re-enters cleanly if more images are queued mid-exit", () => {
    // Drop → queue drains → drop again before the exit finishes. The badge has
    // to come back with the new count rather than finish leaving and unmount.
    const { rerender } = render(<QueueBadge count={3} />);
    rerender(<QueueBadge count={0} />);
    act(() => {
      vi.advanceTimersByTime(EXIT_MS / 2);
    });

    rerender(<QueueBadge count={9} />);
    act(() => {
      vi.advanceTimersByTime(EXIT_MS + 20);
    });

    expect(screen.getByText("9")).toBeTruthy();
  });
});

describe("progress card separation", () => {
  it("carries no queue count of its own", () => {
    // The queue lives in its own card. If a count ever reappears here, the two
    // readings can be confused for one — which is what moving it out fixed.
    render(<BulkLoadOverlay loaded={25} total={100} />);
    expect(screen.getByText("Processing 25 of 100 images")).toBeTruthy();
    expect(screen.queryByText(/queued/i)).toBeNull();
  });

  it("keeps the bar reporting only the active batch", () => {
    render(<BulkLoadOverlay loaded={25} total={100} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");
  });

  it("renders nothing when no batch is running", () => {
    const { container } = render(<BulkLoadOverlay loaded={0} total={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is independent of the queue card — either can show without the other", () => {
    // The hand-off between batches passes through both states for a frame:
    // a queue with no active batch, and an active batch with an empty queue.
    const onlyQueue = render(<QueueBadge count={12} />);
    expect(onlyQueue.getByText("12")).toBeTruthy();

    const onlyBar = render(<BulkLoadOverlay loaded={3} total={9} />);
    expect(onlyBar.getByRole("progressbar")).toBeTruthy();
  });
});
