/* MapLibre 6 worker in Vite dev.

   MapLibre 6's worker is an ES module (maplibre-gl-worker.mjs, importing
   maplibre-gl-shared.mjs) with a dynamic `import()` for plugins. In dev,
   Vite rewrites that import through `/@vite/client` — and the client
   touches `document`, which a worker doesn't have. The worker dies on
   load, so the map never becomes ready ("document is not defined").

   This plugin serves the two worker files straight from node_modules,
   untransformed, and points `…/maplibre-gl-worker.mjs?worker&url` at them
   in dev only. Production builds are untouched: Vite bundles the worker
   into one self-contained file there. App code stays the same in both:

     import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
     maplibregl.setWorkerUrl(workerUrl);
*/

import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const PREFIX = '/__maplibre-worker/';
const FILES = /^maplibre-gl-(worker|shared)(-dev)?\.mjs$/;

export function maplibreWorker() {
  let dist = '';
  return {
    name: 'maplibre-worker-dev',
    apply: 'serve',
    enforce: 'pre',
    configResolved(config) {
      const require = createRequire(join(config.root, 'package.json'));
      dist = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
    },
    load(id) {
      if (/maplibre-gl-worker\.mjs\?worker&url$/.test(id)) {
        return `export default ${JSON.stringify(PREFIX + 'maplibre-gl-worker.mjs')};`;
      }
    },
    configureServer(server) {
      server.middlewares.use(PREFIX, (req, res, next) => {
        const file = (req.url || '').split('?')[0].replace(/^\//, '');
        if (!FILES.test(file)) return next();
        res.setHeader('Content-Type', 'text/javascript');
        createReadStream(join(dist, file)).on('error', () => next()).pipe(res);
      });
    },
  };
}
