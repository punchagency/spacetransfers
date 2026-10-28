import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AddressCheckNote from "../components/orders/AddressCheckNote";

/** The admin's warning on an order shipped to an address the carrier didn't confirm at checkout. */
describe("AddressCheckNote", () => {
    it("says nothing when the carrier confirmed the address, or wasn't asked", () => {
        for (const check of [null, undefined, { status: "verified" as const }, { status: "unchecked" as const }]) {
            const { container, unmount } = render(<AddressCheckNote check={check} />);
            expect(container).toBeEmptyDOMElement();
            unmount();
        }
    });

    it("shows the carrier's version when the customer kept their own", () => {
        render(<AddressCheckNote check={{ status: "differs", suggestion: "200 Park Ave, New York, NY 10166" }} />);
        expect(screen.getByRole("note")).toHaveTextContent("The customer kept an address the carrier corrected");
        expect(screen.getByRole("note")).toHaveTextContent("The carrier's version: 200 Park Ave, New York, NY 10166");
    });

    it("says why the carrier couldn't find it", () => {
        render(<AddressCheckNote check={{ status: "not_found", reason: "missing_unit" }} />);
        expect(screen.getByRole("note")).toHaveTextContent("The carrier couldn't find this address");
        expect(screen.getByRole("note")).toHaveTextContent("It may be missing an apartment or suite number.");
    });
});
