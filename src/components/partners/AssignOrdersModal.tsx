import { useEffect, useMemo, useRef, useState } from 'react';
import { FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { apiFetch } from '../../utils/api';

type PartnerOption = {
  id: string;
  name: string;
  regions: string[];
  status: string;
};

type OrderRow = {
  id: string;
  customer: string;
  total: number;
  status: string;
  createdAt: string;
  assignedPartnerId: string | null;
  region?: string | null;
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
  const [priority, setPriority] = useState<'Normal' | 'URGENT'>('Normal');
  const [search, setSearch] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());

  const titleId = useMemo(() => `assign-orders-title-${Math.random().toString(16).slice(2)}`, []);
  const partnerSelectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [partnerRes, orderRes] = await Promise.all([
          apiFetch('/admin/partners?status=Active&limit=200'),
          apiFetch('/admin/orders?limit=100'),
        ]);

        const mappedPartners: PartnerOption[] = (partnerRes.partners || []).map((p: any) => ({
          id: String(p.id),
          name: String(p.name || 'N/A'),
          regions: Array.isArray(p.regions) ? p.regions : [],
          status: String(p.status || 'N/A'),
        }));

        const mappedOrders: OrderRow[] = (orderRes.orders || []).map((o: any) => ({
          id: String(o.id),
          customer: String(o.customer || 'N/A'),
          total: Number(o.total || 0),
          status: String(o.status || 'N/A'),
          createdAt: new Date(o.createdAt).toISOString(),
          assignedPartnerId: o.assignedPartnerId ? String(o.assignedPartnerId) : null,
          region: o.region ? String(o.region) : null,
        }));

        setPartners(mappedPartners);
        setOrders(mappedOrders);
        setSelectedOrderIds(new Set());
        setSelectedPartnerId('');
        setPriority('Normal');
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

  const unassignedOrders = useMemo(() => {
    return orders.filter((o) => !o.assignedPartnerId && !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(o.status.toUpperCase()));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return unassignedOrders;
    return unassignedOrders.filter((o) => {
      return (
        o.id.toLowerCase().includes(s) ||
        o.customer.toLowerCase().includes(s) ||
        (o.region || '').toLowerCase().includes(s) ||
        o.status.toLowerCase().includes(s)
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

  const toggleAll = () => {
    setSelectedOrderIds((prev) => {
      if (prev.size === filteredOrders.length) return new Set();
      return new Set(filteredOrders.map((o) => o.id));
    });
  };

  const close = () => {
    if (assigning) return;
    onClose();
  };

  const assignSelected = async () => {
    if (!canAssign) return;
    setAssigning(true);
    try {
      const ids = Array.from(selectedOrderIds);
      let success = 0;
      const failed: Array<{ id: string; message: string }> = [];

      for (const orderId of ids) {
        try {
          await apiFetch(`/admin/orders/${orderId}/assign`, {
            method: 'POST',
            body: JSON.stringify({ partnerId: selectedPartnerId, priority }),
          });
          success += 1;
        } catch (e: any) {
          failed.push({ id: orderId, message: e.message || 'Failed' });
        }
      }

      if (success > 0) {
        toast.success(`Assigned ${success} order${success === 1 ? '' : 's'}`);
        setOrders((prev) => prev.map((o) => (selectedOrderIds.has(o.id) ? { ...o, assignedPartnerId: selectedPartnerId } : o)));
        setSelectedOrderIds(new Set());
      }

      if (failed.length > 0) {
        toast.error(`Failed to assign ${failed.length} order${failed.length === 1 ? '' : 's'}`);
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

            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-900">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl text-sm font-medium text-gray-900 focus:bg-white focus:border-blue-500 transition-all outline-none"
                aria-label="Select assignment priority"
                disabled={loading || assigning}
              >
                <option value="Normal">Normal</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <div className="relative flex-1">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search unassigned orders..."
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
              {selectedOrderIds.size === filteredOrders.length && filteredOrders.length > 0 ? 'Clear Selection' : 'Select All'}
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
                          <td className="px-4 py-4 font-bold text-gray-900">{o.id.slice(-8).toUpperCase()}</td>
                          <td className="px-4 py-4 text-gray-900">{o.customer}</td>
                          <td className="px-4 py-4 text-gray-500">{o.region || 'N/A'}</td>
                          <td className="px-4 py-4 text-gray-500">{o.status}</td>
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
            </div>
          </div>
        </div>

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

