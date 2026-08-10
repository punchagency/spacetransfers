/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Makes the social-preview URLs absolute at build time. See the customer app's
 * vite.config.js for the full rationale.
 *
 *   VITE_SITE_URL=https://printer.spacetransfers.com npm run build
 *
 * Unset, `%SITE%` collapses to nothing and the tags fall back to a root-relative
 * `/og-image.png`, which Slack and iMessage still resolve — the two that matter
 * most for a link shared with a print partner.
 */
const siteUrlPlugin = () => {
  const siteUrl = (process.env.VITE_SITE_URL || "").trim().replace(/\/+$/, "");
  return {
    name: "space-transfers-site-url",
    transformIndexHtml: (html: string) => html.split("%SITE%").join(siteUrl),
  };
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), siteUrlPlugin()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
