import { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import IntroAnimation from "./components/IntroAnimation";
import Editor from "./components/Editor";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { hydratePricePerSqFt, watchPricingSettings } from "./lib/utils/pricingRates";

export default function App() {
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
      {/* Last resort: each part of the editor has its own boundary, so this
          only shows if the page as a whole fails — instead of a blank screen. */}
      <ErrorBoundary name="The page" fullPage>
        {!showHome ? (
          <IntroAnimation onComplete={() => setShowHome(true)} />
        ) : (
          <Editor />
        )}
      </ErrorBoundary>
    </>
  );
}
