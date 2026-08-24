import { useEffect, useState } from 'react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { OrdersTable } from '../components/orders/OrdersTable';
import { FiSearch, FiRefreshCcw } from 'react-icons/fi';
import { useOrdersStore } from '../state/OrdersStore';

const tabs = [
  { label: 'All', value: 'All' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Processing', value: 'PROCESSING' },
  { label: 'Printing', value: 'PRINTING' },
  { label: 'Shipped', value: 'SHIPPED' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Rejected', value: 'REJECTED' },
];

export const Orders = () => {
  const [activeTab, setActiveTab] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  // Debounced so typing doesn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const { ordersList, loadingList, nextCursor, fetchOrdersList } = useOrdersStore();

  useEffect(() => {
    fetchOrdersList({ status: activeTab, cursor: null, append: false, search: debouncedSearch });
  }, [activeTab, debouncedSearch, fetchOrdersList]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => window.clearTimeout(id);
  }, [searchTerm]);

  const handleLoadMore = () => {
    if (nextCursor) {
      fetchOrdersList({ status: activeTab, cursor: nextCursor, append: true, search: debouncedSearch });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Order Management</h1>
            <p className="text-gray-500">View and manage all orders across your network</p>
          </div>
          <button 
            onClick={() => fetchOrdersList({ status: activeTab, cursor: null, append: false, search: debouncedSearch })}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FiRefreshCcw className={loadingList ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-gray-200 shadow-sm overflow-x-auto no-scrollbar">
          {tabs.map((tab) => (
            <button
              key={tab.label}
              onClick={() => setActiveTab(tab.value)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all rounded-lg whitespace-nowrap
                ${activeTab === tab.value
                  ? 'bg-blue-50 text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <FiSearch className="text-gray-400" />
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Search orders"
            placeholder="Search by order number, customer name or email"
            className="pl-10 pr-4 py-2 border border-gray-200 rounded-xl w-full text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white shadow-sm placeholder:text-gray-400"
          />
        </div>

        {loadingList && ordersList.length === 0 ? (
          <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-center items-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
            <span className="mt-4 text-gray-500">Loading orders...</span>
          </div>
        ) : (
          <div className="space-y-4">
            <OrdersTable orders={ordersList} title="Orders" itemsPerPage={15} />
            
            {nextCursor && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingList}
                  className="px-6 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-blue-600 transition-all shadow-sm disabled:opacity-50"
                >
                  {loadingList ? 'Loading...' : 'Load More Orders'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};
