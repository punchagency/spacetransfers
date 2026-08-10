import { useEffect, useState } from "react";

// Phones are the "< md" range in this app's existing Tailwind breakpoints
// (the Header already hides its detail strip below md). Anything ≥ 768px —
// tablets and desktops — is treated as the full experience and is unaffected.
const MOBILE_QUERY = "(max-width: 767px)";

/**
 * True on phone-sized viewports. Reactive to resize/orientation changes, so UI
 * gated on it (hidden features, responsive branches) updates live. Used both to
 * hide tools that can't be operated smoothly on a phone and to drive the
 * one-time mobile notice.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
