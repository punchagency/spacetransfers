/**
 * Retrying a call to an outside service.
 *
 * Only failures that could come out differently next time are retried: a
 * timeout, a network error, a 5xx, 408 or 429. A 4xx is the service's answer
 * about the request or the account (a lapsed bill, bad keys, a bad address) and
 * comes back the same every time, so retrying it only delays the outcome.
 * Errors carry their status as "→ HTTP 402" in the message, or as `status`.
 */
export const isRetryable = (err: unknown): boolean => {
  const fromField = Number((err as any)?.status);
  const status = Number.isFinite(fromField) && fromField > 0
    ? fromField
    : Number(/→ HTTP (\d{3})/.exec(String((err as any)?.message ?? ""))?.[1]);
  if (!Number.isFinite(status)) return true;
  return status >= 500 || status === 408 || status === 429;
};

export async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number, initialDelayMs: number, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) break;
      if (attempt < maxAttempts) {
        // Exponential backoff with jitter, so concurrent retries don't collide.
        const delay = initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
        console.warn(`[RETRY:${label}] attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(delay)}ms: ${(err as any)?.message ?? err}`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
