import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLiveSession, signJwt, signSessionToken, verifyJwt } from "../utils/jwt.js";
import { isDownloadRequest } from "../middleware/auth.js";
import { fetchStoredArtwork, isStoredArtworkUrl } from "../services/storage.service.js";
import { verifyWebhookSignature } from "../services/easypost.service.js";
import { createHmac } from "node:crypto";
import { loginUser } from "../services/auth.service.js";
import { buildBatchedAdminEmailHtml } from "../services/adminNotifications.service.js";
import { buildNotificationEmailHtml } from "../services/printerNotifications.service.js";

describe("sessions", () => {
  const user = { id: "u1", role: "CUSTOMER", tokenVersion: 2, status: "Active" };

  it("end when the account's token version moves on", () => {
    const payload = verifyJwt(signSessionToken(user));
    assert.equal(payload.tv, 2);
    assert.equal(isLiveSession(payload, user), true);
    assert.equal(isLiveSession(payload, { ...user, tokenVersion: 3 }), false);
  });

  it("issued before versions existed stay valid until the first change", () => {
    const old = verifyJwt(signJwt({ sub: "u1", role: "CUSTOMER" }));
    assert.equal(isLiveSession(old, { status: "Active" }), true);
    assert.equal(isLiveSession(old, { status: "Active", tokenVersion: 1 }), false);
  });

  it("end at once for a suspended or rejected account", () => {
    const payload = verifyJwt(signSessionToken(user));
    for (const status of ["Suspended", "Rejected"]) assert.equal(isLiveSession(payload, { ...user, status }), false, status);
    for (const status of ["Active", "Under Review", "Pending"]) assert.equal(isLiveSession(payload, { ...user, status }), true, status);
  });

  it("are not what a sign-in step token is", () => {
    const step = verifyJwt(signJwt({ sub: "u1", typ: "2fa", challenge: "x" }, "5m"));
    assert.equal(isLiveSession(step, { status: "Active" }), false);
  });

  it("are shorter for an admin", () => {
    const admin = verifyJwt(signSessionToken({ id: "a1", role: "ADMIN" }));
    assert.equal(admin.exp - admin.iat, 24 * 60 * 60);
  });

  it("refuse a token signed with another algorithm or secret", () => {
    assert.equal(verifyJwt("eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ1MSJ9."), null);
    assert.equal(verifyJwt("not-a-token"), null);
  });
});

describe("the session in the address bar", () => {
  it("is read only for the two file downloads a browser saves directly", () => {
    assert.equal(isDownloadRequest("GET", "/api/printer/exports/abc123/file"), true);
    assert.equal(isDownloadRequest("GET", "/api/printer/jobs/abc123/assets/bundle/download"), true);
    assert.equal(isDownloadRequest("POST", "/api/printer/exports/abc123/file"), false);
    for (const path of ["/api/admin/orders", "/api/auth/me", "/api/printer/orders", "/api/customer/orders/1/invoice"]) {
      assert.equal(isDownloadRequest("GET", path), false, path);
    }
  });
});

describe("addresses the server will fetch", () => {
  it("never include one we did not store", async () => {
    for (const url of [
      "http://127.0.0.1:4000/health",
      "http://169.254.169.254/latest/meta-data/",
      "http://st-mongo:27017/",
      "https://evil.example/uploads/x.png",
      "http://localhost/uploads/x.png",
      "file:///etc/passwd",
    ]) {
      assert.equal(isStoredArtworkUrl(url), false, url);
      await assert.rejects(fetchStoredArtwork(url, 1000, "x"), (e: any) => e.statusCode === 400 && e.code === "IMAGE_NOT_STORED", url);
    }
  });

  it("accept a shipping webhook only when EasyPost signed those exact bytes", () => {
    const body = Buffer.from('{"description":"tracker.updated","result":{"object":"Tracker","status":"delivered"}}');
    const sign = (secret: string, bytes: Buffer) => "hmac-sha256-hex=" + createHmac("sha256", Buffer.from(secret.normalize("NFKD"), "utf8")).update(bytes).digest("hex");
    assert.equal(verifyWebhookSignature(body, sign("s3cret", body), "s3cret"), true);
    assert.equal(verifyWebhookSignature(body, sign("other", body), "s3cret"), false, "another secret");
    assert.equal(verifyWebhookSignature(Buffer.from(body.toString().replace("delivered", "in_transit")), sign("s3cret", body), "s3cret"), false, "a changed body");
    assert.equal(verifyWebhookSignature(body, sign("s3cret", body).replace("hmac-sha256-hex=", ""), "s3cret"), false, "no prefix");
    for (const header of [undefined, "", 42]) assert.equal(verifyWebhookSignature(body, header, "s3cret"), false, String(header));
    assert.equal(verifyWebhookSignature(body, sign("s3cret", body), undefined), false, "no secret configured");
    // The secret is normalised, as EasyPost does: a composed and a decomposed é sign alike.
    assert.equal(verifyWebhookSignature(body, sign("caf\u00e9", body), "cafe\u0301"), true);
  });
});

describe("sign-in", () => {
  it("refuses a database operator in place of an email, a password or a role", async () => {
    const refused = (e: any) => e.statusCode === 401 && e.message === "Invalid credentials";
    await assert.rejects(loginUser({ email: { $ne: null } as any, password: "x" }), refused);
    await assert.rejects(loginUser({ email: "a@b.co", password: { $gt: "" } as any }), refused);
    await assert.rejects(loginUser({ email: "a@b.co", password: "x", role: { $ne: "x" } as any }), refused);
  });
});

describe("notification emails", () => {
  const nasty = '<a href="https://evil.example">Click to verify</a><script>x</script>';

  it("keep what a customer typed as text, for admins and partners", () => {
    const admin = buildBatchedAdminEmailHtml({ items: [{ category: "orders", priority: "high", title: nasty, message: nasty, createdAt: new Date() }] } as any);
    const partner = buildNotificationEmailHtml(nasty, nasty);
    for (const html of [admin, partner]) {
      assert.equal(html.includes("<script>"), false);
      assert.equal(html.includes('<a href="https://evil.example">'), false);
      assert.ok(html.includes("&lt;script&gt;"));
    }
  });
});
