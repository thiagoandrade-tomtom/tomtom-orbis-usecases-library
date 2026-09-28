#!/usr/bin/env node
/* Bake the Neighbourhood analysis data for the curated cities.

     node scripts/build-walk-snapshots.mjs            # every curated city
     node scripts/build-walk-snapshots.mjs saopaulo   # just these

   Writes public/data/walk/<region>.json. For a listed city the scene reads
   ONLY that file — no Search, Routing or Geocoding call at runtime, not
   even on click. POIs and admin boundaries change slowly; re-run this
   every few months, or when a city is added to REGIONS.

   What gets baked, all from TomTom:
     1. The municipality outline (Geocoding → Admin Boundaries). It bounds
        the map, so the honeycomb takes the city's shape instead of a disc.
     2. The bairros: reverse-geocode a 2 km lattice inside the outline at
        the region's `level`, dedupe by boundary id, fetch each polygon.
        A second pass reverse-geocodes any hex-sized hole the lattice
        missed, so small central districts (Sé is ~2 km²) are not dropped.
     3. The four signals: a 3 km anchor lattice, one Nearby Search per
        (anchor × signal), radius 2.2 km. A saturated anchor whose page
        still reached ≥400 m splits once into four smaller ones; a page
        that saturates tighter than that is a dense core, and the scene's
        density estimate handles it for free.

   Format (coordinates of POIs / anchors are integer metres east / north
   of `center`; polygons stay lon/lat, rounded to 5 decimals ≈ 1 m):
     outline                GeoJSON geometry of the municipality
     bairros[]              { id, name, geometry }
     fields.<key>.p         flat [x, y, x, y, …] of de-duplicated POIs
     fields.<key>.n         names, parallel to p (signals with `names`)
     fields.<key>.a         anchors [x, y, coveredM, densityPerKm2 (0 = none), reachM] */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_SPECS, REGIONS, PAGE, isSaturated, projector, inGeometry } from '../src/scenes/_stubs/walk-grade-spec.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'walk');

const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split('\n')
  .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map(m => [m[1], m[2]]));
const KEY = process.env.VITE_TOMTOM_API_KEY || env.VITE_TOMTOM_API_KEY;
if (!KEY) { console.error('VITE_TOMTOM_API_KEY is not set (.env)'); process.exit(1); }

const BAIRRO_LATTICE = 2000;
const SPACING = 3000, RADIUS = 2200;
const CHILD_OFF = 750, CHILD_RADIUS = 1100, CHILD_REACH = 1500;
const SPLIT_MIN_COVERED = 400;
const RATE_PER_S = 4;            // a notch under the ~5/s limit, so a browser tab can share the key

const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const regions = only.length ? only : Object.keys(REGIONS);
for (const r of regions) if (!REGIONS[r]) { console.error(`Unknown region "${r}". Known: ${Object.keys(REGIONS).join(', ')}`); process.exit(1); }

let calls = 0, nextSlot = 0;
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const now = Date.now(), at = Math.max(now, nextSlot);
    nextSlot = at + 1000 / RATE_PER_S;
    if (at > now) await new Promise(r => setTimeout(r, at - now));
    calls++;
    const res = await fetch(url);
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      await new Promise(r => setTimeout(r, Math.min(10_000, 500 * 2 ** attempt)));
      continue;
    }
    throw new Error(`${res.status} ${url.replace(KEY, '…')}`);
  }
}

const API = 'https://api.tomtom.com';
const round5 = v => Math.round(v * 1e5) / 1e5;
const roundGeom = g => ({
  type: g.type,
  coordinates: g.type === 'Polygon'
    ? g.coordinates.map(r => r.map(([x, y]) => [round5(x), round5(y)]))
    : g.coordinates.map(p => p.map(r => r.map(([x, y]) => [round5(x), round5(y)]))),
});

/* Admin Boundaries hands back a FeatureCollection; merge its polygons
   into one MultiPolygon geometry. */
