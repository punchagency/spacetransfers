import { getToken } from "./utils/auth";

/** Asks the editor to open sign-in; `detail.what` names what the guest was trying to do. */
export const REQUIRE_ACCOUNT_EVENT = "st:require-account";

/**
 * Tools that run on our servers at a cost (boosting resolution, AI edits) need
 * an account. A guest who reaches for one is shown sign-in and told why,
 * instead of being sent to the server to be refused.
 */
export const requireAccount = (what: string): void => {
  if (getToken()) return;
  window.dispatchEvent(new CustomEvent(REQUIRE_ACCOUNT_EVENT, { detail: { what } }));
  throw new Error(`Sign in to ${what}. Your sheet stays as it is.`);
};
