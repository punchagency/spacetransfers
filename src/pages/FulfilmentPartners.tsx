import { useEffect, useState } from 'react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { PartnersTable } from '../components/partners/PartnersTable';
import { FiPlus, FiSend } from 'react-icons/fi';
import { SelectInput } from '../components/common/SelectInput';
import { SearchInput } from '../components/common/SearchInput';
import type { Partner } from '../types/partners';
import { apiFetch } from '../utils/api';
import toast from 'react-hot-toast';
import { AddPartnerModal } from '../components/partners/AddPartnerModal';
import { AssignOrdersModal } from '../components/partners/AssignOrdersModal';
import { REGIONS } from "../utils/regions";

export const FulfilmentPartners = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [regionFilter, setRegionFilter] = useState('All Regions');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // Debounced so typing doesn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => window.clearTimeout(id);
  }, [searchTerm]);

  /**
   * The server already applied search, status and region — this list is the
   * result of that query, so re-filtering it here only removes rows.
   *
   * It did exactly that: the server matches a partner's contact `name`,
   * `companyName` or `email`, but returns `companyName` as the display `name`.
   * Searching a partner's contact name therefore matched server-side and was
   * then discarded client-side, so a partner that exists reported "no results".
   */
  const filteredPartners: Partner[] = partners;

  useEffect(() => {
    const fetchPartners = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (statusFilter !== 'All Status') params.set('status', statusFilter);
        if (regionFilter !== 'All Regions') params.set('region', regionFilter);
        if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
        params.set('limit', '50');

        const response = await apiFetch(`/admin/partners?${params.toString()}`);
        const mapped: Partner[] = (response.partners || []).map((p: any) => ({
          id: String(p.id),
          name: String(p.name || 'N/A'),
          email: String(p.email || 'N/A'),
          regions: Array.isArray(p.regions) ? p.regions : [],
          status: p.status as Partner['status'],
          basePrice: String(p.basePrice || '$0.00'),
          salePrice: String(p.salePrice || '$0.00'),
          profit: String(p.profit || '$0.00'),
          orders: String(p.orders ?? p.ordersCompleted ?? '0'),
        }));
        setPartners(mapped);
      } catch (error: any) {
        toast.error(error.message || 'Failed to load partners');
      } finally {
        setLoading(false);
      }
    };

    fetchPartners();
  }, [refreshKey, debouncedSearch, statusFilter, regionFilter]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
          <div>
            <h1 className="text-[24px] font-bold text-gray-900">Fulfilment Partners</h1>
            <p className="text-gray-500">Manage your DTF printing network partners</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            <button
              onClick={() => setIsAssignModalOpen(true)}
              aria-label="Assign orders to fulfilment partners"
              className="flex items-center justify-center gap-2 bg-white text-gray-700 border border-gray-200 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 transition-colors shadow-sm w-full sm:w-auto"
            >
              <FiSend />
              <span className="text-[14px]">Assign Orders</span>
            </button>
            <button
              onClick={() => setIsAddModalOpen(true)}
              aria-label="Add new fulfilment partner"
              className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm w-full sm:w-auto"
            >
              <FiPlus />
              <span className='text-[14px]'>Add New Partner</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-4 items-center">
          <SearchInput
            placeholder="Search by name, company or email"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            containerClassName="flex-1 w-full"
          />

          <SelectInput
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            containerClassName="w-full md:w-48"
          >
            <option>All Status</option>
            <option>Active</option>
            <option>Pending</option>
            <option>Suspended</option>
          </SelectInput> 

          <SelectInput
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            containerClassName="w-full md:w-48"
          >
            <option>All Regions</option>
            {REGIONS.map((region) => (
              <option key={region}>{region}</option>
            ))}
          </SelectInput>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[240px]">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
            <p className="mt-3 text-gray-500 text-sm">Loading partners...</p>
          </div>
        ) : (
          <PartnersTable partners={filteredPartners} />
        )}
      </div>

      <AddPartnerModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onCreated={() => {
          setIsAddModalOpen(false);
          setRefreshKey((k) => k + 1);
        }}
      />

      <AssignOrdersModal
        isOpen={isAssignModalOpen}
        onClose={() => setIsAssignModalOpen(false)}
      />
    </DashboardLayout>
  );
};
