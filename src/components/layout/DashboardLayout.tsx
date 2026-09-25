import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { PageBoundary } from "../common/ErrorBoundary";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export const DashboardLayout = () => {
  /** Only meaningful below `md`, where the menu is a drawer rather than a column. */
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // A new page means the drawer has done its job.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Escape closes it, like every other overlay in the app.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    /*
     * `dvh` with `vh` as the fallback: on a phone `100vh` means the viewport
     * with the browser's toolbars hidden, so the app is taller than the screen
     * and the page drifts under the address bar.
     */
    <div className="flex h-screen supports-[height:100dvh]:h-dvh bg-gray-50 overflow-hidden">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      {menuOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
        />
      )}
      <main className="flex-1 flex flex-col h-full min-w-0">
        <Topbar onOpenMenu={() => setMenuOpen(true)} />
        <div className="flex-1 overflow-y-auto">
          <section className="p-4 md:p-6 space-y-4 md:space-y-6 min-h-full">
            {/* A failing page stays inside the layout, so the menu still works. */}
            <PageBoundary>
              <Outlet />
            </PageBoundary>
          </section>
        </div>
      </main>
    </div>
  );
};
