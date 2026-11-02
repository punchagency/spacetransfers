/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "node:path";
import type { PluginOption, ResolvedConfig } from "vite";

/**
 * Uploads the build's source maps to Sentry, so a reported error points at the
 * real file and line, then deletes them so the site never serves them. Only
 * when SENTRY_AUTH_TOKEN is set (production builds); other builds are as before.
 */
const SENTRY_AUTH_TOKEN = (process.env.SENTRY_AUTH_TOKEN || "").trim();
const sentrySourceMaps = (project: string): PluginOption[] => {
  if (!SENTRY_AUTH_TOKEN) return [];
  let mapsIn: (glob: string) => void = () => {};
  const builtMaps = new Promise<string>((resolve) => (mapsIn = resolve));
  return [
    // The maps are wherever this build writes, which isn't always dist/.
    { name: "space-transfers-built-maps", configResolved: (config: ResolvedConfig) => mapsIn(path.join(path.resolve(config.root, config.build.outDir), "**/*.map")) },
    sentryVitePlugin({
      org: "space-transfers",
      project,
      authToken: SENTRY_AUTH_TOKEN,
      telemetry: false,
      release: { create: false, finalize: false, inject: false },
      sourcemaps: { filesToDeleteAfterUpload: builtMaps },
    }),
  ];
};

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
  plugins: [react(), tailwindcss(), siteUrlPlugin(), ...sentrySourceMaps("space-transfers-partner")],
  // "hidden": maps are made for the upload but never linked from the code.
  ...(SENTRY_AUTH_TOKEN ? { build: { sourcemap: "hidden" as const } } : {}),
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
