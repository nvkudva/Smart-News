import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
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

/**
 * Emits sw.js with a version stamped into it.
 *
 * The version is a hash of the built asset filenames, which are themselves
 * content hashes - so it moves when the app moves and stays put when an
 * unchanged tree is rebuilt.
 *
 * That it changes at all is the point. The Next worker was byte-identical
 * between deploys, so the browser found nothing new, `updatefound` never fired,
 * and UpdateBanner had to poll /BUILD_ID to discover what the update cycle
 * could not tell it. One changing line here replaces that whole mechanism.
 *
 * Written from sw/sw.js rather than public/: files in public are copied
 * verbatim and never see a substitution.
 */
function serviceWorker(): Plugin {
  return {
    name: 'smartnews-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      // Client build only. The Worker build runs through this config too, and
      // has no /assets output to hash.
      const assets = Object.keys(bundle).filter((f) => f.startsWith('assets/')).sort()
      if (assets.length === 0) return

      const version = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12)
      const source = readFileSync(new URL('./sw/sw.js', import.meta.url), 'utf8')
        .replace('__SW_VERSION__', version)

      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  plugins: [
    // Must precede the react plugin: it generates routeTree.gen.ts from src/routes.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    bootScript(),
    serviceWorker(),
    // Shares the Next app's local D1/KV state so both dev servers read one database.
    cloudflare({ persistState: { path: '../.wrangler/state' } }),
  ],
})
