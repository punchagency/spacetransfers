import { useSyncExternalStore } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { isAuthenticated, mustEnrollPasskey, subscribeToAuth } from "../../utils/auth";
import { PasskeySetupGate } from "../security/PasskeySetupGate";

/**
 * Live auth state. Subscribing (rather than snapshotting once into useState)
 * is what makes the guard react the moment the session ends — an expired token
 * cleared by a 401, a logout, or a logout in another tab all re-render the
 * guard immediately instead of leaving a dead session on screen.
 */
export function useIsAuthenticated(): boolean {
  return useSyncExternalStore(subscribeToAuth, isAuthenticated, () => false);
}

/**
 * Gate for every authenticated page. Unauthenticated visitors are sent to
 * /auth, and the page they were trying to reach is remembered in location
 * state so login can drop them exactly there instead of a generic dashboard.
 */
export function ProtectedRoute() {
  const authed = useIsAuthenticated();
  const location = useLocation();

  const enrolling = useSyncExternalStore(subscribeToAuth, mustEnrollPasskey, () => false);

  if (!authed) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }
  if (enrolling) return <PasskeySetupGate />;
  return <Outlet />;
}

/**
 * Inverse gate for /auth: a signed-in admin has no business on the login
 * screen, so bounce them to the dashboard (or back to wherever the guard
 * originally intercepted them).
 */
export function PublicOnlyRoute() {
  const authed = useIsAuthenticated();
  const location = useLocation();

  if (authed) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
    return <Navigate to={from || "/dashboard"} replace />;
  }
  return <Outlet />;
}
