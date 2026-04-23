import { useState, useEffect } from 'react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { apiFetch } from '../utils/api';
import toast from 'react-hot-toast';
import { FiCheck, FiX, FiClock } from 'react-icons/fi';

interface PendingPrinter {
  id: string;
  name: string;
  companyName: string;
  email: string;
  phone: string;
  createdAt: string;
}

export const PrinterApprovals = () => {
  const [pendingPrinters, setPendingPrinters] = useState<PendingPrinter[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPendingPrinters = async () => {
    try {
      setIsLoading(true);
      const data = await apiFetch('/admin/partners/pending');
      setPendingPrinters(data);
    } catch (error: any) {
      toast.error(error.message || 'Failed to fetch pending printers');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingPrinters();
  }, []);

  const handleApprove = async (id: string) => {
    try {
      await apiFetch(`/admin/partners/${id}/approve`, { method: 'POST' });
      toast.success('Printer approved successfully');
      setPendingPrinters(prev => prev.filter(p => p.id !== id));
    } catch (error: any) {
      toast.error(error.message || 'Failed to approve printer');
    }
  };

  const handleReject = async (id: string) => {
    if (!window.confirm('Are you sure you want to reject this printer?')) return;
    try {
      await apiFetch(`/admin/partners/${id}/reject`, { method: 'POST' });
      toast.success('Printer registration rejected');
      setPendingPrinters(prev => prev.filter(p => p.id !== id));
    } catch (error: any) {
      toast.error(error.message || 'Failed to reject printer');
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
                        <div className="flex items-center gap-1 text-sm text-gray-500">
                          <FiClock size={14} />
                          {new Date(printer.createdAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleApprove(printer.id)}
                            className="inline-flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
                          >
                            <FiCheck /> Approve
                          </button>
                          <button
                            onClick={() => handleReject(printer.id)}
                            className="inline-flex items-center gap-1 bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-50 transition-colors"
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
