/* Vite config — keeps the local dev server happy and tells the production
   build that, on GitHub Pages, the site is served from a subpath
   (https://<user>.github.io/<repo>/) so all asset URLs need that prefix.

   When developing locally `base` is left as the default ('/'), so `npm run
   dev` keeps working from the project root with no surprises. */

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { maplibreWorker } from './vite/maplibre-worker.js';

const entry = name => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig(({ command, isPreview }) => ({
  // `vite preview` serves the built site, so it needs the same subpath.
  base: command === 'build' || isPreview ? '/tomtom-orbis-usecases-library/' : '/',
  // MapLibre 6's worker can't go through Vite's dev transform — see the plugin.
  plugins: [maplibreWorker()],
  build: {
    /* Multi-page: each screen shell is its own entry HTML → its own URL.
       `index.html` = Full map (default); `split.html` = docked sidebar.
       Add future shells (embed, kiosk, …) here as new inputs. */
    rollupOptions: {
      input: {
        main:  entry('index.html'),
        split: entry('split.html'),
      },
    },
    /* esbuild's CSS minifier preserves declarations the source intends to
       ship (e.g. unprefixed `backdrop-filter` alongside `-webkit-…`).
       Lightningcss — Vite 8's default — aggressively prunes properties it
       deems redundant for its browserslist targets, which broke the
       password gate's blur in Chrome. */
    cssMinify: 'esbuild',
  },
}));
