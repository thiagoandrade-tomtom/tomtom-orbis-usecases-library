#!/usr/bin/env node
/* Bake the "Find an EV charger" city snapshots.

     node scripts/build-ev-snapshots.mjs              # every city in EV_CITIES
     node scripts/build-ev-snapshots.mjs amsterdam    # just these

   Writes public/data/ev/<city>.json: every EV charging POI (category 7309)
   TomTom Search lists inside the city's square, found by the quadtree in
   src/scenes/_stubs/ev-spec.js. A 12 km box is a few hundred rate-limited
   calls — too slow to run on every visit, but the inventory changes slowly.
   Live availability is NOT baked: the scene always fetches it fresh.

   Format (columnar, parallel arrays; x / y are integer metres east / north
   of `center`):
     x, y      position
     kw        max rated power, whole kW (0 = unknown)
     name      POI name
     addr      freeform address
     conns     "type|kW|count;…" static connector inventory
     avail     Charging Availability id ('' = no live feed) */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EV_CITIES, CAT_EV, PAGE, coverSquare, projector } from '../src/scenes/_stubs/ev-spec.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'ev');

const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split('\n')
  .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map(m => [m[1], m[2]]));
const KEY = process.env.VITE_TOMTOM_API_KEY || env.VITE_TOMTOM_API_KEY;
if (!KEY) { console.error('VITE_TOMTOM_API_KEY is not set (.env)'); process.exit(1); }

const RATE_PER_S = 4;            // a notch under the ~5/s limit, so a browser tab can share the key

const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const cities = only.length ? only : Object.keys(EV_CITIES);
for (const c of cities) if (!EV_CITIES[c]) { console.error(`Unknown city "${c}". Known: ${Object.keys(EV_CITIES).join(', ')}`); process.exit(1); }

let nextSlot = 0;
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const now = Date.now(), at = Math.max(now, nextSlot);
    nextSlot = at + 1000 / RATE_PER_S;
    if (at > now) await new Promise(r => setTimeout(r, at - now));
    const res = await fetch(url);
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      await new Promise(r => setTimeout(r, Math.min(10_000, 500 * 2 ** attempt)));
      continue;
    }
    throw new Error(`${res.status} ${url.replace(KEY, '…')}`);
  }
}

const fetchPage = async ([lon, lat], radius) => {
  const url = new URL('https://api.tomtom.com/search/2/nearbySearch/.json');
  for (const [k, v] of Object.entries({ key: KEY, lat, lon, radius, categorySet: CAT_EV, limit: PAGE })) url.searchParams.set(k, v);
  return (await get(url)).results || [];
};

mkdirSync(OUT_DIR, { recursive: true });
for (const key of cities) {
  const city = EV_CITIES[key];
  const t0 = Date.now();
  // strict: a failed page must fail the bake, not leave a silent hole.
  const { records, calls, saturated, unresolved } = await coverSquare({
    center: city.center, half: city.half, concurrency: RATE_PER_S, strict: true, fetchPage,
  });
  if (unresolved) throw new Error(`${key}: ${unresolved} cells left unresolved`);

  const proj = projector(city.center);
  const out = {
    city: key, label: city.label, center: city.center, half: city.half,
    bakedAt: new Date().toISOString().slice(0, 10), calls, saturated, count: records.length,
    x: [], y: [], kw: [], name: [], addr: [], conns: [], avail: [],
  };
  for (const r of records) {
    const [x, y] = proj.toXY([r.lon, r.lat]);
    out.x.push(Math.round(x)); out.y.push(Math.round(y));
    out.kw.push(r.kw); out.name.push(r.name); out.addr.push(r.addr);
    out.conns.push(r.conns.join(';')); out.avail.push(r.avail);
  }
  writeFileSync(join(OUT_DIR, `${key}.json`), JSON.stringify(out));
  console.log(`${key}: ${records.length} chargers · ${calls} calls · ${saturated} saturated leaves · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
