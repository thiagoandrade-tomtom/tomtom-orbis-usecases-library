/* Vite config — keeps the local dev server happy and tells the production
   build that, on GitHub Pages, the site is served from a subpath
   (https://<user>.github.io/<repo>/) so all asset URLs need that prefix.

   When developing locally `base` is left as the default ('/'), so `npm run
   dev` keeps working from the project root with no surprises. */

import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/tomtom-orbis-usecases-library/' : '/',
}));
