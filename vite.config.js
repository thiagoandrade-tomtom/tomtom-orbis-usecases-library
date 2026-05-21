/* Vite config — keeps the local dev server happy and tells the production
   build that, on GitHub Pages, the site is served from a subpath
   (https://<user>.github.io/<repo>/) so all asset URLs need that prefix.

   When developing locally `base` is left as the default ('/'), so `npm run
   dev` keeps working from the project root with no surprises. */

import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/tomtom-orbis-usecases-library/' : '/',
  build: {
    /* Vite 8 defaults CSS minification to lightningcss, which auto-prunes
       "redundant" properties based on its browserslist targets. In this
       project it dropped the unprefixed `backdrop-filter` (keeping only
       `-webkit-backdrop-filter`), so Chrome rendered the password gate
       without a blurred backdrop. Use esbuild's CSS minifier instead —
       it minifies whitespace + colours but doesn't rewrite/prune
       declarations, which keeps the source's intent intact. */
    cssMinify: 'esbuild',
  },
}));
