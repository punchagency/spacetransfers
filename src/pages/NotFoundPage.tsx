import { Link } from "react-router-dom";

/** An address that is not a page here. */
export const NotFoundPage = () => (
  <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] p-4">
    <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">404</p>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">We can't find that page</h1>
      <p className="mt-2 text-sm text-gray-500">The address may be mistyped, or the page may have moved.</p>
      <Link to="/dashboard" className="mt-6 inline-block rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700">
        Go to the dashboard
      </Link>
    </div>
  </div>
);
