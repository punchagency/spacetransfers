import { afterEach, describe, expect, it } from "vitest";
import { listProviders, registerProvider, runAiEdit, unregisterProvider } from "../components/artboard/lib/ai/registry";
import type { AiEditProvider } from "../components/artboard/lib/ai/types";

/**
 * When every provider fails, the customer should hear the built-in provider's
 * specific reason ("couldn't find that red") rather than the model's generic
 * "no model could complete this edit", which used to replace it.
 */
const original = listProviders();

const failing = (id: string, priority: number, message: string): AiEditProvider => ({
  id,
  label: id,
  priority,
  supports: (intent) => intent === "remove-color",
  isAvailable: async () => true,
  edit: async () => {
    throw new Error(message);
  },
});

afterEach(() => {
  for (const p of listProviders()) unregisterProvider(p.id);
  for (const p of original) registerProvider(p);
});

describe("AI provider registry errors", () => {
  it("reports the built-in provider's reason over a later model failure", async () => {
    for (const p of listProviders()) unregisterProvider(p.id);
    registerProvider(failing("local", 0, "I couldn't find that red in this image."));
    registerProvider(failing("server", 10, "No image model could complete this edit right now."));
    await expect(runAiEdit({ imageUrl: "x", prompt: "remove the red", intent: "remove-color" })).rejects.toThrow(
      "I couldn't find that red in this image.",
    );
  });

  it("falls back to the last error when no built-in provider ran", async () => {
    for (const p of listProviders()) unregisterProvider(p.id);
    registerProvider(failing("server", 10, "No image model could complete this edit right now."));
    await expect(runAiEdit({ imageUrl: "x", prompt: "remove the red", intent: "remove-color" })).rejects.toThrow(
      "No image model could complete this edit right now.",
    );
  });
});
