import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { env } from "../config/env.js";
import { editImageWithGemini, GeminiDeclinedError } from "../services/gemini.service.js";

/**
 * A refusal comes back as a 200 with text and no image. It used to be treated
 * like an outage: the same request was re-sent to every other model, and the
 * customer was told "No image model could complete this edit right now" while
 * the model's own explanation went only to the operator log.
 */
describe("Gemini refusals", () => {
  it("stops at the first refusal and keeps the model's explanation", async () => {
    const savedKey = env.geminiApiKey;
    const savedFetch = globalThis.fetch;
    let calls = 0;
    (env as any).geminiApiKey = "test-key";
    globalThis.fetch = (async () => {
      calls++;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "I can't edit images of real people." }] }, finishReason: "STOP" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      await assert.rejects(
        () => editImageWithGemini(Buffer.from("x"), "image/png", "add a hat"),
        (e: any) => e instanceof GeminiDeclinedError && /real people/.test(e.message),
      );
      assert.equal(calls, 1, "a refusal must not be re-sent to the other models");
    } finally {
      (env as any).geminiApiKey = savedKey;
      globalThis.fetch = savedFetch;
    }
  });
});
