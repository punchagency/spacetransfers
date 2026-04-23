import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiFetch } from '../../utils/api';
import type { PartnerPricingApi } from '../../types/partners';

export const PartnerPricing = ({
    partnerId,
    pricing,
    onUpdated
}: {
    partnerId: string;
    pricing: PartnerPricingApi | null;
    onUpdated: (pricing: PartnerPricingApi) => void;
}) => {
    const [loading, setLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [localPricing, setLocalPricing] = useState<PartnerPricingApi | null>(pricing);

    useEffect(() => {
        if (!pricing) {
            setLocalPricing(null);
            return;
        }
        const baseRatePerSqFt =
            typeof pricing.baseRatePerSqFt === 'number' && Number.isFinite(pricing.baseRatePerSqFt)
                ? pricing.baseRatePerSqFt
                : 2.5;
        setLocalPricing({ ...pricing, baseRatePerSqFt });
    }, [pricing]);

    useEffect(() => {
        const fetchPricing = async () => {
            if (localPricing) return;
            setLoading(true);
            try {
                const res = await apiFetch(`/admin/partners/${partnerId}/pricing`);
                const baseRatePerSqFt =
                    typeof res?.baseRatePerSqFt === 'number' && Number.isFinite(res.baseRatePerSqFt)
                        ? res.baseRatePerSqFt
                        : 2.5;
                const normalized = { ...res, baseRatePerSqFt };
                setLocalPricing(normalized);
                onUpdated(normalized);
            } catch (error: any) {
                toast.error(error.message || 'Failed to load partner pricing');
            } finally {
                setLoading(false);
            }
        };
        fetchPricing();
    }, [partnerId, localPricing, onUpdated]);

    const canSave = useMemo(() => {
        if (!localPricing) return false;
        if (!Number.isFinite(localPricing.baseRatePerSqFt) || localPricing.baseRatePerSqFt < 0) return false;
        const rush = localPricing.surcharges?.rushPct;
        const special = localPricing.surcharges?.specialInkFlat;
        if (rush != null && (!Number.isFinite(rush) || rush < 0 || rush > 100)) return false;
        if (special != null && (!Number.isFinite(special) || special < 0)) return false;
        return true;
    }, [localPricing]);

    const updateTier = (idx: number, patch: Partial<{ minSqFt: number; maxSqFt?: number | null; rate: number }>) => {
        setLocalPricing((prev) => {
            if (!prev) return prev;
            const tiered = Array.isArray(prev.tiered) ? [...prev.tiered] : [];
            if (!tiered[idx]) return prev;
            tiered[idx] = { ...tiered[idx], ...patch };
            return { ...prev, tiered };
        });
    };

    const addTier = () => {
        setLocalPricing((prev) => {
            if (!prev) return prev;
            const tiered = Array.isArray(prev.tiered) ? [...prev.tiered] : [];
            tiered.push({ minSqFt: 0, maxSqFt: null, rate: prev.baseRatePerSqFt });
            return { ...prev, tiered };
        });
    };

    const removeTier = (idx: number) => {
        setLocalPricing((prev) => {
            if (!prev) return prev;
            const tiered = Array.isArray(prev.tiered) ? prev.tiered.filter((_, i) => i !== idx) : [];
            return { ...prev, tiered };
        });
    };

    const handleSave = async () => {
        if (!localPricing) return;
        if (!canSave) return;
        setIsSaving(true);
        try {
            const res = await apiFetch(`/admin/partners/${partnerId}/pricing`, {
                method: 'PATCH',
                body: JSON.stringify({
                    baseRatePerSqFt: localPricing.baseRatePerSqFt,
                    tiered: localPricing.tiered,
                    surcharges: localPricing.surcharges,
                }),
            });
            toast.success('Pricing updated');
            onUpdated(res.pricing);
            setLocalPricing(res.pricing);
        } catch (error: any) {
            toast.error(error.message || 'Failed to update pricing');
        } finally {
            setIsSaving(false);
        }
    };

    if (loading || !localPricing) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[220px]">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                <p className="mt-3 text-gray-500 text-sm">Loading pricing...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
                    <h3 className="text-[16px] font-semibold text-gray-900">Base Rate</h3>
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-gray-700">Base Rate Per Sq Ft</label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                            <input
                                type="number"
                                value={localPricing.baseRatePerSqFt}
                                onChange={(e) => setLocalPricing({ ...localPricing, baseRatePerSqFt: Number(e.target.value) })}
                                className="w-full pl-8 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-lg text-sm font-medium text-gray-900 outline-none focus:bg-white focus:border-blue-500 transition-all"
                                min={0}
                                step="0.01"
                            />
                        </div>
                        <p className="text-xs text-gray-400">Used as the default rate when no tier matches.</p>
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
                    <h3 className="text-[16px] font-semibold text-gray-900">Surcharges</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-gray-700">Rush %</label>
                            <input
                                type="number"
                                value={localPricing.surcharges?.rushPct ?? 0}
                                onChange={(e) => setLocalPricing({ ...localPricing, surcharges: { ...(localPricing.surcharges || { rushPct: 0, specialInkFlat: 0 }), rushPct: Number(e.target.value) } })}
                                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-lg text-sm font-medium text-gray-900 outline-none focus:bg-white focus:border-blue-500 transition-all"
                                min={0}
                                max={100}
                                step="1"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-gray-700">Special Ink Flat ($)</label>
                            <input
                                type="number"
                                value={localPricing.surcharges?.specialInkFlat ?? 0}
                                onChange={(e) => setLocalPricing({ ...localPricing, surcharges: { ...(localPricing.surcharges || { rushPct: 0, specialInkFlat: 0 }), specialInkFlat: Number(e.target.value) } })}
                                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-lg text-sm font-medium text-gray-900 outline-none focus:bg-white focus:border-blue-500 transition-all"
                                min={0}
                                step="0.01"
                            />
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-[16px] font-semibold text-gray-900">Tiered Rates</h3>
                        <button
                            onClick={addTier}
                            className="text-blue-600 text-sm font-bold hover:underline"
                            type="button"
                        >
                            + Add Tier
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 border-b border-gray-100">
                                <tr className="text-[12px] font-bold text-gray-900 uppercase tracking-wider">
                                    <th className="px-4 py-3">Min Sq Ft</th>
                                    <th className="px-4 py-3">Max Sq Ft</th>
                                    <th className="px-4 py-3">Rate ($/sqft)</th>
                                    <th className="px-4 py-3 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {(localPricing.tiered || []).map((tier, idx) => (
                                    <tr key={idx} className="text-sm">
                                        <td className="px-4 py-3">
                                            <input
                                                type="number"
                                                value={tier.minSqFt}
                                                min={0}
                                                step="0.01"
                                                onChange={(e) => updateTier(idx, { minSqFt: Number(e.target.value) })}
                                                className="w-28 px-3 py-2 bg-gray-50 border border-gray-100 rounded-lg text-sm font-medium text-gray-900 outline-none focus:bg-white focus:border-blue-500 transition-all"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="number"
                                                value={tier.maxSqFt ?? ''}
                                                min={0}
                                                step="0.01"
                                                onChange={(e) => updateTier(idx, { maxSqFt: e.target.value === '' ? null : Number(e.target.value) })}
                                                className="w-28 px-3 py-2 bg-gray-50 border border-gray-100 rounded-lg text-sm font-medium text-gray-900 outline-none focus:bg-white focus:border-blue-500 transition-all"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="number"
                                                value={tier.rate}
                                                min={0}
                                                step="0.01"
                                                onChange={(e) => updateTier(idx, { rate: Number(e.target.value) })}
                                                className="w-28 px-3 py-2 bg-gray-50 border border-gray-100 rounded-lg text-sm font-medium text-gray-900 outline-none focus:bg-white focus:border-blue-500 transition-all"
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                type="button"
                                                className="text-red-500 hover:text-red-600 text-xs font-bold"
                                                onClick={() => removeTier(idx)}
                                            >
                                                Remove
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {(!localPricing.tiered || localPricing.tiered.length === 0) && (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400 italic">
                                            No tiers configured
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="flex justify-end pt-2">
                <button
                    onClick={handleSave}
                    disabled={!canSave || isSaving}
                    className="bg-blue-600 text-white px-8 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors shadow-md disabled:opacity-60 disabled:hover:bg-blue-600"
                >
                    {isSaving ? 'Saving...' : 'Save Pricing'}
                </button>
            </div>
        </div>
    );
};
