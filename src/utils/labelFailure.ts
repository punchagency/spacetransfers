/**
 * Why a label could not be made, in the partner's terms.
 *
 * The raw reason ("ShipStation POST /orders/createorder → HTTP 402") means
 * nothing to a print shop, and most of these are not theirs to fix. It stays
 * visible underneath for whoever they contact.
 */
export const describeLabelFailure = (error: string): { title: string; body: string; theirs: boolean } => {
  if (/\b402\b|payment required/i.test(error)) {
    return {
      title: "The shipping account isn't active",
      body: "No label could be bought because the store's ShipStation account needs attention. That's for Space Transfers to sort out, not you — your job is saved and nothing is lost.",
      theirs: false,
    };
  }
  if (/\b40[13]\b|unauthori[sz]ed|forbidden|credentials/i.test(error)) {
    return {
      title: "The shipping account couldn't be reached",
      body: "ShipStation turned down the store's login. That's for Space Transfers to fix — your job is saved.",
      theirs: false,
    };
  }
  if (/timed? ?out|ETIMEDOUT|ECONNRESET|network|\b50[234]\b/i.test(error)) {
    return {
      title: "ShipStation didn't respond in time",
      body: "This is usually temporary. Wait a minute and try again.",
      theirs: true,
    };
  }
  if (/address/i.test(error)) {
    return {
      title: "The shipping address was rejected",
      body: "The carrier couldn't use the customer's address. Contact Space Transfers so it can be corrected.",
      theirs: false,
    };
  }
  return {
    title: "The shipping label couldn't be created",
    body: "Try again in a moment. If it keeps failing, contact Space Transfers with the details below.",
    theirs: true,
  };
};