async function boundary(id, zoom) {
  const json = await get(`${API}/search/2/additionalData.json?key=${KEY}&geometries=${id}&geometriesZoom=${zoom}`);
  const fc = json.additionalData?.[0]?.geometryData;
  const polys = (fc?.features || [fc]).filter(Boolean).flatMap(f => {
    const g = f.geometry || f;
    return g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  });
  if (!polys.length) return null;
  return roundGeom(polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys });
}

function bboxOf(geom) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = c => typeof c[0] === 'number'
    ? (b[0] = Math.min(b[0], c[0]), b[1] = Math.min(b[1], c[1]), b[2] = Math.max(b[2], c[0]), b[3] = Math.max(b[3], c[1]))
    : c.forEach(walk);
  walk(geom.coordinates);
  return b;
}

/* Lattice over a bbox in metres, `step` apart. */
function lattice(proj, bb, step) {
  const [x0, y0] = proj.toXY([bb[0], bb[1]]), [x1, y1] = proj.toXY([bb[2], bb[3]]);
  const out = [];
  for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) out.push([x, y]);
  return out;
}

async function discoverBairros(proj, outline, level, inCity, gapHex) {
  const bb = bboxOf(outline);
  const found = new Map();
  const probe = async ll => {
    const json = await get(`${API}/search/2/reverseGeocode/${ll[1]},${ll[0]}.json?key=${KEY}&entityType=${level}`).catch(() => null);
    const a = json?.addresses?.[0];
    const id = a?.dataSources?.geometry?.id;
    const name = level === 'Neighbourhood' ? a?.address?.neighbourhood : a?.address?.municipalitySubdivision;
    if (id && name && !found.has(id)) found.set(id, { id, name });
  };
  for (const xy of lattice(proj, bb, BAIRRO_LATTICE)) {
    const ll = proj.toLL(xy);
    if (inCity(ll)) await probe(ll);
  }
  console.log(`  ${found.size} bairros from the lattice`);
  for (const b of found.values()) b.geometry = await boundary(b.id, 13);

  // Gap pass: hex-sized holes inside the outline that no bairro covers.
  let gaps = 0;
  for (const xy of lattice(proj, bb, gapHex * 1.5)) {
    const ll = proj.toLL(xy);
    if (!inCity(ll)) continue;
    if ([...found.values()].some(b => inGeometry(ll, b.geometry))) continue;
    const before = found.size;
    await probe(ll);
    gaps++;
    for (const b of found.values()) if (!b.geometry) b.geometry = await boundary(b.id, 13);
    if (found.size > before) console.log(`  + ${[...found.values()].at(-1).name}`);
  }
  console.log(`  ${gaps} gap probes, ${found.size} bairros total`);
  return [...found.values()].filter(b => b.geometry);
}

async function sampleSignal(key, proj, outline, inCity) {
  const spec = CATEGORY_SPECS[key];
  const seen = new Set(), points = [], names = [], anchors = [];
  const url = ([lon, lat], radius) => {
    const q = `key=${KEY}&lat=${lat}&lon=${lon}&radius=${radius}&limit=${PAGE}`;
    return spec.query
      ? `${API}/search/2/poiSearch/${encodeURIComponent(spec.query)}.json?${q}`
      : `${API}/search/2/nearbySearch/.json?${q}&categorySet=${spec.cat}`;
  };
  const run = async (xy, radius, reach, depth) => {
    const json = await get(url(proj.toLL(xy), radius));
    const all = json.results || [];
    const reached = Math.max(0, ...all.map(r => r.dist || 0));
    if (isSaturated(all.length) && depth === 0 && reached >= SPLIT_MIN_COVERED) {
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        await run([xy[0] + dx * CHILD_OFF, xy[1] + dy * CHILD_OFF], CHILD_RADIUS, CHILD_REACH, 1);
      }
    }
    for (const r of all) {
      if (spec.reject && (r.poi?.categories || []).some(c => spec.reject.test(c))) continue;
      if (spec.rejectName?.test(r.poi?.name || '')) continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const [x, y] = proj.toXY([r.position.lon, r.position.lat]);
      points.push(Math.round(x), Math.round(y));
      if (spec.names) names.push(r.poi?.name || '');
    }
    const sat = isSaturated(all.length);
    const covered = sat ? Math.max(50, reached) : radius;
    const density = sat ? all.length / (Math.PI * (covered / 1000) ** 2) : 0;
    anchors.push([Math.round(xy[0]), Math.round(xy[1]), Math.round(covered), Math.round(density), reach]);
  };
  // Anchors whose search disc touches the city: centre or any of 8 rim points inside.
  const touches = xy => [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)])]
    .some(([dx, dy]) => inCity(proj.toLL([xy[0] + dx * RADIUS, xy[1] + dy * RADIUS])));
  for (const xy of lattice(proj, bboxOf(outline), SPACING)) if (touches(xy)) await run(xy, RADIUS, SPACING, 0);
  return spec.names ? { p: points, n: names, a: anchors } : { p: points, a: anchors };
}

