import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CheckoutStep from "../components/checkout/CheckoutStep";
import { UPLOAD_FORMAT_LABELS } from "../config/artboard.config";

/**
 * The printing guidelines shown at checkout used to promise a 12 x 16in print
 * area, list four of the accepted formats, ask for CMYK and set a 150 DPI
 * minimum — none of which matched what the editor does. These pin each line to
 * the rule it describes.
 */
const formData = {
  firstName: "", lastName: "", email: "", phone: "",
  street: "", city: "", state: "", postalCode: "", country: "US",
} as any;

const guidelines = () => {
  render(<CheckoutStep formData={formData} setFormData={() => {}} />);
  return screen.getByText("DTF Printing Guidelines").parentElement!.textContent ?? "";
};

describe("checkout printing guidelines", () => {
  it("describes the sheet as the roll width by any length, not a fixed print area", () => {
    const text = guidelines();
    expect(text).toMatch(/Sheet size: [\d.]+" wide \(the roll width\), any length — billed from [\d.]+" minimum/);
    expect(text).not.toMatch(/12" x 16"/);
  });

  it("lists every accepted format, from the same list the editor accepts", () => {
    expect(guidelines()).toContain(`Formats: ${UPLOAD_FORMAT_LABELS.join(", ")}`);
  });

  it("asks for 300 DPI and says colour is RGB, with CMYK converted", () => {
    const text = guidelines();
    expect(text).toContain("Resolution: 300 DPI");
    expect(text).not.toMatch(/150 DPI/);
    expect(text).toContain("Color: RGB — CMYK files are converted to RGB automatically");
    expect(text).not.toMatch(/CMYK preferred/);
  });
});
