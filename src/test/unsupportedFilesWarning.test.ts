import { describe, it, expect } from "vitest";
import {
  formatLabels,
  unsupportedFilesText,
  splitFileMessage,
} from "../components/common/UnsupportedFilesWarning";
import { ACCEPTED_IMAGE_TYPES } from "../config/artboard.config";

describe("unsupported-files notice", () => {
  it("derives format labels from the MIME types the drop filter accepts", () => {
    expect(formatLabels(ACCEPTED_IMAGE_TYPES)).toEqual([
      "PNG",
      "JPG",
      "SVG",
      "PDF",
    ]);
  });

  it("falls back to the MIME subtype for an unmapped format", () => {
    expect(formatLabels(["image/webp"])).toEqual(["WEBP"]);
  });

  it("de-duplicates labels that map from several MIME types", () => {
    expect(formatLabels(["image/jpeg", "image/jpeg"])).toEqual(["JPG"]);
  });

  it("pluralises the count", () => {
    expect(unsupportedFilesText(1, ACCEPTED_IMAGE_TYPES).title).toBe("1 file skipped");
    expect(unsupportedFilesText(10, ACCEPTED_IMAGE_TYPES).title).toBe("10 files skipped");
  });

  it("names exactly the formats that will actually be accepted", () => {
    // The bug this guards: copy that advertises a format the filter rejects
    // (or omits one it takes) sends the customer round the loop twice.
    const { body } = unsupportedFilesText(3, ACCEPTED_IMAGE_TYPES);
    expect(body).toBe(
      "Unsupported file format. Supported: PNG, JPG, SVG, PDF.",
    );
  });
});

describe("splitFileMessage", () => {
  it("splits the WEBP-content rejection into filename and reason", () => {
    const message =
      '“depositphotos_67209503-stock-photo-300-dpi-pointer-icon-on.jpg” is WEBP, which isn’t supported. Please re-export it as PNG, JPG or PDF.';
    const { fileName, reason } = splitFileMessage(message);
    expect(fileName).toBe(
      "depositphotos_67209503-stock-photo-300-dpi-pointer-icon-on.jpg",
    );
    expect(reason).toBe(
      "is WEBP, which isn’t supported. Please re-export it as PNG, JPG or PDF.",
    );
  });

  it("splits the empty-file message from validateImageFile", () => {
    const { fileName, reason } = splitFileMessage(
      '“scan.png” is empty (0 bytes). The file may not have finished downloading — please re-export it and try again.',
    );
    expect(fileName).toBe("scan.png");
    expect(reason).toContain("is empty (0 bytes)");
  });

  it("splits the unreadable-file message from validateImageFile", () => {
    const { fileName, reason } = splitFileMessage(
      '“logo.png” could not be read — it isn’t a valid image file. It may be damaged or only partly downloaded. Please re-export it and try again.',
    );
    expect(fileName).toBe("logo.png");
    expect(reason).toContain("could not be read");
  });

  it("splits the PDF-mismatch message from validateImageFile", () => {
    const { fileName, reason } = splitFileMessage(
      '“invoice.pdf” is named as a PDF but contains PNG data. Please re-export it in the correct format.',
    );
    expect(fileName).toBe("invoice.pdf");
    expect(reason).toContain("is named as a PDF");
  });

  it("falls back to the raw message when nothing is quoted", () => {
    const { fileName, reason } = splitFileMessage("Something went wrong.");
    expect(fileName).toBe("Something went wrong.");
    expect(reason).toBe("");
  });
});
