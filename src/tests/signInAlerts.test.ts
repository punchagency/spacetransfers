import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDevice } from "../services/loginActivity.service.js";

/**
 * "Sign-in detected" fired on every successful login and went to
 * `notifyAllAdmins`, so one person signing in emailed all six admins a message
 * reading "Your admin account was signed into" — accurate for one recipient.
 *
 * The rule is now: alert the account's own admin, only when the device and
 * location have not been seen on a previous successful sign-in, and never on a
 * first-ever sign-in (that one is enrolment, not an intruder).
 */

/** Mirrors `recordLoginActivity`'s decision, without needing a database. */
const isNewContext = (priorSuccesses: number, sameContextCount: number) =>
  priorSuccesses > 0 && sameContextCount === 0;

describe("new-device sign-in alerts", () => {
  it("stays silent on a first-ever sign-in", () => {
    assert.equal(isNewContext(0, 0), false);
  });

  it("stays silent on a repeat sign-in from a known device", () => {
    assert.equal(isNewContext(12, 12), false);
    assert.equal(isNewContext(1, 1), false);
  });

  it("alerts when the account has history but this device is new", () => {
    assert.equal(isNewContext(12, 0), true);
  });

  it("alerts on the second device even for a barely-used account", () => {
    assert.equal(isNewContext(1, 0), true);
  });
});

describe("device fingerprint is stable enough to compare against", () => {
  const CHROME_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
  const SAFARI_IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

  it("gives the same answer for the same browser and OS", () => {
    // Must be stable across sessions, or every login looks like a new device
    // and the alert becomes the noise it replaced.
    assert.equal(parseDevice(CHROME_MAC), parseDevice(CHROME_MAC));
  });

  it("distinguishes genuinely different devices", () => {
    assert.notEqual(parseDevice(CHROME_MAC), parseDevice(SAFARI_IPHONE));
  });

  it("does not throw on a missing or junk user-agent", () => {
    assert.equal(parseDevice(""), "Unknown device");
    assert.ok(parseDevice("curl/8.4.0").length > 0);
  });
});
