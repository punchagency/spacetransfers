import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { apiFetch } from "../../utils/api";

/**
 * Global retail pricing — the rates the customer is charged.
 *
 * Bound to `GET/PATCH /admin/pricing/global`. The previous version of this tab
 * was a static mockup of platform name / timezone / currency / order-prefix
 * fields, none of which have any server-side counterpart; those controls looked
 * functional and silently discarded every edit. Replaced with the settings the
 * API actually stores.
 */

interface PackagingBand {
  maxSqFt: number | null;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  tareLb: number;
}

interface GlobalPricing {
  baseRatePerSqFt: number;
  /** The roll every gang sheet is cut from, and the shortest run that can be billed. */
  sheetWidthIn: number;
  minSheetLengthIn: number;
  shipping: { standard: number; express: number };
  shippingMarkupPct: number;
  rushSurchargePct: number;
  partnerDefaults: { baseRatePerSqFt: number; rushPct: number; specialInkFlat: number };
  packaging: { weightPerSqFtLb: number; bands: PackagingBand[] };
  taxRatePct: number;
}

const FALLBACK: GlobalPricing = {
  baseRatePerSqFt: 3.5,
  sheetWidthIn: 23.5,
  minSheetLengthIn: 10,
  shipping: { standard: 8.99, express: 24.99 },
  shippingMarkupPct: 10,
  rushSurchargePct: 10,
  partnerDefaults: { baseRatePerSqFt: 2.5, rushPct: 10, specialInkFlat: 5 },
  packaging: {
    weightPerSqFtLb: 0.08,
    bands: [
      { maxSqFt: 6, lengthIn: 26, widthIn: 4, heightIn: 4, tareLb: 0.35 },
      { maxSqFt: 24, lengthIn: 26, widthIn: 6, heightIn: 6, tareLb: 0.6 },
      { maxSqFt: null, lengthIn: 26, widthIn: 9, heightIn: 9, tareLb: 1.0 },
    ],
  },
  taxRatePct: 8,
};

const inputClass =
  "w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-gray-400";

