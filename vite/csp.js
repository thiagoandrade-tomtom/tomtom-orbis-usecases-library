/* Content Security Policy — the model gateway's origin.

   The policy itself lives in a <meta> in each entry HTML (index.html,
   split.html), explained line by line there. One origin can't be written
   down in advance: Ask the map's optional model gateway, set per build in
   VITE_AGENT_GATEWAY_URL. When it is set, this plugin adds its origin to
   connect-src, so the case can reach it; unset (the default, demo mode),
   the policy ships as written. */

import { loadEnv } from 'vite';

export function cspGateway() {
  let origin = '';
  return {
    name: 'csp-gateway',
    configResolved(config) {
      const url = loadEnv(config.mode, config.envDir || config.root, 'VITE_').VITE_AGENT_GATEWAY_URL;
      if (url) origin = new URL(url).origin;
    },
    transformIndexHtml(html) {
      if (!origin) return html;
      return html.replace(/(content="[^"]*connect-src 'self')/, `$1 ${origin}`);
    },
  };
}
