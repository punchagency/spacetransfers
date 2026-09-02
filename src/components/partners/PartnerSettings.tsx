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
    /**
     * This partner's warehouse in the client's ShipStation account.
     *
     * Entered by hand because ShipStation only shows the number in the
     * warehouse page's URL. Left blank, the partner's orders are filed under
     * the HQ warehouse — their labels still ship from their own address, but
     * ShipStation's reporting credits the volume to head office.
     */
    const [warehouseId, setWarehouseId] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);
    /*
     * A suspension in progress. The server requires a reason, and a bare toggle
     * cannot collect one — so flipping it off opens this rather than acting
     * immediately. Reinstating needs no justification and still applies at once.
     */
    const [suspending, setSuspending] = useState(false);
    const [suspendReason, setSuspendReason] = useState('');

    useEffect(() => {
        setIsPartnerActive(partnerStatus === 'Active');
    }, [partnerStatus]);

    useEffect(() => {
        if (!settings) return;
        setAutoAccept(settings.jobCapacity?.autoAccept ?? true);
        setWarehouseId(
            settings.shipStationWarehouseId === null || settings.shipStationWarehouseId === undefined
                ? ''
                : String(settings.shipStationWarehouseId),
        );
        setOrderAssignedEmail(settings.notifications?.orderAssigned ?? false);
        setJobCompletedEmail(settings.notifications?.jobCompleted ?? false);
    }, [settings]);

    const persistStatus = async (nextActive: boolean, reason?: string) => {
        setIsSaving(true);
        try {
            const nextStatus = nextActive ? 'Active' : 'Suspended';
            const res = await apiFetch(`/admin/partners/${partnerId}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status: nextStatus, reason }),
            });
            /*
             * Suspension stops all work reaching them and locks them out, so
             * whether the message arrived is part of the outcome. This used to
             * report a flat "Partner status updated" for a change the partner
             * was never told about at all.
             */
            if (res?.notified === false) {
                toast.error(
                    `Status updated, but the partner could not be emailed (${res.notifyError}).`,
                    { duration: 10000 },
                );
            } else {
                toast.success(nextActive ? 'Partner reinstated and notified' : 'Partner suspended and notified');
            }
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
                },
                // Empty clears it, which puts this partner back on the HQ
                // warehouse rather than leaving a stale id in place.
                shipStationWarehouseId: warehouseId.trim() === '' ? null : Number(warehouseId.trim()),
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
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-gray-900">ShipStation warehouse ID</label>
                            <input
                                type="number"
                                min="1"
                                step="1"
                                value={warehouseId}
                                onChange={(e) => setWarehouseId(e.target.value)}
                                placeholder="Leave blank to ship under HQ"
                                className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl text-sm font-medium outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            />
                            <p className="text-[13px] text-gray-400 font-medium">
                                The number in the warehouse&rsquo;s ShipStation URL. Without it this
                                partner&rsquo;s orders are reported under head office — labels still ship
                                from their own address either way.
                            </p>
                        </div>

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
                            <Toggle
                                enabled={isPartnerActive}
                                setEnabled={(v) => {
                                    if (!v) {
                                        // Suspending: ask why before anything changes.
                                        setSuspendReason('');
                                        setSuspending(true);
                                        return;
                                    }
                                    setIsPartnerActive(true);
                                    void persistStatus(true);
                                }}
                            />
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

            {suspending && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
                        <div className="p-6">
                            <h3 className="text-lg font-bold text-gray-900">Suspend this partner?</h3>
                            <p className="text-sm text-gray-500 mt-1">
                                They stop receiving new work immediately and cannot sign in. The
                                reason below is emailed to them, and a suspension can be lifted
                                again from this same toggle.
                            </p>

                            <label className="block text-sm font-medium text-gray-700 mt-4">Reason</label>
                            <textarea
                                value={suspendReason}
                                onChange={(e) => setSuspendReason(e.target.value)}
                                rows={4}
                                autoFocus
                                placeholder="e.g. Repeated late fulfilment on assigned jobs"
                                className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            />
                            <p className="text-xs text-gray-400 mt-1">
                                Written to the partner, so keep it something you are happy for
                                them to read.
                            </p>
                        </div>

                        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
                            <button
                                onClick={() => { setSuspending(false); setSuspendReason(''); }}
                                disabled={isSaving}
                                className="flex-1 py-2.5 px-4 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => {
                                    setIsPartnerActive(false);
                                    setSuspending(false);
                                    await persistStatus(false, suspendReason.trim());
                                    setSuspendReason('');
                                }}
                                disabled={isSaving || suspendReason.trim().length < 3}
                                className="flex-1 py-2.5 px-4 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Suspend partner
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
