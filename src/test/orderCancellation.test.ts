import { describe, expect, it } from "vitest";
import { cancelCopy, cancellationNote } from "../lib/utils/orderCancellation";

describe("cancelling an order", () => {
  it("says plainly whether it cancels now or asks the partner", () => {
    expect(cancelCopy("now").confirm).toBe("Cancel order");
    expect(cancelCopy("request").confirm).toBe("Ask to cancel");
    expect(cancelCopy("request").body).toMatch(/ask them/);
  });

  it("shows an open request and a refusal with its reason", () => {
    const base = { reason: null, requestedAt: null, respondedAt: null, declineReason: null };
    expect(cancellationNote({ option: null, request: { ...base, status: "PENDING" } })?.tone).toBe("waiting");
    expect(cancellationNote({ option: null, request: { ...base, status: "DECLINED", declineReason: "Already printed" } })?.text).toBe(
      "It couldn't be cancelled: Already printed",
    );
    expect(cancellationNote({ option: null, request: { ...base, status: "ACCEPTED" } })).toBeNull();
    expect(cancellationNote(null)).toBeNull();
  });
});