mkdirSync(OUT_DIR, { recursive: true });
for (const region of regions) {
  const cfg = REGIONS[region];
  const t0 = Date.now(), c0 = calls;
  console.log(`${region}: geocoding ${cfg.query}`);
  const g = await get(`${API}/search/2/geocode/${encodeURIComponent(cfg.query)}.json?key=${KEY}&limit=1&entityTypeSet=Municipality`);
  const hit = g.results?.[0];
  if (!hit?.dataSources?.geometry?.id) throw new Error(`No municipality outline for ${cfg.query}`);
  const outline = await boundary(hit.dataSources.geometry.id, 12);
  const center = cfg.center || [hit.position.lon, hit.position.lat];
  const proj = projector(center);

  // Inside the municipality, and within `clipKm` of the centre if set.
  const inCity = ll => inGeometry(ll, outline) && (!cfg.clipKm || Math.hypot(...proj.toXY(ll)) <= cfg.clipKm * 1000);
  let bairros = await discoverBairros(proj, outline, cfg.level, inCity, cfg.hex);
  if (cfg.clipKm) {
    // A neighbourhood straddling the clip stays whole; one that only
    // grazes it goes.
    bairros = bairros.filter(b => {
      const bb = bboxOf(b.geometry);
      return inCity([(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]);
    });
    console.log(`  ${bairros.length} bairros inside ${cfg.clipKm} km`);
  }
  // Sample wide enough to cover every kept neighbourhood, whole.
  const union = bairros.reduce((a, b) => { const bb = bboxOf(b.geometry); return [Math.min(a[0], bb[0]), Math.min(a[1], bb[1]), Math.max(a[2], bb[2]), Math.max(a[3], bb[3])]; },
    [Infinity, Infinity, -Infinity, -Infinity]);
  const inSample = ll => ll[0] >= union[0] && ll[0] <= union[2] && ll[1] >= union[1] && ll[1] <= union[3]
    && (inGeometry(ll, outline) || bairros.some(b => inGeometry(ll, b.geometry)));
  const fields = {};
  for (const key of Object.keys(CATEGORY_SPECS)) {
    fields[key] = await sampleSignal(key, proj, outline, inSample);
    console.log(`  ${key}: ${fields[key].p.length / 2} POIs, ${fields[key].a.length} anchors`);
  }
  const snap = {
    v: 2, region, name: hit.address?.municipality || cfg.query, center, level: cfg.level, hex: cfg.hex,
    builtAt: new Date().toISOString().slice(0, 10), outline, bairros, fields,
  };
  const file = join(OUT_DIR, `${region}.json`);
  writeFileSync(file, JSON.stringify(snap));
  console.log(`${region}: ${calls - c0} calls, ${Math.round((Date.now() - t0) / 1000)} s → ${file}`);
}
