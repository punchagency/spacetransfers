import { describe, it, expect } from "vitest";
import { largeImageWarningText } from "../components/common/LargeImageWarning";

/**
 * Artwork is always kept inside the sheet's printable width, so an image wider
 * than it is scaled down. The notice says that happened and to what, so the
 * customer can check the printed size is still what they want.
 */
describe("largeImageWarningText", () => {
  it("says the image was scaled down, and to what width", () => {
    const { body } = largeImageWarningText(1, 23.2);
    expect(body).toMatch(/scaled down to fit within 23\.2in/);
    expect(body).toMatch(/wider than the sheet's printable width/);
  });

  it("tells the customer what to check", () => {
    expect(largeImageWarningText(1, 23.2).body).toMatch(/Check that it still prints at the size you need/);
  });

  it("does not read as a failure", () => {
    expect(largeImageWarningText(1, 23.2).body).not.toMatch(/cannot|failed|error/i);
  });

  it("counts and pluralises for several images", () => {
    const { title, body } = largeImageWarningText(3, 23.2);
    expect(title).toBe("3 Images Resized to Fit");
    expect(body).toMatch(/These images were wider/);
    expect(body).toMatch(/Check that they still print/);
  });

  it("treats a zero or negative count as the single-image case", () => {
    expect(largeImageWarningText(0, 23.2).title).toBe("Image Resized to Fit");
    expect(largeImageWarningText(-1, 23.2).title).toBe("Image Resized to Fit");
  });

  it("never rounds the width up past what fits", () => {
    expect(largeImageWarningText(1, 23.199).body).toMatch(/within 23\.19in/);
  });
});
