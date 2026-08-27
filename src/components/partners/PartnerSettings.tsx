import { useEffect, useState } from 'react';
import { REGIONS } from '../../utils/regions';
import { Toggle } from '../common/Toggle';
import toast from 'react-hot-toast';
import { apiFetch } from '../../utils/api';
import type { PartnerSettingsApi } from '../../types/partners';

export const PartnerSettings = ({
    partnerId,
    partnerStatus,
    partnerRegions,
    settings,
    onUpdated
}: {
    partnerId: string;
    partnerStatus: string;
    partnerRegions?: string[];
    settings: PartnerSettingsApi | null;
    onUpdated: (settings: PartnerSettingsApi, nextStatus?: 'Active' | 'Pending' | 'Suspended' | 'Under Review') => void;
}) => {
    const [orderAssignedEmail, setOrderAssignedEmail] = useState(false);
    const [jobCompletedEmail, setJobCompletedEmail] = useState(false);
    const [isPartnerActive, setIsPartnerActive] = useState(partnerStatus === 'Active');
    const [autoAccept, setAutoAccept] = useState(true);
    /**
     * Service areas live here now, with the other things the platform decides.
     *
     * They were the one genuinely admin-owned field on the Edit Partner modal —
     * routing policy rather than the partner's own information — so removing
     * that modal meant they needed a home among the controls an operator
     * already owns: capacity, auto-accept and status.
     */
    const [selectedRegions, setSelectedRegions] = useState<string[]>(partnerRegions ?? []);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setIsPartnerActive(partnerStatus === 'Active');
    }, [partnerStatus]);

    useEffect(() => {
        if (!settings) return;
        setAutoAccept(settings.jobCapacity?.autoAccept ?? true);
        setOrderAssignedEmail(settings.notifications?.orderAssigned ?? false);
        setJobCompletedEmail(settings.notifications?.jobCompleted ?? false);
    }, [settings]);

    const persistStatus = async (nextActive: boolean) => {
        setIsSaving(true);
        try {
            const nextStatus = nextActive ? 'Active' : 'Suspended';
            const res = await apiFetch(`/admin/partners/${partnerId}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status: nextStatus }),
            });
            toast.success('Partner status updated');
            if (settings) onUpdated(settings, res.status);
        } catch (error: any) {
            toast.error(error.message || 'Failed to update status');
            setIsPartnerActive(partnerStatus === 'Active');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const payload: PartnerSettingsApi = {
                jobCapacity: {
                    // Only auto-accept is set here now. The two capacity limits
                    // were removed from the UI, and omitting them leaves any
                    // stored value untouched rather than zeroing it.
                    autoAccept
                },
                notifications: {
                    orderAssigned: orderAssignedEmail,
                    jobCompleted: jobCompletedEmail
                }
            };
            await apiFetch(`/admin/partners/${partnerId}/settings`, {
                method: 'PATCH',
                body: JSON.stringify(payload),
            });
            // Separate endpoint: regions are not part of the settings document.
            await apiFetch(`/admin/partners/${partnerId}`, {
                method: 'PATCH',
                body: JSON.stringify({ regions: selectedRegions }),
            });
            toast.success('Settings saved');
            onUpdated(payload);
        } catch (error: any) {
            toast.error(error.message || 'Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    const toggleRegion = (region: string) =>
        setSelectedRegions((prev) =>
            prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region],
        );

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 space-y-4">
                <div>
                    <h2 className="text-[16px] font-bold text-gray-900">Service Areas</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                        Which regions this partner is offered work from. Assignment tries the
                        customer&rsquo;s own region first and only falls back to another when
                        nobody there can take the job.
                    </p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {REGIONS.map((region) => {
                        const selected = selectedRegions.includes(region);
                        return (
                            <button
                                type="button"
                                key={region}
                                onClick={() => toggleRegion(region)}
                                aria-pressed={selected}
                                className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                                    selected
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                }`}
                            >
                                {region}
                            </button>
                        );
                    })}
                </div>
                {selectedRegions.length === 0 && (
                    <p className="text-xs text-amber-700">
                        With no service area this partner cannot be assigned any work.
                    </p>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Production Settings Card */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 space-y-8">
                    <h2 className="text-[16px] font-bold text-gray-900">Production Settings</h2>

                    <div className="space-y-6">
                        {/*
                          Max Sheets Per Day and Max Concurrent Jobs removed.
                          Concurrency is governed globally by "Maximum Jobs per
                          Partner" in Settings -> Partners, and a per-partner
                          override on top of it was a second limit to keep in
                          step for no benefit. No partner had either set.
                        */}
                        {/* Weekend Availability */}
                        <div className="flex items-center justify-between pt-2">
                            <div className="space-y-0.5">
                                <label className="text-sm font-bold text-gray-900">Auto-Accept Jobs</label>
                                <p className="text-[13px] text-gray-400 font-medium">Automatically accept assigned jobs</p>
                            </div>
                            <Toggle enabled={autoAccept} setEnabled={setAutoAccept} />
                        </div>
                    </div>
                </div>

                {/* Account Settings Card */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 space-y-8 h-fit">
                    <h2 className="text-[16px] font-bold text-gray-900">Account Settings</h2>

                    <div className="space-y-8">
                        {/* Activate/Deactivate */}
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <label className="text-sm font-bold text-gray-900">Activate/Deactivate Partner</label>
                                <p className="text-[13px] text-gray-400 font-medium">Control whether this partner can receive orders</p>
                            </div>
                            <Toggle enabled={isPartnerActive} setEnabled={(v) => { setIsPartnerActive(v); void persistStatus(v); }} />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <label className="text-sm font-bold text-gray-900">Email: Order Assigned</label>
                                <p className="text-[13px] text-gray-400 font-medium">Notify partner when a new job is assigned</p>
                            </div>
                            <Toggle enabled={orderAssignedEmail} setEnabled={setOrderAssignedEmail} />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <label className="text-sm font-bold text-gray-900">Email: Job Updates</label>
                                <p className="text-[13px] text-gray-400 font-medium">Notify partner when job updates occur</p>
                            </div>
                            <Toggle enabled={jobCompletedEmail} setEnabled={setJobCompletedEmail} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4">
                <button
                    disabled={isSaving}
                    onClick={handleSave}
                    className="bg-blue-600 text-white px-8 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors shadow-md disabled:opacity-60 disabled:hover:bg-blue-600"
                >
                    Save Settings
                </button>
            </div>
        </div>
    );
};
