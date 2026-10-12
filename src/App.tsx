import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { ErrorBoundary, PageBoundary } from './components/common/ErrorBoundary';
import AuthPage from './pages/AuthPage';
import { Dashboard } from './pages/Dashboard';
import { Orders } from './pages/Orders';
import { OrderDetails } from './pages/OrderDetails';
import { FulfilmentPartners } from './pages/FulfilmentPartners';
import { PrinterApprovals } from './pages/PrinterApprovals';
import { PartnerDetails } from './pages/PartnerDetails';
import { Earnings } from './pages/Earnings';
import { Payouts } from './pages/Payouts';
import { Issues } from './pages/Issues';
import { Profile } from './pages/Profile';
import { Settings } from './pages/Settings';
import { Toaster } from 'react-hot-toast';
import { OrdersStoreProvider } from './state/OrdersStore';
import { NotificationsStoreProvider } from './state/NotificationsStore';
import { ProtectedRoute, PublicOnlyRoute } from './components/auth/ProtectedRoute';
import './App.css';

/**
 * Stores for the signed-in area. Mounted inside ProtectedRoute so they only
 * ever run with a valid session — NotificationsStore fetches on mount, and
 * wrapping the whole app meant it fired an unauthenticated request on the
 * login screen every time.
 *
 * Pages render their own DashboardLayout, so this is a provider shell only.
 */
function AuthenticatedShell() {
    return (
        <NotificationsStoreProvider>
            <OrdersStoreProvider>
                <PageBoundary>
                    <Outlet />
                </PageBoundary>
            </OrdersStoreProvider>
        </NotificationsStoreProvider>
    );
}

function App() {
    return (
        <BrowserRouter>
            <Toaster position="top-right" />
            <ErrorBoundary fullPage>
            <Routes>
                {/* Public — a signed-in admin is bounced to the dashboard. */}
                <Route element={<PublicOnlyRoute />}>
                    <Route path="/auth" element={<AuthPage />} />
                </Route>

                {/* Everything below requires a valid, unexpired ADMIN session. */}
                <Route element={<ProtectedRoute />}>
                    <Route element={<AuthenticatedShell />}>
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/orders" element={<Orders />} />
                        <Route path="/dashboard/orders/:id" element={<OrderDetails />} />
                        <Route path="/fulfilment-partners" element={<FulfilmentPartners />} />
                        <Route path="/printer-approvals" element={<PrinterApprovals />} />
                        <Route path="/dashboard/fulfilment-partners/:id" element={<PartnerDetails />} />
                        <Route path="/earnings" element={<Earnings />} />
                        <Route path="/issues" element={<Issues />} />
                        <Route path="/payouts" element={<Payouts />} />
                        <Route path="/profile" element={<Profile />} />
                        <Route path="/settings" element={<Settings />} />
                    </Route>
                </Route>

                {/* Unknown path: aim at the dashboard; the guard redirects on to
                    /auth when there's no session, so a stray URL can't log an
                    admin out. */}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
            </ErrorBoundary>
        </BrowserRouter>
    );
}

export default App;