export const GeneralSettings = () => {
  const [pricing, setPricing] = useState<GlobalPricing>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch("/admin/pricing/global");
        if (cancelled) return;
        setPricing({
          baseRatePerSqFt: Number(data?.baseRatePerSqFt ?? FALLBACK.baseRatePerSqFt),
          sheetWidthIn: Number(data?.sheetWidthIn ?? FALLBACK.sheetWidthIn),
          minSheetLengthIn: Number(data?.minSheetLengthIn ?? FALLBACK.minSheetLengthIn),
          shipping: {
            standard: Number(data?.shipping?.standard ?? FALLBACK.shipping.standard),
            express: Number(data?.shipping?.express ?? FALLBACK.shipping.express),
          },
          shippingMarkupPct: Number(data?.shippingMarkupPct ?? FALLBACK.shippingMarkupPct),
          rushSurchargePct: Number(data?.rushSurchargePct ?? FALLBACK.rushSurchargePct),
          partnerDefaults: {
            baseRatePerSqFt: Number(data?.partnerDefaults?.baseRatePerSqFt ?? FALLBACK.partnerDefaults.baseRatePerSqFt),
            rushPct: Number(data?.partnerDefaults?.rushPct ?? FALLBACK.partnerDefaults.rushPct),
            specialInkFlat: Number(data?.partnerDefaults?.specialInkFlat ?? FALLBACK.partnerDefaults.specialInkFlat),
          },
          packaging: {
            weightPerSqFtLb: Number(
              data?.packaging?.weightPerSqFtLb ?? FALLBACK.packaging.weightPerSqFtLb,
            ),
            bands: Array.isArray(data?.packaging?.bands) && data.packaging.bands.length > 0
              ? data.packaging.bands
              : FALLBACK.packaging.bands,
          },
          taxRatePct: Number(data?.taxRatePct ?? FALLBACK.taxRatePct),
        });
      } catch (error: any) {
        if (!cancelled) toast.error(error.message || "Could not load pricing");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    // Guard before the request so a typo becomes a message, not a NaN written
    // to the settings document that every quote then reads back.
    const values = [
      pricing.baseRatePerSqFt,
      pricing.shipping.standard,
      pricing.shipping.express,
      pricing.shippingMarkupPct,
      pricing.rushSurchargePct,
      pricing.partnerDefaults.baseRatePerSqFt,
      pricing.partnerDefaults.rushPct,
      pricing.partnerDefaults.specialInkFlat,
      pricing.packaging.weightPerSqFtLb,
      pricing.taxRatePct,
    ];
    if (values.some((v) => !Number.isFinite(v) || v < 0)) {
      toast.error("Every rate must be a number of zero or more.");
      return;
    }

    setSaving(true);
    try {
      await apiFetch("/admin/pricing/global", {
        method: "PATCH",
        body: JSON.stringify(pricing),
      });
      toast.success("Pricing saved");
    } catch (error: any) {
      toast.error(error.message || "Could not save pricing");
    } finally {
      setSaving(false);
    }
  };

  const numberField = (
    label: string,
    value: number,
    onChange: (n: number) => void,
    hint?: string,
  ) => (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <input
        type="number"
        min="0"
        step="0.01"
        value={Number.isFinite(value) ? value : ""}
        disabled={loading}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={inputClass}
      />
      {hint ? <p className="text-sm text-gray-500">{hint}</p> : null}
    </div>
  );

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Retail Pricing</h2>
        <p className="text-sm text-gray-500 mb-6">
          The rates charged to customers at checkout.
        </p>

        <div className="space-y-6">
          {numberField(
            "Base Rate per sq ft ($)",
            pricing.baseRatePerSqFt,
            (n) => setPricing((p) => ({ ...p, baseRatePerSqFt: n })),
            "Applied to every gang sheet, by area. Changing this changes what the editor quotes and what customers are charged.",
          )}

          {/*
            The two figures that decide how much area a sheet is billed for.
            Both were compiled into the apps: price came from the bounding box
            of the artwork with no minimum at all, so a single 6x10in graphic
            was billed $1.46 of the $5.71 of roll it consumes.
          */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Sheet size</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                A gang sheet is billed as the full roll width by its length, never by the
                area the artwork happens to cover. These also set the parcel a sheet is
                packed and shipped in.
              </p>
            </div>

            {numberField(
              "Roll width (in)",
              pricing.sheetWidthIn,
              (n) => setPricing((p) => ({ ...p, sheetWidthIn: n })),
              "The width of the film you print on. Every sheet is billed this wide whatever the artwork does.",
            )}

            {numberField(
              "Minimum billable length (in)",
              pricing.minSheetLengthIn,
              (n) => setPricing((p) => ({ ...p, minSheetLengthIn: n })),
              "The shortest run worth setting up. A shorter sheet is charged as if it were this long.",
            )}

            <p className="text-xs text-gray-500">
              At the current settings the smallest sheet a customer can buy is{" "}
              <strong>
                {pricing.sheetWidthIn.toFixed(2)}in x {pricing.minSheetLengthIn.toFixed(2)}in
              </strong>{" "}
              ={" "}
              <strong>
                ${(
                  ((pricing.sheetWidthIn * pricing.minSheetLengthIn) / 144) *
                  pricing.baseRatePerSqFt
                ).toFixed(2)}
              </strong>
              .
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Shipping</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                Customers pay what the carrier charges for their parcel, plus your handling
                fee on top.
              </p>
            </div>

            {numberField(
              "Handling fee (%)",
              pricing.shippingMarkupPct,
              (n) => setPricing((p) => ({ ...p, shippingMarkupPct: n })),
              "Added on top of the carrier's price to cover packaging and labour. At 10%, a $9 parcel is charged $9.90.",
            )}

            <div className="pt-1">
              <p className="text-sm font-medium text-gray-700">If the carrier can't be reached</p>
              <p className="text-sm text-gray-500 mt-0.5 mb-3">
                These are only used when the rate lookup fails, so checkout keeps working.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {numberField("Standard ($)", pricing.shipping.standard, (n) =>
                  setPricing((p) => ({ ...p, shipping: { ...p.shipping, standard: n } })),
                )}
                {numberField("Express ($)", pricing.shipping.express, (n) =>
                  setPricing((p) => ({ ...p, shipping: { ...p.shipping, express: n } })),
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Parcel sizes</h3>
              <p className="text-sm text-gray-700 mt-0.5">
                The carrier prices by weight and size, so it needs to know what you're
                actually posting. Bigger sheets go in bigger packaging — one row per size
                of packaging you use.
              </p>
              <p className="text-sm text-gray-700 mt-2">
                <strong className="font-semibold">These numbers are guesses.</strong> Weigh
                and measure a few real parcels and correct them. If you under-declare, the
                carrier charges you the difference after the label is bought.
              </p>
            </div>

            {numberField(
              "Weight of 1 sq ft of film (lb)",
              pricing.packaging.weightPerSqFtLb,
              (n) =>
                setPricing((p) => ({ ...p, packaging: { ...p.packaging, weightPerSqFtLb: n } })),
              "Just the printed sheet, not the packaging.",
            )}

            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Packaging sizes</p>
              {pricing.packaging.bands.map((band, i) => (
                <div
                  key={i}
                  className="grid grid-cols-2 md:grid-cols-5 gap-3 rounded-md border border-amber-200 bg-white p-3"
                >
                  {(
                    [
                      ["Sheets up to (sq ft)", "maxSqFt"],
                      ["Length (in)", "lengthIn"],
                      ["Width (in)", "widthIn"],
                      ["Height (in)", "heightIn"],
                      ["Empty weight (lb)", "tareLb"],
                    ] as const
                  ).map(([label, key]) => (
                    <div key={key} className="space-y-1">
                      <label className="text-xs font-medium text-gray-600">{label}</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={loading}
                        placeholder={key === "maxSqFt" ? "no limit" : undefined}
                        value={band[key] === null || band[key] === undefined ? "" : band[key]}
                        onChange={(e) => {
                          const raw = e.target.value;
                          // Blank in the top band means "and above", so it is
                          // kept as null rather than becoming 0.
                          const next =
                            key === "maxSqFt" && raw.trim() === "" ? null : parseFloat(raw);
                          setPricing((p) => ({
                            ...p,
                            packaging: {
                              ...p.packaging,
                              bands: p.packaging.bands.map((b, j) =>
                                j === i ? { ...b, [key]: next } : b,
                              ),
                            },
                          }));
                        }}
                        className="w-full px-2.5 py-2 bg-white border border-gray-200 rounded-md text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {numberField(
            "Rush surcharge (%)",
            pricing.rushSurchargePct,
            (n) => setPricing((p) => ({ ...p, rushSurchargePct: n })),
            "Added to the subtotal when a customer picks Express Shipping, which puts their job at the front of the partner's queue. Covers the rush the partner is paid — express shipping itself only pays the courier.",
          )}

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">New partner defaults</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                What a partner is paid when they are first added. Each partner&rsquo;s own
                page can override these — this is only the starting point.
              </p>
            </div>
            {numberField(
              "Partner rate per sq ft ($)",
              pricing.partnerDefaults.baseRatePerSqFt,
              (n) => setPricing((p) => ({ ...p, partnerDefaults: { ...p.partnerDefaults, baseRatePerSqFt: n } })),
              `Your cost. Against the $${pricing.baseRatePerSqFt.toFixed(2)} retail rate above, this leaves $${(pricing.baseRatePerSqFt - pricing.partnerDefaults.baseRatePerSqFt).toFixed(2)} per sq ft before shipping.`,
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {numberField(
                "Partner rush uplift (%)",
                pricing.partnerDefaults.rushPct,
                (n) => setPricing((p) => ({ ...p, partnerDefaults: { ...p.partnerDefaults, rushPct: n } })),
                "Extra paid to the partner on an urgent job.",
              )}
              {numberField(
                "Special ink fee ($)",
                pricing.partnerDefaults.specialInkFlat,
                (n) => setPricing((p) => ({ ...p, partnerDefaults: { ...p.partnerDefaults, specialInkFlat: n } })),
                "Flat amount added when an adjustment names special ink.",
              )}
            </div>
          </div>

          {numberField(
            "Tax Rate (%)",
            pricing.taxRatePct,
            (n) => setPricing((p) => ({ ...p, taxRatePct: n })),
            "Interim: one flat rate on every US order, ignoring the destination. To be replaced by Stripe Tax, which charges each state's real rate — this field goes away then.",
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={loading || saving}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
};
