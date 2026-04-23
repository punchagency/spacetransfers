import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { OrderHeader } from '../components/orders/OrderHeader';
import { OrderSummary } from '../components/orders/OrderSummary';
import { OrderTimeline } from '../components/orders/OrderTimeline';
import { OrderFinancials } from '../components/orders/OrderFinancials';
import { apiFetch } from '../utils/api';
import toast from 'react-hot-toast';

export const OrderDetails = () => {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrderDetails = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const data = await apiFetch(`/admin/orders/${id}`);
        setOrder(data);
      } catch (error: any) {
        toast.error(error.message || 'Failed to fetch order details');
      } finally {
        setLoading(false);
      }
    };

    fetchOrderDetails();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const poll = async () => {
      try {
        const data = await apiFetch(`/admin/orders/${id}`);
        if (!alive) return;
        setOrder(data);
      } catch {
        if (!alive) return;
      }
    };
    const intervalId = window.setInterval(() => void poll(), 5000);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const ac = new AbortController();
    const token = localStorage.getItem("admin_token");
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const url = `http://localhost:4000/api/orders/${encodeURIComponent(id)}/stream`;

    let buffer = "";
    let pendingRefresh: number | null = null;

    const scheduleRefresh = () => {
      if (pendingRefresh != null) return;
      pendingRefresh = window.setTimeout(() => {
        pendingRefresh = null;
        apiFetch(`/admin/orders/${id}`)
          .then((data) => setOrder(data))
          .catch(() => {});
      }, 250);
    };

    const run = async () => {
      try {
        const resp = await fetch(url, { headers, signal: ac.signal });
        if (!resp.ok || !resp.body) return;
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            if (chunk.includes("event:")) {
              scheduleRefresh();
            }
          }
        }
      } catch {
        return;
      }
    };

    run();

    return () => {
      ac.abort();
      if (pendingRefresh != null) window.clearTimeout(pendingRefresh);
    };
  }, [id]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-500">Loading order details...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!order) {
    return (
      <DashboardLayout>
        <div className="text-center py-20">
          <h2 className="text-2xl font-bold text-gray-900">Order Not Found</h2>
          <p className="text-gray-500 mt-2">The order you are looking for does not exist or you don't have permission to view it.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <OrderHeader orderId={id || ''} status={order.status} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT COLUMN - Order Summary */}
          <div className="lg:col-span-2 space-y-6">
            <OrderSummary order={order} />
          </div>

          {/* RIGHT COLUMN */}
          <div className="lg:col-span-1 space-y-6">
            <OrderTimeline order={order} />
            <OrderFinancials order={order} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};
