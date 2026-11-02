import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { type DashboardLayoutProps } from '../../types/dashboard';

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  /** Only meaningful below `md`, where the menu is a drawer rather than a column. */
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // A new page means the drawer has done its job.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Escape closes it, like every other overlay here.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    /*
     * `dvh` with `vh` as the fallback: on a phone `100vh` counts the viewport
     * with the browser toolbars hidden, which leaves the app taller than the
     * screen and drifting under the address bar.
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
          <section className="p-4 md:p-6 space-y-4 md:space-y-6 min-h-full">{children}</section>
        </div>
      </main>
    </div>
  );
};
