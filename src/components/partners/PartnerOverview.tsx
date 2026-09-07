import { useState } from 'react';
import toast from 'react-hot-toast';
import { FiBriefcase, FiMail, FiPhone, FiMapPin, FiGlobe, FiUser } from 'react-icons/fi';
import { AvailabilityBadge } from './AvailabilityBadge';
import { apiFetch } from '../../utils/api';
import type { AvailabilityStatus, PartnerDetailsData } from '../../types/partners';

export const PartnerOverview = ({
    partner,
    onAvailabilityChanged,
}: {
    partner: PartnerDetailsData;
    /** Lifted so the page keeps one copy of the partner rather than two. */
    onAvailabilityChanged?: (status: AvailabilityStatus, capacityPaused: boolean) => void;
}) => {
    /*
     * Pausing asks why first, the same way suspending does on the Settings tab
     * — the reason is what the partner is told, and a control that silently
     * takes someone out of rotation leaves them guessing why work stopped.
     * Reopening needs no explanation, so it applies straight away.
     */
    const [pausing, setPausing] = useState(false);
    const [pauseReason, setPauseReason] = useState('');
    const [savingAvailability, setSavingAvailability] = useState(false);

    const setAvailability = async (next: AvailabilityStatus, reason?: string) => {
        setSavingAvailability(true);
        try {
            const res = await apiFetch(`/admin/partners/${partner.id}/availability`, {
                method: 'PATCH',
                body: JSON.stringify({ status: next, reason: reason?.trim() || undefined }),
            });
            onAvailabilityChanged?.(
                res.availabilityStatus === 'paused' ? 'paused' : 'open',
                Boolean(res.capacityPaused),
            );
            /*
             * The server reports whether the partner's in-app notification was
             * actually created. Saying "partner notified" when they were not is
             * how an admin ends up believing a conversation happened.
             */
            if (res.notified) {
                toast.success(
                    next === 'paused' ? 'Partner paused and notified' : 'Partner set to Open and notified',
                );
            } else {
                toast.success(
                    `${next === 'paused' ? 'Partner paused' : 'Partner set to Open'} — not notified (${res.notifyError || 'notification not delivered'})`,
                    { duration: 6000 },
                );
            }
        } catch (error: any) {
            toast.error(error.message || 'Failed to update availability');
        } finally {
            setSavingAvailability(false);
        }
    };

    /*
     * Capacity, supported sheet sizes, shipping carriers and supported formats
     * were removed from this page. None of them affected anything: nothing
     * filters assignment on a sheet size or a format, and the carrier line was
     * a hard-coded "N/A". They read as commitments the platform was honouring
     * and it was honouring none of them.
     */
    const sampleNote =
        partner.performanceSampleSize && partner.performanceSampleSize > 0
            ? `Across ${partner.performanceSampleSize} completed order${partner.performanceSampleSize === 1 ? '' : 's'}`
            : undefined;
    return (
        /*
         * Company Information on the left, the two short cards stacked on the
         * right. As a flat two-column grid, System Status — now four lines after
         * the unused fields went — sat alone in a full-height cell with
         * Performance dropped below it, leaving a large hole in the middle of
         * the page. `items-start` keeps each card its own height rather than
         * stretching to match the tallest in the row.
         */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Company Information */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
                <h2 className="text-md font-bold text-gray-900">Company Information</h2>
                <div className="space-y-4">
                    <div className="flex gap-4">
                        <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center text-gray-400 shrink-0">
                            <FiBriefcase className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-[12px] text-gray-400 font-medium">Business Name</p>
                            <p className="text-sm font-semibold text-gray-900">{partner.companyName}</p>
                        </div>
                    </div>

                    {/*
                      The person, as distinct from the business. The partner can
                      edit this from their own profile and it was rendered
                      nowhere here — an admin ringing a partner had the company
                      name and no idea who they were asking for.
                    */}
                    <div className="flex gap-4">
                        <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center text-gray-400 shrink-0">
                            <FiUser className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-[12px] text-gray-400 font-medium">Contact Name</p>
                            <p className="text-sm font-semibold text-gray-900">{partner.contactName || 'N/A'}</p>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center text-gray-400 shrink-0">
                            <FiMail className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-[12px] text-gray-400 font-medium">Email</p>
                            <p className="text-sm font-semibold text-gray-900">{partner.email}</p>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center text-gray-400 shrink-0">
                            <FiPhone className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-[12px] text-gray-400 font-medium">Phone</p>
                            <p className="text-sm font-semibold text-gray-900">{partner.phone}</p>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center text-gray-400 shrink-0">
                            <FiMapPin className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-[12px] text-gray-400 font-medium">Address</p>
                            {(() => {
                              /*
                               * This was the literal string "N/A", never wired
                               * to anything — so a partner who supplied a full
                               * address at signup was shown as having none.
                               */
                              const a = partner.address;
                              const lines = a
                                ? [a.street, [a.city, a.state].filter(Boolean).join(", "), a.postalCode]
                                    .filter((part) => part && String(part).trim())
                                : [];
                              if (lines.length === 0) {
                                return (
                                  <p
                                    className="text-sm font-semibold text-amber-700"
                                    title="Without an address we cannot work out a shipping origin, and their labels declare the wrong one."
                                  >
                                    No address on file
                                  </p>
                                );
                              }
                              return (
                                <p className="text-sm font-semibold text-gray-900">
                                  {lines.join(" · ")}
                                </p>
                              );
                            })()}
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center text-gray-400 shrink-0">
                            <FiGlobe className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-[12px] text-gray-400 font-medium">Website</p>
                            <p className="text-sm font-semibold text-gray-900">{partner.website || 'N/A'}</p>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center text-gray-400 shrink-0">
                            <FiMapPin className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-[12px] text-gray-400 font-medium mb-2">Regions Covered</p>
                            <div className="flex flex-wrap gap-2">
                                {partner.regions.map(region => (
                                    <span key={region} className="px-3 py-1 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-500">
                                        {region}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-6">
            {/* System Status */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6 h-fit">
                <h2 className="text-md font-bold text-gray-900">System Status</h2>
                <div className="space-y-6">
                    <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-500">Status</span>
                        <span className={`px-3 py-1 rounded-full text-[12px] font-bold border ${partner.status === 'Active' ? 'bg-green-50 text-green-600 border-green-100' : partner.status === 'Suspended' ? 'bg-red-50 text-red-600 border-red-100' : partner.status === 'Rejected' ? 'bg-gray-100 text-gray-500 border-gray-200' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                            {partner.status}
                        </span>
                        {(() => {
                          /*
                           * Why they are in this state. Only shown when the
                           * latest change carried a reason — an approval or a
                           * reinstatement needs no explanation, and printing
                           * "(no reason)" beside every partner would train
                           * people to stop reading it.
                           */
                          const latest = partner.statusHistory?.[0];
                          if (!latest?.reason) return null;
                          return (
                            <span
                              className="block text-[11px] text-gray-500 mt-1.5 max-w-xs"
                              title={`${latest.from || "—"} → ${latest.to}${latest.by ? ` by ${latest.by}` : ""}${latest.notified ? "" : " · partner was not emailed"}`}
                            >
                              {latest.reason}
                              {latest.by ? ` — ${latest.by}` : ""}
                              {latest.notified === false && (
                                <span className="text-amber-700"> · not emailed</span>
                              )}
                            </span>
                          );
                        })()}
                    </div>

                    {/*
                      Availability, beside account status because the two are
                      constantly confused and mean different things: Status
                      decides whether they may work at all, this decides whether
                      the assigner is currently routing to them. Shown only for
                      an Active partner — for anyone else it decides nothing.
                    */}
                    {partner.status === 'Active' && (
                        <div className="pt-4 border-t border-gray-100 space-y-3">
                            <div className="flex justify-between items-center gap-3">
                                <div>
                                    <span className="text-sm font-medium text-gray-500">Availability</span>
                                    <p className="text-[11px] text-gray-400 mt-0.5">
                                        {partner.availabilityStatus === 'paused'
                                            ? 'Not receiving auto-assigned orders'
                                            : 'Receiving auto-assigned orders'}
                                    </p>
                                </div>
                                <AvailabilityBadge
                                    status={partner.availabilityStatus}
                                    capacityPaused={partner.capacityPaused}
                                />
                            </div>

                            {partner.availabilityStatus === 'paused' && partner.capacityPaused && (
                                <p className="text-[11px] text-amber-700">
                                    Paused by the capacity monitor, not by a person. It clears itself once
                                    one of their active jobs finishes.
                                </p>
                            )}

                            {!pausing ? (
                                <button
                                    type="button"
                                    disabled={savingAvailability}
                                    onClick={() => {
                                        if (partner.availabilityStatus === 'paused') {
                                            void setAvailability('open');
                                            return;
                                        }
                                        setPauseReason('');
                                        setPausing(true);
                                    }}
                                    className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 transition-colors disabled:opacity-60"
                                >
                                    {savingAvailability
                                        ? 'Saving…'
                                        : partner.availabilityStatus === 'paused'
                                          ? 'Set back to Open'
                                          : 'Pause this partner'}
                                </button>
                            ) : (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                                    <p className="text-[11px] text-gray-700 leading-relaxed">
                                        They stop receiving auto-assigned orders. Jobs already assigned to
                                        them are unaffected, and their account stays Active. The reason
                                        below is sent to them.
                                    </p>
                                    <textarea
                                        value={pauseReason}
                                        onChange={(e) => setPauseReason(e.target.value)}
                                        rows={2}
                                        placeholder="Why are you pausing them? (optional)"
                                        className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white text-xs text-gray-900 outline-none focus:border-amber-400"
                                    />
                                    <div className="flex gap-2 justify-end">
                                        <button
                                            type="button"
                                            onClick={() => { setPausing(false); setPauseReason(''); }}
                                            className="px-3 py-1.5 rounded-lg text-xs font-bold text-gray-600 hover:bg-white transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            disabled={savingAvailability}
                                            onClick={async () => {
                                                await setAvailability('paused', pauseReason);
                                                setPausing(false);
                                                setPauseReason('');
                                            }}
                                            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors disabled:opacity-60"
                                        >
                                            {savingAvailability ? 'Pausing…' : 'Pause partner'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Performance */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6 h-fit">
                <h2 className="text-md font-bold text-gray-900">Performance</h2>
                <div className="space-y-6">
                    <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-500">Total Orders Completed</span>
                        <span className="text-sm font-bold text-gray-900">{partner.ordersCompleted.toLocaleString()}</span>
                    </div>
                    {/*
                      Both of these read a hard-coded "N/A". The data to compute
                      them was already stored — when the partner was given the
                      job, when it shipped, and the deadline they were held to.
                      Still "no data yet" until they have finished something,
                      but now it means that rather than being a placeholder.
                    */}
                    <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-500">Average Production Time</span>
                        {typeof partner.averageProductionHours === 'number' ? (
                            <span className="text-sm font-bold text-gray-900" title={sampleNote}>
                                {partner.averageProductionHours < 24
                                    ? `${partner.averageProductionHours} hrs`
                                    : `${(partner.averageProductionHours / 24).toFixed(1)} days`}
                            </span>
                        ) : (
                            <span className="text-sm font-medium text-gray-400">No completed jobs yet</span>
                        )}
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-500">On-Time Delivery Rate</span>
                        {typeof partner.onTimeDeliveryRate === 'number' ? (
                            <span
                                className={`text-sm font-bold ${partner.onTimeDeliveryRate >= 90 ? 'text-gray-900' : 'text-amber-600'}`}
                                title={sampleNote}
                            >
                                {partner.onTimeDeliveryRate}%
                            </span>
                        ) : (
                            <span className="text-sm font-medium text-gray-400">No completed jobs yet</span>
                        )}
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-500">Rating</span>
                        <span className="text-sm font-bold text-gray-900">{partner.rating.toFixed(1)}</span>
                    </div>
                </div>
            </div>
            </div>
        </div>
    );
};
