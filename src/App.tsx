import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AuthPage from "./pages/AuthPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import OrderDetails from "./pages/OrderDetails";
import PrintQueue from "./pages/PrintQueue";
import Earnings from "./pages/Earnings";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { NotificationsStoreProvider } from "./state/NotificationsStore";
import { ProfileStoreProvider } from "./state/ProfileStore";
import { Toaster } from "react-hot-toast";
import "./App.css";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem("printer_token"));

  const handleLogin = () => {
    setIsAuthenticated(true);
  };

  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <Routes>
        {/* Public email verification route — no auth required */}
        <Route path="/verify-email" element={<VerifyEmailPage />} />

        <Route
          path="/auth"
          element={
            isAuthenticated ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <AuthPage onLogin={handleLogin} />
            )
          }
        />

        <Route
          element={
            isAuthenticated ? (
              <ProfileStoreProvider>
                <NotificationsStoreProvider>
                  <DashboardLayout />
                </NotificationsStoreProvider>
              </ProfileStoreProvider>
            ) : (
              <Navigate to="/auth" replace />
            )
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:jobId" element={<OrderDetails />} />
          <Route path="/print-queue" element={<PrintQueue />} />
          <Route path="/earnings" element={<Earnings />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        {/* Catch all - redirect based on auth status */}
        <Route
          path="*"
          element={
            <Navigate to={isAuthenticated ? "/dashboard" : "/auth"} replace />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
