import type { ReactNode } from "react";
import { LEGAL_PAGES } from "../lib/route";

/**
 * The frame for the store's standalone pages: the brand and the legal links.
 * It scrolls itself, because the builder keeps the body fixed to the screen.
 */
export default function PublicPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-y-auto bg-slate-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center px-4 py-3 sm:px-6">
          <a href="/" className="flex items-center gap-2 font-semibold text-gray-900">
            <span className="text-lg tracking-tight">spacetransfers</span>
            <img src="/space.svg" alt="" className="h-9 w-9" />
          </a>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>
      <footer className="border-t border-gray-200 bg-white">
        <nav aria-label="Legal" className="mx-auto flex max-w-3xl flex-wrap gap-x-5 gap-y-2 px-4 py-5 text-sm text-gray-500 sm:px-6">
          {LEGAL_PAGES.map((page) => (
            <a key={page.slug} href={page.path} className="hover:text-gray-800 hover:underline">
              {page.title}
            </a>
          ))}
        </nav>
      </footer>
    </div>
  );
}
