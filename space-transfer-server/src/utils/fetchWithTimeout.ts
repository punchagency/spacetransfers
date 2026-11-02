/**
 * `fetch` with a time limit.
 *
 * The server's calls out — to artwork storage, the shipping carrier — had none, so a
 * stuck service held the request (and the customer's spinner) open until the
 * connection itself gave up, minutes later if ever. Past the limit this throws
 * a 504 whose message can be shown as-is.
 */
export class UpstreamTimeoutError extends Error {
  statusCode = 504;
}

export const fetchWithTimeout = async (
  url: string,
  init: RequestInit = {},
  ms: number,
  what = "That service",
): Promise<Response> => {
  try {
    return await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(ms) });
  } catch (error: any) {
    if (error?.name === "TimeoutError") {
      throw new UpstreamTimeoutError(`${what} took too long to respond. Please try again in a moment.`);
    }
    throw error;
  }
};
