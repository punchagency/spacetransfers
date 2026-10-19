import { useEffect } from "react";
import PublicPageShell from "./PublicPageShell";

/** An address that is not a page here. Says so plainly and offers the way back. */
export default function NotFoundPage() {
  useEffect(() => {
    document.title = "Page not found — Space Transfers";
    // Tells search engines not to keep this address.
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  return (
    <PublicPageShell>
      <div className="rounded-2xl border border-gray-200 bg-white px-6 py-14 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">404</p>
        <h1 className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">We can't find that page</h1>
        <p className="mx-auto mt-3 max-w-md text-gray-600">
          The address may be mistyped, or the page may have moved. Your saved sheets and cart are safe.
        </p>
        <a href="/" className="mt-6 inline-block rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700">
          Go to the gang sheet builder
        </a>
      </div>
    </PublicPageShell>
  );
}
