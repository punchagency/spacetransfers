import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getDefaultAdminNotificationPrefs,
  isAdminCategoryEnabled,
} from "../services/adminNotifications.service.js";

/**
 * System alerts stay on. They were briefly defaulted off because "Sign-in
 * detected" fired on every login and was broadcast to every admin; that was
 * fixed at the source instead, so the category now carries only security
 * notices worth receiving.
 */

describe("admin notification defaults", () => {
  it("keeps system alerts on, now that the category is not just login noise", () => {
    assert.equal(getDefaultAdminNotificationPrefs().systemAlerts, true);
    assert.equal(isAdminCategoryEnabled({}, "system"), true);
    assert.equal(isAdminCategoryEnabled(undefined, "system"), true);
  });

  it("keeps the categories admins actually act on switched on", () => {
    assert.equal(isAdminCategoryEnabled({}, "orders"), true);
    assert.equal(isAdminCategoryEnabled({}, "partners"), true);
  });

  it("honours an explicit opt-out on the categories that default on", () => {
    assert.equal(isAdminCategoryEnabled({ orderUpdates: false }, "orders"), false);
  });

  it("ignores a non-boolean stored value and falls back to the default", () => {
    assert.equal(isAdminCategoryEnabled({ systemAlerts: "yes" }, "system"), true);
    assert.equal(isAdminCategoryEnabled({ orderUpdates: null }, "orders"), true);
  });

  it("honours an explicit opt-out of system alerts", () => {
    assert.equal(isAdminCategoryEnabled({ systemAlerts: false }, "system"), false);
  });
});
