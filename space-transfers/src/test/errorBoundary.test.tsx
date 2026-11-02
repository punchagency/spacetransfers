import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ErrorBoundary } from "../components/common/ErrorBoundary";

/**
 * A render error used to unmount the whole store (blank page, a guest's board
 * lost). The editor is now fenced into parts; these pin how a part fails.
 */
let explode = true;
const Bomb = () => {
  if (explode) throw new Error("boom");
  return <p>working</p>;
};

describe("ErrorBoundary", () => {
  it("keeps a failing region to itself, and Try again recovers", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    explode = true;
    render(
      <div>
        <p>header still here</p>
        <ErrorBoundary name="The design area"><Bomb /></ErrorBoundary>
      </div>,
    );
    expect(screen.getByText("header still here")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/The design area ran into a problem/);
    explode = false;
    fireEvent.click(screen.getByText("Try again"));
    expect(screen.getByText("working")).toBeTruthy();
  });

  it("closes a failing dialog, and lets it open again", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    explode = true;
    const Host = () => {
      const [open, setOpen] = useState(true);
      return (
        <div>
          <button onClick={() => setOpen(true)}>open</button>
          <span>{open ? "open" : "closed"}</span>
          <ErrorBoundary name="The save window" resetKey={open} onDismiss={() => setOpen(false)}>
            {open ? <Bomb /> : null}
          </ErrorBoundary>
        </div>
      );
    };
    render(<Host />);
    expect(screen.getByText("closed")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    explode = false;
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByText("working")).toBeTruthy();
  });
});
