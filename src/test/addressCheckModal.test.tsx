import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AddressCheckModal, { type AddressPrompt } from "../components/checkout/AddressCheckModal";

/**
 * The dialog checkout shows when the carrier disagrees with the address. Every
 * way of dismissing it must mean "edit the address": shipping to an address
 * the carrier questioned has to be a choice, never an accident.
 */
const entered = { street: "200 Park Avenue", city: "New York", state: "NY", postalCode: "90210" };
const suggestion = { street: "200 Park Ave", city: "New York", state: "NY", postalCode: "10166" };

const setup = (prompt: any) => {
  const onUse = vi.fn();
  const onEdit = vi.fn();
  const view = render(<AddressCheckModal prompt={prompt} entered={entered} onUse={onUse} onEdit={onEdit} />);
  return { onUse, onEdit, view };
};

describe("AddressCheckModal", () => {
  it("renders nothing without a prompt", () => {
    const { view } = setup(null);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("offers the carrier's version first and marks what changed", () => {
    const { onUse } = setup({ status: "suggested", suggestion, changed: ["postalCode"] });
    expect(screen.getByRole("dialog", { name: "Confirm your shipping address" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Suggested by the carrier/ })).toBeChecked();
    // Only the ZIP code is marked: "Avenue" to "Ave" is spelling, not a change.
    const marks = [...document.querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks).toEqual(["10166"]);
    fireEvent.click(screen.getByRole("button", { name: "Use this address" }));
    expect(onUse).toHaveBeenCalledWith(suggestion);
  });

  it("ships to the customer's own version when they choose it", () => {
    const { onUse } = setup({ status: "suggested", suggestion, changed: ["postalCode"] });
    fireEvent.click(screen.getByRole("radio", { name: /As you entered it/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use this address" }));
    expect(onUse).toHaveBeenCalledWith(entered);
  });

  it("asks to fix an address the carrier can't find, and allows keeping it on purpose", () => {
    const { onUse, onEdit } = setup({ status: "not_found", reason: "missing_unit" });
    expect(screen.getByRole("dialog", { name: "We couldn't verify this address" })).toBeInTheDocument();
    expect(screen.getByText(/Add your apartment or suite number/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit address" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onUse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ship to this address anyway" }));
    expect(onUse).toHaveBeenCalledWith(entered);
  });

  it("treats Escape, the backdrop and the close button as editing, never as accepting", () => {
    const { onUse, onEdit, view } = setup({ status: "not_found", reason: "not_found" });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(view.container.firstChild as Element);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onEdit).toHaveBeenCalledTimes(3);
    expect(onUse).not.toHaveBeenCalled();
  });

  it("keeps the customer's choice when the checkout behind it re-renders", () => {
    const onUse = vi.fn();
    const prompt: AddressPrompt = { status: "suggested", suggestion, changed: ["postalCode"] };
    const { rerender } = render(<AddressCheckModal prompt={prompt} entered={entered} onUse={onUse} onEdit={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /As you entered it/ }));
    rerender(<AddressCheckModal prompt={prompt} entered={entered} onUse={onUse} onEdit={() => {}} />);
    expect(screen.getByRole("radio", { name: /As you entered it/ })).toBeChecked();
  });
});
