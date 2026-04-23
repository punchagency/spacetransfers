import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { type DashboardLayoutProps } from '../../types/dashboard';

export const DashboardLayout = ({ children }: DashboardLayoutProps) => (
  <div className="flex h-screen bg-gray-50 overflow-hidden">
    <Sidebar />
    <main className="flex-1 flex flex-col h-full min-w-0">
      <Topbar />
      <div className="flex-1 overflow-y-auto">
        <section className="p-6 space-y-6 min-h-full">{children}</section>
      </div>
    </main>
  </div>
);
