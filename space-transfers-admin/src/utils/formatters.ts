export const currency = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD" });
