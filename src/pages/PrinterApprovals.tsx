import { useState, useEffect } from 'react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { apiFetch } from '../utils/api';
import toast from 'react-hot-toast';
import { FiCheck, FiX, FiClock, FiAlertTriangle, FiMapPin } from 'react-icons/fi';

interface PendingPrinter {
  id: string;
  name: string;
  companyName: string;
  email: string;
  phone: string;
  createdAt: string;
  // Both can be null: geocoding fails sometimes, and registration stores no
  // region rather than guessing one.
  region: string | null;
  location: string | null;
}

export const PrinterApprovals = () => {
  const [pendingPrinters, setPendingPrinters] = useState<PendingPrinter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  /*
   * A failed load used to be indistinguishable from an empty queue: the catch
   * fired a toast, the list stayed empty, and the page rendered a green tick
   * and "All caught up!". The toast fades after a few seconds; the false
   * reassurance stays on screen, so an admin walks away from a queue of waiting
   * applications believing there were none.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchPendingPrinters = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const data = await apiFetch('/admin/partners/pending');
      // The endpoint returns a bare array; anything else means the shape moved
      // and `.map` below would throw mid-render.
      setPendingPrinters(Array.isArray(data) ? data : []);
      if (!Array.isArray(data)) {
        setLoadError('The server returned an unexpected response for the approval queue.');
      }
    } catch (error: any) {
      const message = error.message || 'Failed to fetch pending printers';
      setLoadError(message);
      setPendingPrinters([]);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingPrinters();
  }, []);

  const handleApprove = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await apiFetch(`/admin/partners/${id}/approve`, { method: 'POST' });
      toast.success('Printer approved successfully');
      setPendingPrinters(prev => prev.filter(p => p.id !== id));
    } catch (error: any) {
      toast.error(error.message || 'Failed to approve printer');
      // The server rejects anything no longer Pending. That means this list is
      // stale, so reload it rather than leaving a row that cannot be acted on.
      fetchPendingPrinters();
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id: string) => {
    if (busyId) return;
    if (!window.confirm('Are you sure you want to reject this printer?')) return;
    setBusyId(id);
    try {
      await apiFetch(`/admin/partners/${id}/reject`, { method: 'POST' });
      toast.success('Printer registration rejected');
      setPendingPrinters(prev => prev.filter(p => p.id !== id));
    } catch (error: any) {
      toast.error(error.message || 'Failed to reject printer');
      fetchPendingPrinters();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-[24px] font-bold text-gray-900">Printer Approvals</h1>
          <p className="text-gray-500">Review and approve new printer registrations</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading pending printers...</div>
          ) : loadError ? (
            <div className="p-12 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-50 text-red-600 mb-4">
                <FiAlertTriangle size={24} />
              </div>
              <h3 className="text-lg font-medium text-gray-900">Could not load the approval queue</h3>
              <p className="text-gray-500 mt-1">{loadError}</p>
              <p className="text-gray-400 text-sm mt-1">
                There may be printers waiting — this is not an empty queue.
              </p>
              <button
                onClick={fetchPendingPrinters}
                className="mt-4 bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
              >
                Try again
              </button>
            </div>
          ) : pendingPrinters.length === 0 ? (
            <div className="p-12 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-50 text-green-600 mb-4">
                <FiCheck size={24} />
              </div>
              <h3 className="text-lg font-medium text-gray-900">All caught up!</h3>
              <p className="text-gray-500">No pending printer registrations at the moment.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">Company / Name</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">Contact Info</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">Region / Location</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider">Registered At</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pendingPrinters.map((printer) => (
                    <tr key={printer.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="text-sm font-semibold text-gray-900">{printer.companyName}</div>
                        <div className="text-xs text-gray-500">{printer.name}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900">{printer.email}</div>
                        <div className="text-xs text-gray-500">{printer.phone}</div>
                      </td>
                      <td className="px-6 py-4">
                        {printer.region ? (
                          <div className="text-sm font-medium text-gray-900">{printer.region}</div>
                        ) : (
                          /*
                           * Called out rather than left blank: a partner with no
                           * region is invisible to assignment, so approving one
                           * creates a partner who will never be sent work.
                           */
                          <div
                            className="text-sm font-medium text-amber-700"
                            title="No region could be derived from their address. Assignment routes on region, so this partner would not receive orders until it is set."
                          >
                            No region
                          </div>
                        )}
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <FiMapPin size={12} />
                          {printer.location || 'No address on file'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-sm text-gray-500">
                          <FiClock size={14} />
                          {new Date(printer.createdAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleApprove(printer.id)}
                            disabled={busyId !== null}
                            className="inline-flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <FiCheck /> {busyId === printer.id ? 'Approving…' : 'Approve'}
                          </button>
                          <button
                            onClick={() => handleReject(printer.id)}
                            disabled={busyId !== null}
                            className="inline-flex items-center gap-1 bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <FiX /> Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};
