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

interface GlobalPricing {
  baseRatePerSqFt: number;
  shipping: { standard: number; express: number };
  taxRatePct: number;
}

const FALLBACK: GlobalPricing = {
  baseRatePerSqFt: 24,
  shipping: { standard: 8.99, express: 24.99 },
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
          shipping: {
            standard: Number(data?.shipping?.standard ?? FALLBACK.shipping.standard),
            express: Number(data?.shipping?.express ?? FALLBACK.shipping.express),
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
            "Applied to gang sheets that have no saved design price.",
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {numberField("Standard Shipping ($)", pricing.shipping.standard, (n) =>
              setPricing((p) => ({ ...p, shipping: { ...p.shipping, standard: n } })),
            )}
            {numberField("Express Shipping ($)", pricing.shipping.express, (n) =>
              setPricing((p) => ({ ...p, shipping: { ...p.shipping, express: n } })),
            )}
          </div>

          {numberField(
            "Tax Rate (%)",
            pricing.taxRatePct,
            (n) => setPricing((p) => ({ ...p, taxRatePct: n })),
            "Applied to US orders.",
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
