/* Scene registry. Keys must match the `mapType` field on a use-case entry.

   Each scene is a default export of an async function:
       (ctx: SceneContext, useCase: UseCase) => Promise<void>

   The context tracks every resource the scene adds, so scenes never need to
   write their own teardown logic. Just `ctx.addSource / addLayer / addMarker`.

   Adding a new use case = drop a file in this folder + register it here +
   add a row in data/use-cases.js. No other wiring required. */

import route       from './route.js';
import heatmap     from './_stubs/heatmap.js';
import poi         from './_stubs/poi.js';
import multistop   from './_stubs/multistop.js';
import fleet       from './_stubs/fleet.js';
import packageScn  from './_stubs/package.js';
import delivery    from './_stubs/delivery.js';
import city        from './_stubs/city.js';
import realestate  from './_stubs/realestate.js';
import sport       from './_stubs/sport.js';
import sharing     from './_stubs/sharing.js';
import ev          from './_stubs/ev.js';

export const SCENES = {
  route,
  heatmap,
  poi,
  multistop,
  fleet,
  package: packageScn,
  delivery,
  city,
  realestate,
  sport,
  sharing,
  ev,
};

export function getScene(mapType) {
  const fn = SCENES[mapType];
  if (!fn) throw new Error(`No scene registered for mapType="${mapType}"`);
  return fn;
}
