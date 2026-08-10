import type { AiEditProvider, AiEditRequest, AiEditResult, AiIntentId } from "./types";
import { AiEditAbortedError, NoProviderError } from "./types";
import { localColorProvider, localProvider } from "./providers/local.provider";
import { serverProvider } from "./providers/server.provider";

/**
 * Provider registry + dispatcher.
 *
 * Adding a vendor is `registerProvider(myProvider)` — no UI or hook changes.
 * Providers are tried in ascending `priority` order, skipping any that don't
 * support the intent or aren't currently available.
 */

const providers: AiEditProvider[] = [localProvider, serverProvider, localColorProvider];

export const registerProvider = (provider: AiEditProvider) => {
  const existing = providers.findIndex((p) => p.id === provider.id);
  if (existing >= 0) providers[existing] = provider;
  else providers.push(provider);
};

export const unregisterProvider = (id: string) => {
  const index = providers.findIndex((p) => p.id === id);
  if (index >= 0) providers.splice(index, 1);
};

export const listProviders = (): readonly AiEditProvider[] => [...providers];

const candidatesFor = (intent: AiIntentId) =>
  providers.filter((p) => p.supports(intent)).sort((a, b) => a.priority - b.priority);

/**
 * True when at least one registered provider can serve the intent right now.
 * Used to disable chips whose backing model isn't connected, so the user never
 * clicks into a guaranteed error.
 */
export const canServeIntent = async (intent: AiIntentId): Promise<boolean> => {
  for (const provider of candidatesFor(intent)) {
    try {
      if (await provider.isAvailable()) return true;
    } catch {
      // An unavailable provider is not an error — keep probing the rest.
    }
  }
  return false;
};

/**
 * Runs an edit against the first available provider that supports the intent.
 *
 * A provider that throws is not fatal while another candidate remains — the
 * dispatcher falls through and only surfaces the last error if every candidate
 * fails. Cancellation short-circuits the whole chain immediately.
 */
export const runAiEdit = async (request: AiEditRequest): Promise<AiEditResult> => {
  const candidates = candidatesFor(request.intent);
  let lastError: unknown = null;
  let attempted = false;

  for (const provider of candidates) {
    if (request.signal?.aborted) throw new AiEditAbortedError();

    let available = false;
    try {
      available = await provider.isAvailable();
    } catch {
      available = false;
    }
    if (!available) continue;

    attempted = true;
    try {
      return await provider.edit(request);
    } catch (error) {
      if (error instanceof AiEditAbortedError) throw error;
      lastError = error;
      console.warn(`[AI] provider "${provider.id}" failed — trying next`, error);
    }
  }

  if (!attempted) throw new NoProviderError(request.intent);
  throw lastError instanceof Error ? lastError : new Error("The AI edit failed");
};
