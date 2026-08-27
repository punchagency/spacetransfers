import { useEffect, useMemo, useRef, useState } from 'react';
import { FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { apiFetch } from '../../utils/api';
import { formatOrderNumber } from '../../utils/orderNumber';
import { formatOrderStatus } from '../../utils/orderStatus';

type PartnerOption = {
  id: string;
  name: string;
  regions: string[];
  status: string;
};

const ORDERS_PAGE_SIZE = 50;

type OrderRow = {
  id: string;
  displayId?: string | null;
  customer: string;
  total: number;
  status: string;
  createdAt: string;
  assignedPartnerId: string | null;
  region?: string | null;
  isUrgent?: boolean;
};

export const AssignOrdersModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  const [selectedPartnerId, setSelectedPartnerId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [crossRegionPrompt, setCrossRegionPrompt] = useState<{ count: number; message: string } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const titleId = useMemo(() => `assign-orders-title-${Math.random().toString(16).slice(2)}`, []);
  const partnerSelectRef = useRef<HTMLSelectElement | null>(null);

  const mapOrder = (o: any): OrderRow => ({
    id: String(o.id),
    displayId: o.displayId ? String(o.displayId) : null,
    customer: String(o.customer || 'N/A'),
    total: Number(o.total || 0),
    status: String(o.status || 'N/A'),
    createdAt: new Date(o.createdAt).toISOString(),
    assignedPartnerId: o.assignedPartnerId ? String(o.assignedPartnerId) : null,
    region: o.region ? String(o.region) : null,
    isUrgent: Boolean(o.isUrgent),
  });

  useEffect(() => {
    if (!isOpen) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        /*
         * Both endpoints have always supported cursors; this modal ignored them
         * and asked for one flat page, so past 100 orders (or 200 partners) the
         * rest were simply invisible — with nothing on screen saying a limit
         * had been hit. Partners are still fetched in one go, but the page size
         * is now followed to its end rather than assumed sufficient.
         */
        const [partnerRes, orderRes] = await Promise.all([
          apiFetch('/admin/partners?status=Active&limit=200'),
          apiFetch(`/admin/orders?limit=${ORDERS_PAGE_SIZE}`),
        ]);

        const mappedPartners: PartnerOption[] = (partnerRes.partners || []).map((p: any) => ({
          id: String(p.id),
          name: String(p.name || 'N/A'),
          regions: Array.isArray(p.regions) ? p.regions : [],
          status: String(p.status || 'N/A'),
        }));

        setPartners(mappedPartners);
        setOrders((orderRes.orders || []).map(mapOrder));
        setNextCursor(orderRes.nextCursor || null);
        setSelectedOrderIds(new Set());
        setSelectedPartnerId('');
        setSearch('');
      } catch (error: any) {
        toast.error(error.message || 'Failed to load assignment data');
      } finally {
        setLoading(false);
        setTimeout(() => partnerSelectRef.current?.focus(), 0);
      }
    };

    fetchData();
  }, [isOpen]);

  const loadMoreOrders = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await apiFetch(
        `/admin/orders?limit=${ORDERS_PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`,
      );
      const more = (res.orders || []).map(mapOrder);
      // De-duplicated by id: a cursor page can overlap if an order is updated
      // between requests, and a duplicate row is separately selectable.
      setOrders((prev) => {
        const seen = new Set(prev.map((o) => o.id));
        return [...prev, ...more.filter((o: OrderRow) => !seen.has(o.id))];
      });
      setNextCursor(res.nextCursor || null);
    } catch (error: any) {
      toast.error(error.message || 'Could not load more orders');
    } finally {
      setLoadingMore(false);
    }
  };

  const unassignedOrders = useMemo(() => {
    // REJECTED dropped with the status itself. A terminal order cannot be
    // assigned, and one that already has a partner is not "unassigned".
    return orders.filter(
      (o) => !o.assignedPartnerId && !['COMPLETED', 'CANCELLED'].includes(o.status.toUpperCase()),
    );
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return unassignedOrders;
    return unassignedOrders.filter((o) => {
      return (
        formatOrderNumber(o.displayId, o.id).toLowerCase().includes(s) ||
        o.id.toLowerCase().includes(s) ||
        o.customer.toLowerCase().includes(s) ||
        (o.region || '').toLowerCase().includes(s) ||
        formatOrderStatus(o.status).toLowerCase().includes(s)
      );
    });
  }, [search, unassignedOrders]);

  const selectedCount = selectedOrderIds.size;
  const canAssign = selectedPartnerId && selectedCount > 0 && !loading && !assigning;

  const toggleOrder = (orderId: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  /**
   * Whether every *visible* order is selected — by membership, not by count.
   *
   * `prev.size === filteredOrders.length` was wrong in both directions once a
   * search was active. Select one order, then search so a different single
   * order matches: the sizes are equal, so the control reads "Clear" and
   * clicking it wipes a selection the user could not see, while the visible row
   * was never selected at all.
   */
  const allFilteredSelected =
    filteredOrders.length > 0 && filteredOrders.every((o) => selectedOrderIds.has(o.id));

  const toggleAll = () => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      // Acts on the visible rows only, and merges rather than replaces —
      // selecting all under a search used to discard everything chosen before
      // it, silently.
      if (allFilteredSelected) filteredOrders.forEach((o) => next.delete(o.id));
      else filteredOrders.forEach((o) => next.add(o.id));
      return next;
    });
  };

  const close = () => {
    if (assigning) return;
    /*
     * Cleared on close. None of this was reset before, so reopening showed a
     * previous session's selections and search against a freshly fetched list —
     * ids that may since have been assigned by someone else.
     */
    setSelectedOrderIds(new Set());
    setSearch('');
    setSelectedPartnerId('');
    setCrossRegionPrompt(null);
    onClose();
  };

  /**
   * @param force pass the server's cross-region override for this batch.
   */
  const assignSelected = async (force = false) => {
    if (!canAssign) return;
    setAssigning(true);
    setCrossRegionPrompt(null);
    try {
      const ids = Array.from(selectedOrderIds);
      const assigned: string[] = [];
      const failed: Array<{ id: string; label: string; message: string; crossRegion: boolean }> = [];

      for (const orderId of ids) {
        const row = orders.find((o) => o.id === orderId);
        const label = formatOrderNumber(row?.displayId, orderId);
        try {
          await apiFetch(`/admin/orders/${orderId}/assign`, {
            method: 'POST',
            /*
             * No priority field: it is fixed at checkout by the customer's
             * shipping choice and holds for the order's whole life. The server
             * ignores one if sent.
             */
            body: JSON.stringify({ partnerId: selectedPartnerId, force }),
          });
          assigned.push(orderId);
        } catch (e: any) {
          const message = e?.message || 'Failed';
          failed.push({
            id: orderId,
            label,
            message,
            // The server answers 409 CROSS_REGION_ASSIGNMENT with a message
            // naming both regions and saying force:true overrides it.
            crossRegion: /cross[- ]region|force:true/i.test(message),
          });
        }
      }

      if (assigned.length > 0) {
        toast.success(`Assigned ${assigned.length} order${assigned.length === 1 ? '' : 's'}`);
      }

      /**
       * Only the orders that actually succeeded are marked assigned.
       *
       * This used to update every selected row whenever *any* of them
       * succeeded, so a partial failure made the failed orders disappear from
       * the unassigned list while remaining unassigned in the database — the
       * admin was shown work as done that nobody was doing.
       */
      const assignedSet = new Set(assigned);
      setOrders((prev) =>
        prev.map((o) => (assignedSet.has(o.id) ? { ...o, assignedPartnerId: selectedPartnerId } : o)),
      );
      setSelectedOrderIds((prev) => new Set([...prev].filter((id) => !assignedSet.has(id))));

      if (failed.length > 0) {
        const blockedByRegion = failed.filter((f) => f.crossRegion);
        if (blockedByRegion.length > 0 && !force) {
          // Offer the override the server already supports rather than
          // reporting an unexplained failure.
          setCrossRegionPrompt({ count: blockedByRegion.length, message: blockedByRegion[0].message });
        }

        // The server says exactly why — at capacity, cross-region, and which
        // order. Reporting only a count threw that away.
        for (const f of failed.filter((x) => !x.crossRegion || force)) {
          toast.error(`${f.label}: ${f.message}`, { duration: 6000 });
        }
      }
    } finally {
      setAssigning(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-xs transition-opacity"
        onClick={close}
      />

      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
            if (canAssign) void assignSelected();
          }
        }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-gray-900">Assign Orders to Partners</h2>
            <p className="text-xs text-gray-500 mt-0.5">Select unassigned orders and assign them to an active fulfilment partner.</p>
          </div>
          <button
            onClick={close}
            aria-label="Close assignment modal"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600"
            disabled={assigning}
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-bold text-gray-900">Partner</label>
              <select
                ref={partnerSelectRef}
                value={selectedPartnerId}
                onChange={(e) => setSelectedPartnerId(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl text-sm font-medium text-gray-900 focus:bg-white focus:border-blue-500 transition-all outline-none"
                aria-label="Select partner"
                disabled={loading || assigning}
              >
                <option value="">Select a partner</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.regions.length > 0 ? ` (${p.regions.join(', ')})` : ''}
                  </option>
                ))}
              </select>
            </div>

          </div>

          <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <div className="relative flex-1">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by order ID, customer, region or status"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-sm font-medium text-gray-900 outline-none focus:bg-white focus:border-blue-500 transition-all"
                aria-label="Search orders"
                disabled={loading || assigning}
              />
            </div>

            <button
              type="button"
              onClick={toggleAll}
              className="px-4 py-3 rounded-xl text-sm font-bold border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-60"
              disabled={loading || assigning || filteredOrders.length === 0}
              aria-label="Select all filtered orders"
            >
              {allFilteredSelected ? 'Clear Selection' : 'Select All'}
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr className="text-[12px] font-bold text-gray-900 uppercase tracking-wider">
                    <th className="px-4 py-4 w-10"></th>
                    <th className="px-4 py-4">Order</th>
                    <th className="px-4 py-4">Customer</th>
                    <th className="px-4 py-4">Region</th>
                    <th className="px-4 py-4">Status</th>
                    <th className="px-4 py-4 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-sm text-gray-500">Loading orders...</td>
                    </tr>
                  ) : filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-sm text-gray-400 italic">No unassigned orders found</td>
                    </tr>
                  ) : (
                    filteredOrders.map((o) => {
                      const checked = selectedOrderIds.has(o.id);
                      return (
                        <tr key={o.id} className="text-sm hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-4">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleOrder(o.id)}
                              aria-label={`Select order ${o.id}`}
                              disabled={assigning}
                              className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                            />
                          </td>
                          <td className="px-4 py-4 font-bold text-gray-900">{formatOrderNumber(o.displayId, o.id)}</td>
                          <td className="px-4 py-4 text-gray-900">{o.customer}</td>
                          <td className="px-4 py-4 text-gray-500">{o.region || 'N/A'}</td>
                          {/* Was the raw backend value, so this table said
                            "PROCESSING" where the rest of the console says
                            "Assigned" — it fetches /admin/orders directly
                            rather than through the row mapper. */}
                        <td className="px-4 py-4 text-gray-500">
                          <span className="flex items-center gap-2">
                            {formatOrderStatus(o.status)}
                            {o.isUrgent && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-600 border border-red-200"
                                title="Already urgent — the partner is paid a rush surcharge"
                              >
                                Urgent
                              </span>
                            )}
                          </span>
                        </td>
                          <td className="px-4 py-4 text-right font-bold text-gray-900">${o.total.toFixed(2)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 bg-white border-t border-gray-50 text-sm text-gray-500 italic">
              {unassignedOrders.length.toLocaleString()} unassigned orders · {selectedCount.toLocaleString()} selected
              {nextCursor && (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => void loadMoreOrders()}
                    disabled={loadingMore || assigning}
                    className="not-italic font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                  >
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/*
          The server refuses a cross-region assignment with a 409 that names
          both regions and offers `force: true`. The modal never sent it, so the
          override the API already supports was unreachable and the admin saw
          only an unexplained failure. Shown as a deliberate second step rather
          than a silent flag on the first attempt.
        */}
        {crossRegionPrompt && (
          <div className="px-6 py-4 border-t border-amber-200 bg-amber-50 shrink-0">
            <p className="text-sm font-medium text-gray-900">
              {crossRegionPrompt.count} order{crossRegionPrompt.count === 1 ? '' : 's'} could not be
              assigned: the partner is in a different region
            </p>
            <p className="text-xs text-gray-600 mt-1">{crossRegionPrompt.message}</p>
            <p className="text-xs text-gray-600 mt-1">
              Assigning across regions means longer transit and higher shipping cost.
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => void assignSelected(true)}
                disabled={assigning}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold"
              >
                Assign anyway
              </button>
              <button
                onClick={() => setCrossRegionPrompt(null)}
                disabled={assigning}
                className="px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg text-xs font-medium text-gray-700"
              >
                Keep unassigned
              </button>
            </div>
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-100 flex flex-col sm:flex-row gap-3 shrink-0">
          <button
            onClick={close}
            className="flex-1 py-3 px-4 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
            disabled={assigning}
          >
            Cancel
          </button>
          <button
            onClick={() => void assignSelected()}
            className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20 disabled:opacity-60 disabled:hover:bg-blue-600"
            disabled={!canAssign}
            aria-label="Assign selected orders"
          >
            {assigning ? 'Assigning...' : 'Assign Selected'}
          </button>
        </div>
      </div>
    </div>
  );
};

