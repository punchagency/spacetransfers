import { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import IntroAnimation from "./components/IntroAnimation";
import Editor from "./components/Editor";
import { hydratePricePerSqFt } from "./lib/utils/pricingRates";

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
  }, []);

  return (
    <>
      {/*
        `containerStyle.top` rather than a margin on the cards themselves.
        react-hot-toast stacks by measuring each toast with
        `getBoundingClientRect().height` and translating the next one down by
        the running total — and that measurement excludes margins. `NoticeCard`
        used to carry its own `mt-16`, which was invisible to that maths, so a
        second notice was positioned 64px too high and landed on top of the
        first. Every notice needing the same clearance, the header's height is
        the container's business, not each card's.

        80px = the toaster's own 16px inset plus the 64px the cards used to add,
        so notices sit exactly where they always have, clear of the 40px header.
      */}
      <Toaster position="top-center" containerStyle={{ top: 80 }} gutter={10} />
      {!showHome ? (
        <IntroAnimation onComplete={() => setShowHome(true)} />
      ) : (
        <Editor />
      )}
    </>
  );
}
