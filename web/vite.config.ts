import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { BOOT } from './shared/boot.js'

/**
 * Puts BOOT at the top of <head>.
 *
 * It has to run before the first frame is composed: it stamps the reader's nav
 * placement, theme and mode onto <html> out of localStorage, and anything later
 * shows the default and then jumps. layout.tsx used next/script with
 * strategy="beforeInteractive" for the same reason.
 *
 * Injected rather than written into index.html because the string is built out
 * of the key names and theme list in src/lib/boot.ts, which the components read
 * too - a copy in the HTML would drift from them silently.
 */
function bootScript(): Plugin {
  return {
    name: 'smartnews-boot',
    transformIndexHtml: () => [
      { tag: 'script', children: BOOT, injectTo: 'head-prepend' },
    ],
  }
}

export default defineConfig({
  plugins: [
    // Must precede the react plugin: it generates routeTree.gen.ts from src/routes.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    bootScript(),
    // Shares the Next app's local D1/KV state so both dev servers read one database.
    cloudflare({ persistState: { path: '../.wrangler/state' } }),
  ],
})
