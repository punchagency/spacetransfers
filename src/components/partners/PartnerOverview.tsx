import { FiBriefcase, FiMail, FiPhone, FiMapPin, FiGlobe } from 'react-icons/fi';
import type { PartnerDetailsData } from '../../types/partners';

export const PartnerOverview = ({
    partner,
}: {
    partner: PartnerDetailsData;
}) => {
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
                            <p className="text-sm font-semibold text-gray-400 italic">N/A</p>
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
