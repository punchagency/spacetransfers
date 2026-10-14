import { DashboardLayout } from '../components/layout/DashboardLayout';
import { useCallback, useEffect, useState } from 'react';
import { PartnerHeader } from '../components/partners/PartnerHeader';
import { PartnerOverview } from '../components/partners/PartnerOverview';
import { PartnerOrders } from '../components/partners/PartnerOrders';
import { PartnerSettings } from '../components/partners/PartnerSettings';
import { ResetPasskeys } from '../components/security/ResetPasskeys';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import { useNotificationsStore } from '../state/NotificationsStore';
import toast from 'react-hot-toast';
import type { PartnerDetailsData, PartnerOrderRow, PartnerSettingsApi } from '../types/partners';

export const PartnerDetails = () => {
    const [activeTab, setActiveTab] = useState('Overview');
    const { id } = useParams<{ id: string }>();
    const [partner, setPartner] = useState<PartnerDetailsData | null>(null);
    const [settings, setSettings] = useState<PartnerSettingsApi | null>(null);
    const [orders, setOrders] = useState<PartnerOrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const { subscribeToStream } = useNotificationsStore();
    const tabs = ['Overview', 'Orders', 'Settings'];

    // Hoisted out of the mount effect so the live subscriber below can re-run it.
    const fetchPartner = useCallback(async () => {
        if (!id) return;
        try {
            const p = await apiFetch(`/admin/partners/${id}`);
            setPartner((prev) =>
                prev
                    ? {
                          ...prev,
                          name: String(p.name),
                          companyName: String(p.companyName || p.name),
                          contactName: String(p.contactName || p.name),
                          phone: String(p.phone || 'N/A'),
                          website: p.website,
                          regions: Array.isArray(p.regions) ? p.regions : [],
                          address: p.address ?? null,
                          businessType: p.businessType ?? null,
                      }
                    : prev,
            );
        } catch {
            // A failed refresh leaves the last known good record on screen
            // rather than blanking a page the admin is reading.
        }
    }, [id]);

    useEffect(() => {
        const fetchAll = async () => {
            if (!id) return;
            setLoading(true);
            try {
                const [p, settingsRes, ordersRes] = await Promise.all([
                    apiFetch(`/admin/partners/${id}`),
                    apiFetch(`/admin/partners/${id}/settings`),
                    apiFetch(`/admin/partners/${id}/orders?limit=20`),
                ]);

                setPartner({
                    id: String(p.id),
                    name: String(p.name),
                    companyName: String(p.companyName || p.name),
                    contactName: String(p.contactName || p.name),
                    email: String(p.email),
                    phone: String(p.phone || 'N/A'),
                    website: p.website,
                    regions: Array.isArray(p.regions) ? p.regions : [],
                    status: p.status,
                    ordersCompleted: Number(p.ordersCompleted || 0),
                    // Passed through as null rather than coerced: "no data yet"
                    // and "zero hours" are different answers.
                    averageProductionHours:
                        typeof p.averageProductionHours === 'number' ? p.averageProductionHours : null,
                    onTimeDeliveryRate:
                        typeof p.onTimeDeliveryRate === 'number' ? p.onTimeDeliveryRate : null,
                    performanceSampleSize: Number(p.performanceSampleSize || 0),
                    rating: Number(p.rating || 5.0),
                    availabilityStatus: p.availabilityStatus === 'paused' ? 'paused' : 'open',
                    capacityPaused: Boolean(p.capacityPaused),
                    address: p.address ?? null,
                    businessType: p.businessType ?? null,
                    statusHistory: Array.isArray(p.statusHistory) ? p.statusHistory : [],
                    passkeys: Number(p.passkeys || 0),
                });

                setSettings(settingsRes);
                setOrders(
                    Array.isArray(ordersRes.orders)
                        ? ordersRes.orders.map((row: any) => ({
                            id: String(row.id),
                            status: String(row.status),
                            customer: String(row.customer),
                            total: Number(row.total || 0),
                            createdAt: new Date(row.createdAt).toISOString(),
                        }))
                        : []
                );
            } catch (error: any) {
                toast.error(error.message || 'Failed to load partner');
            } finally {
                setLoading(false);
            }
        };

        fetchAll();
    }, [id]);

    /*
     * Keeps this page truthful while it is open. The partner can pause
     * themselves from their own portal, and the capacity monitor can pause them
     * without anyone touching either console — both reach here now.
     */
    /*
     * A partner editing their own profile — company name, phone, website,
     * address, and the region that follows from it — lands here live. Refetched
     * rather than patched: an address change moves several fields at once, and
     * the region is derived server-side.
     */
    useEffect(
        () =>
            subscribeToStream((event, data) => {
                if (event !== 'partner.profile_updated' || !data?.partnerId) return;
                if (!id || String(data.partnerId) !== String(id)) return;
                void fetchPartner();
            }),
        [id, subscribeToStream, fetchPartner],
    );

    useEffect(
        () =>
            subscribeToStream((event, data) => {
                if (event !== 'partner.availability_changed' || !data?.partnerId) return;
                if (!id || String(data.partnerId) !== String(id)) return;
                setPartner((prev) =>
                    prev
                        ? {
                              ...prev,
                              availabilityStatus: data.availabilityStatus === 'paused' ? 'paused' : 'open',
                              capacityPaused: Boolean(data.capacityPaused),
                          }
                        : prev,
                );
            }),
        [id, subscribeToStream],
    );

    return (
        <>
            <DashboardLayout>
                <div className="space-y-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center min-h-[300px]">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                            <p className="mt-4 text-gray-500">Loading partner...</p>
                        </div>
                    ) : !partner ? (
                        <div className="text-center py-20">
                            <h2 className="text-2xl font-bold text-gray-900">Partner Not Found</h2>
                            <p className="text-gray-500 mt-2">The partner you are looking for does not exist or you don't have permission to view it.</p>
                        </div>
                    ) : (
                        <>
                            <PartnerHeader
                                name={partner.name}
                                email={partner.email}
                                status={partner.status}
                            />

                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                <div className="flex border-b border-gray-100 px-6">
                                    {tabs.map((tab) => (
                                        <button
                                            key={tab}
                                            onClick={() => setActiveTab(tab)}
                                            className={`relative px-4 py-4 text-sm font-medium transition-colors ${activeTab === tab
                                                ? 'text-blue-600'
                                                : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                        >
                                            {tab}
                                            {activeTab === tab && (
                                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
                                            )}
                                        </button>
                                    ))}
                                </div>

                                <div className="p-6">
                                    {activeTab === 'Overview' && (
                                        <PartnerOverview
                                            partner={partner}
                                            onAvailabilityChanged={(availabilityStatus, capacityPaused) =>
                                                setPartner((prev) =>
                                                    prev ? { ...prev, availabilityStatus, capacityPaused } : prev,
                                                )
                                            }
                                        />
                                    )}
                                    {activeTab === 'Orders' && (
                                        <PartnerOrders partnerId={partner.id} orders={orders} onUpdated={setOrders} />
                                    )}
                                    {activeTab === 'Settings' && (partner.passkeys ?? 0) > 0 && (
                                        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4">
                                            <div>
                                                <p className="text-sm font-semibold text-gray-900">Sign-in security</p>
                                                <p className="text-sm text-gray-500">
                                                    This partner signs in with a passkey as a second step ({partner.passkeys} on the account).
                                                </p>
                                            </div>
                                            <ResetPasskeys
                                                userId={partner.id}
                                                accountLabel={partner.name}
                                                onReset={() => setPartner((prev) => (prev ? { ...prev, passkeys: 0 } : prev))}
                                            />
                                        </div>
                                    )}
                                    {activeTab === 'Settings' && (
                                        <PartnerSettings
                                            partnerId={partner.id}
                                            partnerStatus={partner.status}
                                            partnerRegions={partner.regions}
                                            settings={settings}
                                            onUpdated={(nextSettings: PartnerSettingsApi, nextStatus?: PartnerDetailsData['status']) => {
                                                setSettings(nextSettings);
                                                if (nextStatus) setPartner((prev) => (prev ? { ...prev, status: nextStatus } : prev));
                                            }}
                                        />
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </DashboardLayout>

        </>
    );
};
