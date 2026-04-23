import { useEffect, useMemo, useState } from 'react';
import { FiChevronDown, FiSearch } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import type { PartnerOrderRow } from '../../types/partners';

export const PartnerOrders = ({
    partnerId,
    orders,
    onUpdated
}: {
    partnerId: string;
    orders: PartnerOrderRow[];
    onUpdated: (orders: PartnerOrderRow[]) => void;
}) => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('All Status');

    useEffect(() => {
        const fetchOrders = async () => {
            setLoading(true);
            try {
                const params = new URLSearchParams();
                if (statusFilter !== 'All Status') params.set('status', statusFilter);
                params.set('limit', '30');
                const res = await apiFetch(`/admin/partners/${partnerId}/orders?${params.toString()}`);
                const mapped: PartnerOrderRow[] = Array.isArray(res.orders)
                    ? res.orders.map((row: any) => ({
                        id: String(row.id),
                        status: String(row.status),
                        customer: String(row.customer),
                        total: Number(row.total || 0),
                        createdAt: new Date(row.createdAt).toISOString(),
                    }))
                    : [];
                onUpdated(mapped);
            } catch (error: any) {
                toast.error(error.message || 'Failed to load partner orders');
            } finally {
                setLoading(false);
            }
        };
        fetchOrders();
    }, [partnerId, statusFilter, onUpdated]);

    const filtered = useMemo(() => {
        if (!search.trim()) return orders;
        const s = search.trim().toLowerCase();
        return orders.filter((o) => o.id.toLowerCase().includes(s) || o.customer.toLowerCase().includes(s) || o.status.toLowerCase().includes(s));
    }, [orders, search]);

    const statusStyle = (status: string) => {
        const s = status.toUpperCase();
        if (s === 'COMPLETED') return 'bg-green-50 text-green-600 border border-green-100';
        if (s === 'PROCESSING' || s === 'PRINTING') return 'bg-blue-50 text-blue-600 border border-blue-100';
        if (s === 'SHIPPED') return 'bg-purple-50 text-purple-600 border border-purple-100';
        if (s === 'CANCELLED' || s === 'REJECTED') return 'bg-red-50 text-red-600 border border-red-100';
        return 'bg-amber-50 text-amber-600 border border-amber-100';
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col md:flex-row gap-4 items-center">
                <div className="relative flex-1 w-full">
                    <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search orders..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-100 bg-gray-50/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white focus:border-blue-500 transition-all"
                    />
                </div>
                <div className="flex gap-4 w-full md:w-auto">
                    <div className="relative flex-1 md:w-48">
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="w-full pl-4 pr-10 py-2 border border-gray-100 bg-gray-50/50 rounded-lg text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white focus:border-blue-500 transition-all"
                        >
                            <option>All Status</option>
                            <option>Pending</option>
                            <option>Assigned</option>
                            <option>In Progress</option>
                            <option>Shipped</option>
                            <option>Completed</option>
                            <option>Cancelled</option>
                        </select>
                        <FiChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-b border-gray-100">
                            <tr className="text-[12px] font-bold text-gray-900 uppercase tracking-wider">
                                <th className="px-6 py-4">Order ID</th>
                                <th className="px-6 py-4">Customer</th>
                                <th className="px-6 py-4">Date</th>
                                <th className="px-6 py-4 text-center">Status</th>
                                <th className="px-6 py-4 text-right">Total</th>
                                <th className="px-6 py-4 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-10 text-center text-sm text-gray-500">
                                        Loading orders...
                                    </td>
                                </tr>
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-10 text-center text-sm text-gray-400 italic">
                                        No orders found
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((order) => (
                                    <tr key={order.id} className="text-sm hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 font-bold text-gray-900">{order.id.slice(-8).toUpperCase()}</td>
                                        <td className="px-6 py-4 font-bold text-gray-900">{order.customer}</td>
                                        <td className="px-6 py-4 text-gray-500">
                                            {new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex justify-center">
                                                <span className={`px-3 py-1 rounded-md text-[11px] font-bold ${statusStyle(order.status)}`}>
                                                    {order.status}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right font-bold text-gray-900">${order.total.toFixed(2)}</td>
                                        <td className="px-6 py-4 text-center">
                                            <button
                                                onClick={() => navigate(`/dashboard/orders/${order.id}`)}
                                                className="text-gray-400 font-medium hover:text-blue-600 transition-colors"
                                            >
                                                View
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="px-6 py-4 bg-white border-t border-gray-50 text-sm text-gray-500 italic">
                    Showing {filtered.length} orders
                </div>
            </div>
        </div>
    );
};
