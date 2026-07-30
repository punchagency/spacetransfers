/**
 * Gemini failure classification.
 * Run with: npm test — no network and no API key required.
 *
 * These bodies are real responses captured from the Gemini API, because the
 * distinction they encode is invisible at the status-code level and getting it
 * wrong produced a user-facing bug: a key whose image models have a free-tier
 * allowance of zero was reported as a temporary rate limit, so the UI told the
 * customer to "try again in a moment" about something that could never succeed
 * without an operator enabling billing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyFailure } from "../services/gemini.service.js";

/** A 429 whose quota violation reports a limit of exactly 0 — no free tier. */
const ZERO_QUOTA_BODY = JSON.stringify({
  error: {
    code: 429,
    message:
      "You exceeded your current quota, please check your plan and billing details. " +
      "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, " +
      "limit: 0, model: gemini-2.5-flash-preview-image",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            quotaDimensions: { model: "gemini-2.5-flash-preview-image", location: "global" },
          },
        ],
      },
    ],
  },
});

/** The same prose, but with a real (non-zero) allowance that has been used up. */
const EXHAUSTED_DAILY_BODY = JSON.stringify({
  error: {
    code: 429,
    message:
      "You exceeded your current quota, please check your plan and billing details. " +
      "* Quota exceeded for metric: generate_content_free_tier_requests, limit: 500, " +
      "model: gemini-2.5-flash-image. Quota exceeded for requests per day.",
  },
});

const BURST_BODY = JSON.stringify({
  error: {
    code: 429,
    message: "Resource has been exhausted (e.g. check quota). limit: 10 per minute",
  },
});

const RETIRED_BODY = JSON.stringify({
  error: {
    code: 404,
    message: "This model models/gemini-2.5-flash is no longer available to new users.",
    status: "NOT_FOUND",
  },
});

describe("Gemini failure classification", () => {
  it("reads a zero allowance as needing billing, not as a rate limit", () => {
    // The bug this pins. Both bodies are 429 and share the same opening
    // sentence; only the numeric limit distinguishes "no allowance ever" from
    // "allowance used up", and they need opposite handling.
    assert.equal(classifyFailure(429, ZERO_QUOTA_BODY), "billing_required");
  });

  it("still reads a genuinely exhausted daily allowance as a daily cap", () => {
    assert.equal(classifyFailure(429, EXHAUSTED_DAILY_BODY), "daily_cap");
  });

  it("reads a per-minute burst as a plain rate limit", () => {
    assert.equal(classifyFailure(429, BURST_BODY), "rate_limited");
  });

  it("does not mistake a non-zero limit for a zero one", () => {
    // A naive /limit.*0/ would match "limit: 500" and "limit: 10" on the zero
    // in each number, disabling a perfectly healthy tier for five minutes.
    assert.notEqual(classifyFailure(429, EXHAUSTED_DAILY_BODY), "billing_required");
    assert.notEqual(classifyFailure(429, BURST_BODY), "billing_required");
  });

  it("reads a retired model id as retired, so the fallback list takes over", () => {
    // Surfaces as a 404 that reads like a broken integration; it is really just
    // an expired model name, and the next candidate in the list will work.
    assert.equal(classifyFailure(404, RETIRED_BODY), "retired");
  });

  it("ignores failures that say nothing about availability", () => {
    // A 500 or a malformed request must not park a working model.
    assert.equal(classifyFailure(500, "internal error"), null);
    assert.equal(classifyFailure(400, "invalid argument"), null);
  });

  it("classifies on the quota data rather than the prose", () => {
    // The human-readable sentence is identical between the two 429 cases, so a
    // classifier keying off the message text alone cannot tell them apart.
    const sharedPrefix = "You exceeded your current quota, please check your plan and billing details.";
    assert.ok(ZERO_QUOTA_BODY.includes(sharedPrefix));
    assert.ok(EXHAUSTED_DAILY_BODY.includes(sharedPrefix));
    assert.notEqual(
      classifyFailure(429, ZERO_QUOTA_BODY),
      classifyFailure(429, EXHAUSTED_DAILY_BODY),
    );
  });
});
