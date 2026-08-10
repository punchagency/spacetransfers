import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
/**
 * Makes the social-preview URLs absolute at build time.
 *
 * Open Graph wants an absolute `og:image`, and X/Twitter refuses a relative one
 * outright — a relative path is a common reason a shared link renders as a bare
 * URL with no card. The site's own origin isn't knowable from inside the bundle,
 * so it comes from `VITE_SITE_URL` at build time:
 *
 *   VITE_SITE_URL=https://app.spacetransfers.com npm run build
 *
 * Left unset, `%SITE%` collapses to nothing and the tags fall back to a
 * root-relative `/og-image.png`. Most scrapers (Slack, Facebook, LinkedIn,
 * iMessage) resolve that against the page URL, so previews still work
 * everywhere except X — a graceful degradation rather than a broken tag.
 *
 * Done with a plugin rather than Vite's built-in `%VITE_FOO%` substitution
 * because that leaves the literal placeholder in the HTML when the variable is
 * undefined, which would ship `%SITE%/og-image.png` as a real URL.
 */
const siteUrlPlugin = () => {
  const siteUrl = (process.env.VITE_SITE_URL || '').trim().replace(/\/+$/, '');
  return {
    name: 'space-transfers-site-url',
    transformIndexHtml: (html) => html.split('%SITE%').join(siteUrl),
  };
};

export default defineConfig({
  plugins: [react(), tailwindcss(), siteUrlPlugin()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    exclude: ['@imgly/background-removal'],
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  }
})
