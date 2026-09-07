import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { errorHandler, type CustomError } from "../middleware/error.js";

/**
 * A third-party's HTTP status must never be returned as if it were ours.
 *
 * Every client's `apiFetch` reads a 401 as a dead session and calls
 * `clearAuth()`. Stripe with an unset key answers 401 "Invalid API Key
 * provided: sk_test_*******lder", that error carries its own `statusCode`, and
 * the handler passed it straight through — so pressing "Connect Stripe account"
 * signed the partner out of a session that was never invalid, and handed them a
 * fragment of our key on the way.
 *
 * `assertStripeConfigured` now blocks the specific call that caused it, but this
 * is the backstop for every other Stripe call site (payout transfers, account
 * reads) and for whatever SDK is added next.
 */

const fakeReq = { method: "POST", originalUrl: "/api/payouts/printer/connect" } as unknown as Request;

const capture = () => {
  const out: { status?: number; body?: any } = {};
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: any) {
      out.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, out };
};

/** Shaped like a real `StripeAuthenticationError`. */
const stripeAuthError = () => {
  const e = new Error("Invalid API Key provided: sk_test_*******lder") as any;
  e.type = "StripeAuthenticationError";
  e.rawType = "invalid_request_error";
  e.statusCode = 401;
  e.raw = { message: "Invalid API Key provided: sk_test_*******lder" };
  return e as CustomError;
};

describe("upstream SDK failures", () => {
  it("does not return a payment provider's 401 as our own", () => {
    const { res, out } = capture();
    errorHandler(stripeAuthError(), fakeReq, res, () => {});
    assert.notEqual(out.status, 401, "a 401 here signs the user out of a valid session");
    assert.equal(out.status, 502);
  });

  it("does not leak the upstream's message, which named our key", () => {
    const { res, out } = capture();
    errorHandler(stripeAuthError(), fakeReq, res, () => {});
    assert.doesNotMatch(String(out.body?.message), /sk_test|API Key|Stripe/i);
  });

  it("still lets our own deliberate 401 through, so a dead session logs out", () => {
    const { res, out } = capture();
    const ours = new Error("Unauthorized") as CustomError;
    ours.statusCode = 401;
    errorHandler(ours, fakeReq, res, () => {});
    assert.equal(out.status, 401);
    assert.equal(out.body?.message, "Unauthorized");
  });

  it("still lets our own deliberate 4xx messages through", () => {
    const { res, out } = capture();
    const ours = new Error("Enter a valid phone number") as CustomError;
    ours.statusCode = 400;
    errorHandler(ours, fakeReq, res, () => {});
    assert.equal(out.status, 400);
    assert.equal(out.body?.message, "Enter a valid phone number");
  });

  it("catches a Stripe error even when it carries no statusCode", () => {
    const { res, out } = capture();
    const e = new Error("Request failed") as any;
    e.type = "StripeConnectionError";
    errorHandler(e, fakeReq, res, () => {});
    assert.equal(out.status, 502, "otherwise it degrades to a generic 500 and hides the cause");
  });

  it("leaves an ordinary unhandled error as a generic 500", () => {
    const { res, out } = capture();
    errorHandler(new Error("Cast to ObjectId failed") as CustomError, fakeReq, res, () => {});
    assert.equal(out.status, 500);
    assert.doesNotMatch(String(out.body?.message), /ObjectId/);
  });
});
