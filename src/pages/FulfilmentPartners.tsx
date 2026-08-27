import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

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

  const mapPartner = (p: any): Partner => ({
    id: String(p.id),
    name: String(p.name || 'N/A'),
    email: String(p.email || 'N/A'),
    regions: Array.isArray(p.regions) ? p.regions : [],
    status: p.status as Partner['status'],
    ordersInProgress: String(p.ordersInProgress ?? '0'),
    orders: String(p.orders ?? p.ordersCompleted ?? '0'),
  });

  const queryFor = useCallback((cursor?: string | null) => {
    const params = new URLSearchParams();
    if (statusFilter !== 'All Status') params.set('status', statusFilter);
    if (regionFilter !== 'All Regions') params.set('region', regionFilter);
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    params.set('limit', '50');
    if (cursor) params.set('cursor', cursor);
    return params.toString();
  }, [statusFilter, regionFilter, debouncedSearch]);

  // Read through a ref inside the effect so the fetch always uses the current
  // filters without making the effect re-run on an identity change.
  const queryForRef = useRef(queryFor);
  queryForRef.current = queryFor;

  /**
   * The server returns a cursor when more partners exist. The page asked for 50
   * and threw it away, so at 51 partners the rest simply were not there — no
   * message, no control, and the table's own pager only paginates what it was
   * handed.
   */
  const loadMorePartners = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await apiFetch(`/admin/partners?${queryFor(nextCursor)}`);
      const more = (res.partners || []).map(mapPartner);
      setPartners((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...more.filter((p: Partner) => !seen.has(p.id))];
      });
      setNextCursor(res.nextCursor || null);
    } catch (error: any) {
      toast.error(error.message || 'Could not load more partners');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const fetchPartners = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams(queryForRef.current());

        const response = await apiFetch(`/admin/partners?${params.toString()}`);
        setPartners((response.partners || []).map(mapPartner));
        setNextCursor(response.nextCursor || null);
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
          <>
            <PartnersTable partners={filteredPartners} />
            {nextCursor && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={() => void loadMorePartners()}
                  disabled={loadingMore}
                  className="px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 rounded-lg text-sm font-medium text-gray-700"
                >
                  {loadingMore ? 'Loading…' : 'Load more partners'}
                </button>
              </div>
            )}
          </>
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
