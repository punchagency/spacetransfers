/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'node:path'
import type { PluginOption, ResolvedConfig } from 'vite'

/**
 * Uploads the build's source maps to Sentry, so a reported error points at the
 * real file and line, then deletes them so the site never serves them. Only
 * when SENTRY_AUTH_TOKEN is set (production builds); other builds are as before.
 */
const SENTRY_AUTH_TOKEN = (process.env.SENTRY_AUTH_TOKEN || '').trim()
const sentrySourceMaps = (project: string): PluginOption[] => {
  if (!SENTRY_AUTH_TOKEN) return []
  let mapsIn: (glob: string) => void = () => {}
  const builtMaps = new Promise<string>((resolve) => (mapsIn = resolve))
  return [
    // The maps are wherever this build writes, which isn't always dist/.
    { name: 'space-transfers-built-maps', configResolved: (config: ResolvedConfig) => mapsIn(path.join(path.resolve(config.root, config.build.outDir), '**/*.map')) },
    sentryVitePlugin({
      org: 'space-transfers',
      project,
      authToken: SENTRY_AUTH_TOKEN,
      telemetry: false,
      release: { create: false, finalize: false, inject: false },
      sourcemaps: { filesToDeleteAfterUpload: builtMaps },
    }),
  ]
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...sentrySourceMaps('space-transfers-admin'),
  ],
  // "hidden": maps are made for the upload but never linked from the code.
  ...(SENTRY_AUTH_TOKEN ? { build: { sourcemap: 'hidden' as const } } : {}),
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
