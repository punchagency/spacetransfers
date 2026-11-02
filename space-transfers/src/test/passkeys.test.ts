import { describe, expect, it } from "vitest";
import { needsSecondStep, passkeyErrorMessage, recoveryCodesFile, suggestPasskeyName } from "../lib/utils/passkeys";

describe("passkeys", () => {
  it("recognise a sign-in that still owes its second step", () => {
    expect(needsSecondStep({ twoFactorRequired: true, stepToken: "t", options: {} })).toBe(true);
    expect(needsSecondStep({ token: "t", user: {} })).toBe(false);
    expect(needsSecondStep(null)).toBe(false);
  });

  it("explain a dismissed prompt without blaming the person", () => {
    expect(passkeyErrorMessage({ name: "NotAllowedError" })).toMatch(/closed or timed out/);
    expect(passkeyErrorMessage({ name: "InvalidStateError" })).toMatch(/already has a passkey/);
    expect(passkeyErrorMessage(new Error("That passkey didn't match this account."))).toBe("That passkey didn't match this account.");
  });

  it("name a new passkey after where it lives", () => {
    expect(suggestPasskeyName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36")).toBe("Chrome on Mac");
    expect(suggestPasskeyName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(suggestPasskeyName("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0")).toBe("Edge on Windows");
  });

  it("write recovery codes out one per line under what they are", () => {
    const text = recoveryCodesFile(["AAAAA-BBBBB", "CCCCC-DDDDD"], "ada@example.com");
    expect(text.split("\n")).toEqual(["Space Transfers recovery codes for ada@example.com", "Each code signs you in once if you can't use your passkey.", "", "AAAAA-BBBBB", "CCCCC-DDDDD", ""]);
  });
});
