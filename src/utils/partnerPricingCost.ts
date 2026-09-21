const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

export const computePartnerCostBreakdown = ({
  items,
  partnerPricing,
  priority,
  adjustments,
}: {
  items: any[];
  partnerPricing: any;
  priority: string | null | undefined;
  adjustments: any[];
}) => {
  const baseRatePerSqFt =
    typeof partnerPricing?.baseRatePerSqFt === "number" && Number.isFinite(partnerPricing.baseRatePerSqFt)
      ? partnerPricing.baseRatePerSqFt
      : // Unreachable for any partner created through the console or by
        // self-registration; both write the configured rate. Kept so a payout
        // is never silently zero if a document somehow has none.
        2.5;

  const tiers = Array.isArray(partnerPricing?.tiered) ? partnerPricing.tiered : [];
  const surchargesCfg = partnerPricing?.surcharges || {};
  const rushPct = typeof surchargesCfg.rushPct === "number" ? surchargesCfg.rushPct : 0;
  const specialInkFlat = typeof surchargesCfg.specialInkFlat === "number" ? surchargesCfg.specialInkFlat : 0;

  /**
   * Exact area, unrounded.
   *
   * This used to be rounded to two decimals before anything was priced, which
   * quietly changed the amount paid: a 23.5in x 23.5in sheet is 3.835069 sq ft,
   * became 3.84, and at $2.50/sq ft was billed $9.60 instead of $9.59. Money is
   * now rounded once, at the end — area is not a currency and rounding it early
   * moves the payout in whichever direction the third decimal happens to fall.
   *
   * Tier selection uses the exact figure too, so a sheet just under a boundary
   * is not rounded up into a different rate.
   */
  const exactSqFt =
    (Array.isArray(items) ? items : []).reduce((sum: number, it: any) => {
      const w =
        typeof it?.sheetWidthIn === "number"
          ? it.sheetWidthIn
          : typeof it?.widthIn === "number"
            ? it.widthIn
            : null;
      const h =
        typeof it?.sheetHeightIn === "number"
          ? it.sheetHeightIn
          : typeof it?.heightIn === "number"
            ? it.heightIn
            : null;
      const qty = typeof it?.quantity === "number" ? it.quantity : 1;
      if (!w || !h) return sum;
      const sqft = (Number(w) * Number(h)) / 144;
      if (!Number.isFinite(sqft) || sqft <= 0) return sum;
      return sum + sqft * Math.max(1, qty);
    }, 0);

  // Returned for display only — never used to compute money.
  const totalSqFt = roundMoney(exactSqFt);

  const appliedTier = tiers.find((t: any) => {
    const min = typeof t?.minSqFt === "number" ? t.minSqFt : 0;
    const max = t?.maxSqFt == null ? null : Number(t.maxSqFt);
    const okMin = exactSqFt >= min;
    const okMax = max == null ? true : exactSqFt < max;
    return okMin && okMax;
  });

  const appliedRatePerSqFt =
    appliedTier && typeof appliedTier?.rate === "number" ? Number(appliedTier.rate) : baseRatePerSqFt;

  const base = roundMoney(Math.max(0, exactSqFt * appliedRatePerSqFt));

  const storedAdjustments = Array.isArray(adjustments) ? adjustments : [];
  const hasSpecialInk = storedAdjustments.some((a: any) => {
    const r = String(a?.reason || "").toLowerCase();
    return r.includes("special ink") || r.includes("specialink");
  });

  const isRush = String(priority || "").toUpperCase() === "URGENT";
  const rushFee = isRush ? roundMoney((base * rushPct) / 100) : 0;
  const specialInkFee = hasSpecialInk ? roundMoney(specialInkFlat) : 0;
  const surcharges = roundMoney(Math.max(0, rushFee + specialInkFee));
  const subtotal = roundMoney(Math.max(0, base + surcharges));

  return {
    totalSqFt,
    appliedRatePerSqFt,
    base,
    rushFee,
    specialInkFee,
    surcharges,
    subtotal,
  };
};

