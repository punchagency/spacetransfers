import { DashboardLayout } from '../components/layout/DashboardLayout';
import { useEffect, useState } from 'react';
import { PartnerHeader } from '../components/partners/PartnerHeader';
import { PartnerOverview } from '../components/partners/PartnerOverview';
import { PartnerPricing } from '../components/partners/PartnerPricing';
import { PartnerOrders } from '../components/partners/PartnerOrders';
import { PartnerSettings } from '../components/partners/PartnerSettings';
import { EditPartnerModal } from '../components/partners/EditPartnerModal';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import toast from 'react-hot-toast';
import type { PartnerDetailsData, PartnerOrderRow, PartnerPricingApi, PartnerSettingsApi } from '../types/partners';

export const PartnerDetails = () => {
    const [activeTab, setActiveTab] = useState('Overview');
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const { id } = useParams<{ id: string }>();
    const [partner, setPartner] = useState<PartnerDetailsData | null>(null);
    const [pricing, setPricing] = useState<PartnerPricingApi | null>(null);
    const [settings, setSettings] = useState<PartnerSettingsApi | null>(null);
    const [orders, setOrders] = useState<PartnerOrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const tabs = ['Overview', 'Pricing', 'Orders', 'Settings'];

    useEffect(() => {
        const fetchAll = async () => {
            if (!id) return;
            setLoading(true);
            try {
                const [p, pr, s, o] = await Promise.all([
                    apiFetch(`/admin/partners/${id}`),
                    apiFetch(`/admin/partners/${id}/pricing`),
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
                    rating: Number(p.rating || 5.0),
                });

                setPricing(pr);
                setSettings(s);
                setOrders(
                    Array.isArray(o.orders)
                        ? o.orders.map((row: any) => ({
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
                                onEdit={() => setIsEditModalOpen(true)}
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
                                        <PartnerOverview partner={partner} settings={settings} />
                                    )}
                                    {activeTab === 'Pricing' && (
                                        <PartnerPricing
                                            partnerId={partner.id}
                                            pricing={pricing}
                                            onUpdated={(nextPricing: PartnerPricingApi) => setPricing(nextPricing)}
                                        />
                                    )}
                                    {activeTab === 'Orders' && (
                                        <PartnerOrders partnerId={partner.id} orders={orders} onUpdated={setOrders} />
                                    )}
                                    {activeTab === 'Settings' && (
                                        <PartnerSettings
                                            partnerId={partner.id}
                                            partnerStatus={partner.status}
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

            {partner && (
                <EditPartnerModal
                    isOpen={isEditModalOpen}
                    onClose={() => setIsEditModalOpen(false)}
                    partnerData={{
                        name: partner.companyName,
                        email: partner.email,
                        phone: partner.phone,
                        region: partner.regions[0] || 'N/A',
                        status: partner.status,
                        notes: '',
                    }}
                    partnerId={partner.id}
                    regions={partner.regions}
                    contactName={partner.contactName}
                    website={partner.website || ''}
                    onSaved={(nextPartner: PartnerDetailsData) => {
                        setPartner(nextPartner);
                        setIsEditModalOpen(false);
                    }}
                />
            )}
        </>
    );
};
