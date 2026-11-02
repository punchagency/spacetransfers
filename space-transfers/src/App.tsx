import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import IntroAnimation from "./components/IntroAnimation";
/*
 * The editor is most of the store's code. Loaded on its own, so the legal
 * pages and the 404 page arrive without it, and the builder fetches it while
 * the intro plays.
 */
const loadEditor = () => import("./components/Editor");
const Editor = lazy(loadEditor);
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { hydratePricePerSqFt, watchPricingSettings } from "./lib/utils/pricingRates";
import { resolveRoute } from "./lib/route";
import LegalPage from "./pages/LegalPage";
import NotFoundPage from "./pages/NotFoundPage";
import RightsCenter from "./components/rights/RightsCenter";

export default function App() {
  const route = resolveRoute(window.location.pathname);
  if (route.kind === "legal") return <LegalPage docId={route.docId} />;
  if (route.kind === "notFound") return <NotFoundPage />;
  return <Builder />;
}

function Builder() {
  const [showHome, setShowHome] = useState(() => {
    try {
      return Boolean(new URLSearchParams(window.location.search).get("resetToken"));
    } catch {
      return false;
    }
  });

  // The retail rate is the admin's to set, so it is fetched rather than
  // compiled in. Done once here, at the root, because the editor prices a sheet
  // as soon as the first item lands on the board.
  useEffect(() => {
    void loadEditor();
    hydratePricePerSqFt();
    // Picks up an admin changing the rate or the sheet minimum without needing
    // the customer to reload.
    return watchPricingSettings();
  }, []);

  return (
    <>
      {/* Its own boundary: it sits outside the page's, and a crash in it (a
          browser extension rewriting the page is enough) blanked everything. */}
      <ErrorBoundary name="Notifications" fallback={null}>
        <Toaster position="top-center" containerStyle={{ top: 80 }} gutter={10} />
      </ErrorBoundary>
      <ErrorBoundary name="Rights reviews" fallback={null}>
        <RightsCenter />
      </ErrorBoundary>
      {/* Last resort: each part of the editor has its own boundary, so this
          only shows if the page as a whole fails — instead of a blank screen. */}
      <ErrorBoundary name="The page" fullPage>
        {!showHome ? (
          <IntroAnimation onComplete={() => setShowHome(true)} />
        ) : (
          <Suspense fallback={<div className="min-h-dvh bg-[#f5f7fb]" aria-busy="true" />}>
            <Editor />
          </Suspense>
        )}
      </ErrorBoundary>
    </>
  );
}
