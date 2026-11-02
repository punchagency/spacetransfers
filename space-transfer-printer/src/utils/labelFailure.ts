/**
 * Why a label could not be made, in the partner's terms.
 *
 * The raw reason ("EasyPost POST /shipments → HTTP 402") means nothing to a
 * print shop, and most of these are not theirs to fix. It stays visible
 * underneath for whoever they contact.
 */
export const describeLabelFailure = (error: string): { title: string; body: string; theirs: boolean } => {
  if (/no ship-from address|no business address/i.test(error)) {
    return {
      title: "Your business address is missing",
      body: "Labels ship from your business address. Add it in Profile, then try again.",
      theirs: true,
    };
  }
  if (/reassigned to you/i.test(error)) {
    return {
      title: "This job needs a new label",
      body: "It was moved to you, so the previous partner's label was cancelled. Make one from your address.",
      theirs: true,
    };
  }
  if (/aren't set up|not set up|switched off|EASYPOST_API_KEY/i.test(error)) {
    return {
      title: "Shipping labels aren't available yet",
      body: "The store's shipping account isn't switched on. That's for Space Transfers to sort out. Your job is saved and nothing is lost.",
      theirs: false,
    };
  }
  if (/\b402\b|payment required|insufficient funds/i.test(error)) {
    return {
      title: "The shipping account isn't active",
      body: "No label could be bought because the store's shipping account needs attention. That's for Space Transfers to sort out. Your job is saved and nothing is lost.",
      theirs: false,
    };
  }
  if (/\b40[13]\b|unauthori[sz]ed|forbidden|credentials/i.test(error)) {
    return {
      title: "The shipping account couldn't be reached",
      body: "The shipping service turned down the store's key. That's for Space Transfers to fix. Your job is saved.",
      theirs: false,
    };
  }
  if (/timed? ?out|took too long|ETIMEDOUT|ECONNRESET|network|\b50[0234]\b|\b429\b/i.test(error)) {
    return {
      title: "The shipping service didn't respond in time",
      body: "This is usually temporary. Wait a minute and try again.",
      theirs: true,
    };
  }
  if (/only be made for US|international/i.test(error)) {
    return {
      title: "This order is going abroad",
      body: "Labels can only be made for US addresses here. Contact Space Transfers to arrange shipping.",
      theirs: false,
    };
  }
  if (/address/i.test(error)) {
    return {
      title: "The shipping address was rejected",
      body: "The carrier couldn't use the customer's address. Contact Space Transfers so it can be corrected.",
      theirs: false,
    };
  }
  if (/no carrier offered a rate/i.test(error)) {
    return {
      title: "No carrier could take this parcel",
      body: "Contact Space Transfers with the details below so they can arrange shipping.",
      theirs: false,
    };
  }
  return {
    title: "The shipping label couldn't be created",
    body: "Try again in a moment. If it keeps failing, contact Space Transfers with the details below.",
    theirs: true,
  };
};
