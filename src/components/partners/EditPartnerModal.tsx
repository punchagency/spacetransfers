import { FiX, FiChevronDown } from 'react-icons/fi';
import { useMemo, useState } from 'react';
import { Toggle } from '../common/Toggle';
import type { EditPartnerModalProps } from '../../types/partners';
import toast from 'react-hot-toast';
import { apiFetch } from '../../utils/api';

const REGIONS = [
    'South',
    'Central',
    'Midwest',
    'Pacific Northwest',
    'Southwest',
    'North-east',
    'Westcoast',
];

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export const EditPartnerModal = ({
    isOpen,
    onClose,
    partnerData,
    partnerId,
    regions,
    contactName,
    website,
    onSaved
}: EditPartnerModalProps) => {
    const [companyName, setCompanyName] = useState(partnerData.name);
    const [contact, setContact] = useState(contactName || '');
    const [email, setEmail] = useState(partnerData.email);
    const [phone, setPhone] = useState(partnerData.phone);
    const [isActive, setIsActive] = useState(partnerData.status === 'Active');
    const [notes, setNotes] = useState(partnerData.notes || '');
    const [partnerWebsite, setPartnerWebsite] = useState(website || '');
    const [selectedRegions, setSelectedRegions] = useState<string[]>(Array.isArray(regions) && regions.length > 0 ? regions : (partnerData.region && partnerData.region !== 'N/A' ? [partnerData.region] : []));
    const [isSaving, setIsSaving] = useState(false);
    const [touched, setTouched] = useState<Record<string, boolean>>({});

    const validation = useMemo(() => {
        const errors: Record<string, string> = {};
        if (!companyName.trim()) errors.companyName = 'Partner name is required';
        if (!contact.trim()) errors.contact = 'Contact name is required';
        if (!email.trim()) errors.email = 'Email is required';
        else if (!isValidEmail(email)) errors.email = 'Enter a valid email';
        if (!phone.trim()) errors.phone = 'Phone is required';
        if (selectedRegions.length === 0) errors.regions = 'Select at least one region';
        return { errors, isValid: Object.keys(errors).length === 0 };
    }, [companyName, contact, email, phone, selectedRegions]);

    const toggleRegion = (region: string) => {
        setSelectedRegions((prev) => (prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region]));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            {/* Blur Overlay */}
            <div
                className="fixed inset-0 bg-black/20 backdrop-blur-xs transition-opacity"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 shrink-0">
                    <h2 className="text-xl font-bold text-gray-900">Edit Partner</h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600"
                    >
                        <FiX className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-3 space-y-6 overflow-y-auto">
                    {/* Partner Name */}
                    <div className="space-y-1">
                        <label className="text-sm font-bold text-gray-900">
                            Partner Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={companyName}
                            onChange={(e) => setCompanyName(e.target.value)}
                            onBlur={() => setTouched((t) => ({ ...t, companyName: true }))}
                            className={`w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm font-medium text-gray-900 focus:bg-white transition-all outline-none ${touched.companyName && validation.errors.companyName ? 'border-red-300 focus:border-red-400' : 'border-transparent focus:border-blue-500'}`}
                            placeholder="John Doe Printing"
                        />
                        {touched.companyName && validation.errors.companyName && (
                            <p className="text-xs text-red-600">{validation.errors.companyName}</p>
                        )}
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-bold text-gray-900">
                            Contact Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={contact}
                            onChange={(e) => setContact(e.target.value)}
                            onBlur={() => setTouched((t) => ({ ...t, contact: true }))}
                            className={`w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm font-medium text-gray-900 focus:bg-white transition-all outline-none ${touched.contact && validation.errors.contact ? 'border-red-300 focus:border-red-400' : 'border-transparent focus:border-blue-500'}`}
                            placeholder="John Smith"
                        />
                        {touched.contact && validation.errors.contact && (
                            <p className="text-xs text-red-600">{validation.errors.contact}</p>
                        )}
                    </div>

                    {/* Email Address */}
                    <div className="space-y-1">
                        <label className="text-sm font-bold text-gray-900">
                            Email Address <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                            className={`w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm font-medium text-gray-900 focus:bg-white transition-all outline-none ${touched.email && validation.errors.email ? 'border-red-300 focus:border-red-400' : 'border-transparent focus:border-blue-500'}`}
                            placeholder="john@doeprinting.com"
                        />
                        {touched.email && validation.errors.email && (
                            <p className="text-xs text-red-600">{validation.errors.email}</p>
                        )}
                    </div>

                    {/* Phone */}
                    <div className="space-y-1">
                        <label className="text-sm font-bold text-gray-900">
                            Phone <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                            className={`w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm font-medium text-gray-900 focus:bg-white transition-all outline-none ${touched.phone && validation.errors.phone ? 'border-red-300 focus:border-red-400' : 'border-transparent focus:border-blue-500'}`}
                            placeholder="+1 (555) 123-4567"
                        />
                        {touched.phone && validation.errors.phone && (
                            <p className="text-xs text-red-600">{validation.errors.phone}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-bold text-gray-900">
                                Regions <span className="text-red-500">*</span>
                            </label>
                            <span className="text-xs text-gray-400">{selectedRegions.length} selected</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {REGIONS.map((region) => {
                                const selected = selectedRegions.includes(region);
                                return (
                                    <button
                                        type="button"
                                        key={region}
                                        onClick={() => toggleRegion(region)}
                                        className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors text-left ${selected ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                                    >
                                        {region}
                                    </button>
                                );
                            })}
                        </div>
                        {touched.regions && validation.errors.regions && (
                            <p className="text-xs text-red-600">{validation.errors.regions}</p>
                        )}
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-bold text-gray-900">Website</label>
                        <div className="relative">
                            <input
                                type="text"
                                value={partnerWebsite}
                                onChange={(e) => setPartnerWebsite(e.target.value)}
                                className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl text-sm font-medium text-gray-900 focus:bg-white focus:border-blue-500 transition-all outline-none"
                                placeholder="https://example.com"
                            />
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-300">
                                <FiChevronDown className="opacity-0" />
                            </div>
                        </div>
                    </div>

                    {/* Active Status */}
                    <div className="bg-gray-50/50 rounded-xl p-6 flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-sm font-bold text-gray-900">Active Status</p>
                            <p className="text-[13px] text-gray-400 font-medium">Partner is currently active</p>
                        </div>
                        <Toggle enabled={isActive} setEnabled={setIsActive} />
                    </div>

                    {/* Notes */}
                    <div className="space-y-1">
                        <label className="text-sm font-bold text-gray-500">
                            Notes <span className="text-gray-400 font-medium">(Optional)</span>
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={4}
                            placeholder="Add any additional notes about this partner..."
                            className="w-full px-4 py-4 bg-gray-50 border border-transparent rounded-xl text-sm font-medium text-gray-900 focus:bg-white focus:border-blue-500 transition-all outline-none resize-none"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-gray-100 flex gap-4 shrink-0">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 px-4 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                        disabled={isSaving}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={async () => {
                            setTouched({
                                companyName: true,
                                contact: true,
                                email: true,
                                phone: true,
                                regions: true
                            });

                            if (!validation.isValid) return;
                            if (!partnerId) {
                                toast.error('Missing partner id');
                                return;
                            }

                            setIsSaving(true);
                            try {
                                await apiFetch(`/admin/partners/${partnerId}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({
                                        companyName: companyName.trim(),
                                        name: contact.trim(),
                                        email: email.trim(),
                                        phone: phone.trim(),
                                        website: partnerWebsite.trim(),
                                        regions: selectedRegions,
                                        status: isActive ? 'Active' : 'Suspended',
                                        notes
                                    })
                                });

                                const updated = await apiFetch(`/admin/partners/${partnerId}`);
                                toast.success('Partner updated');
                                onSaved?.({
                                    id: String(updated.id),
                                    name: String(updated.name),
                                    companyName: String(updated.companyName || updated.name),
                                    contactName: String(updated.contactName || updated.name),
                                    email: String(updated.email),
                                    phone: String(updated.phone || 'N/A'),
                                    website: updated.website,
                                    regions: Array.isArray(updated.regions) ? updated.regions : [],
                                    status: updated.status,
                                    ordersCompleted: Number(updated.ordersCompleted || 0),
                                    rating: Number(updated.rating || 5.0)
                                });
                            } catch (error: any) {
                                toast.error(error.message || 'Failed to update partner');
                            } finally {
                                setIsSaving(false);
                            }
                        }}
                        disabled={isSaving || !validation.isValid}
                        className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20 disabled:opacity-60 disabled:hover:bg-blue-600"
                    >
                        {isSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
};
