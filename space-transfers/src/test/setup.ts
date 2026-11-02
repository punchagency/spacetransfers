import "@testing-library/jest-dom";

/**
 * `matchMedia` stub.
 *
 * jsdom does not implement it, and anything that checks
 * `prefers-reduced-motion` throws on render rather than degrading — which
 * includes react-hot-toast's `<Toaster>`, so no notice can be tested without
 * this. Reports "no preference" so components take their ordinary animated
 * path, which is the one worth exercising.
 */
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
