import { describe, it, expect } from "vitest";
import { largeImageWarningText } from "../components/common/LargeImageWarning";

/**
 * The oversize notice used to be `toast.error("Image width cannot exceed the
 * printable area …")`. That was wrong on both counts: the upload had actually
 * succeeded, and the wording described a hard limit rather than a suggestion.
 * These pin the reassurance and the guidance, which are the parts that stop it
 * reading as a failure.
 */
describe("largeImageWarningText", () => {
  it("says the upload succeeded", () => {
    // The single most important clause. Without it the notice reads as a
    // rejection, which is exactly what the old error did.
    const { body } = largeImageWarningText(1);
    expect(body).toMatch(/added successfully/i);
  });

  it("says what the user can do about it", () => {
    const { body } = largeImageWarningText(1);
    expect(body).toMatch(/resize or reposition/i);
    expect(body).toMatch(/printable area/i);
  });

  it("frames the size as a recommendation, not a limit", () => {
    // "cannot exceed" was a false statement — the item is on the sheet.
    const { body } = largeImageWarningText(1);
    expect(body).toMatch(/recommended/i);
    expect(body).not.toMatch(/cannot|must not|not allowed|failed|error/i);
  });

  it("uses the agreed title for a single image", () => {
    expect(largeImageWarningText(1).title).toBe("Large Image Detected");
  });

  it("counts and pluralises for a multi-file drop", () => {
    // Files upload concurrently, so a drop of several oversized images
    // aggregates into one notice rather than stacking identical copies.
    const { title, body } = largeImageWarningText(3);
    expect(title).toBe("3 Large Images Detected");
    expect(body).toMatch(/These images/);
    expect(body).toMatch(/They have been added successfully/i);
    expect(body).toMatch(/resize or reposition them/i);
  });

  it("treats a zero or negative count as the single-image case", () => {
    // Defensive: a miscount must not render "0 Large Images Detected".
    expect(largeImageWarningText(0).title).toBe("Large Image Detected");
    expect(largeImageWarningText(-1).title).toBe("Large Image Detected");
  });

  it("keeps the title short enough to scan", () => {
    // The title carries the meaning at a glance; the body carries the detail.
    expect(largeImageWarningText(1).title.length).toBeLessThan(32);
  });
});
