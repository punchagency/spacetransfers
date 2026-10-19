import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import AuthPage from "./pages/AuthPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import SetPasswordPage from "./pages/SetPasswordPage";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import OrderDetails from "./pages/OrderDetails";
import Earnings from "./pages/Earnings";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { NotificationsStoreProvider } from "./state/NotificationsStore";
import { ProfileStoreProvider } from "./state/ProfileStore";
import { ProtectedRoute, PublicOnlyRoute } from "./components/auth/ProtectedRoute";
import { Toaster } from "react-hot-toast";
import "./App.css";

/**
 * Providers + chrome for the signed-in area. Mounted inside ProtectedRoute so
 * they only ever run with a valid session.
 */
function AuthenticatedShell() {
  return (
    <ProfileStoreProvider>
      <NotificationsStoreProvider>
        <DashboardLayout />
      </NotificationsStoreProvider>
    </ProfileStoreProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <ErrorBoundary fullPage>
      <Routes>
        {/* Public email verification — reachable without a session. */}
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />

        {/* Public — a signed-in printer is bounced to the dashboard. */}
        <Route element={<PublicOnlyRoute />}>
          <Route path="/auth" element={<AuthPage />} />
        </Route>

        {/* Everything below requires a valid, unexpired PRINTER session. */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AuthenticatedShell />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/:jobId" element={<OrderDetails />} />
            <Route path="/earnings" element={<Earnings />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
