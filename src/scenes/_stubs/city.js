/* Neighbourhood analysis — which bairros of a city can you live in
   without a car?

   The city is tiled into a honeycomb (~1.2 km cells by default) and every
   cell is graded A+ to F on four things you'd check before moving: a bus
   stop at the corner, a metro or train station within a walk, a
   supermarket, a park. The cells are then rolled up into the city's own
   bairros, so the comparison reads the way a person asks it — "is living
   in Jaguaré harder than living in Moema?" — and the panel ranks every
   bairro on that grade.

   BAKED, NOT LIVE
   A listed city is read from public/data/walk/<region>.json, built offline
   by scripts/build-walk-snapshots.mjs from TomTom Search, Geocoding and
   Admin Boundaries. Opening it makes no API call at all, and neither does
   clicking: POIs and admin boundaries change slowly, and a demo shouldn't
   spend a few hundred rate-limited requests per visitor to recompute the
   same map. A city typed into the search box has no snapshot, so it's
   sampled live (hexes only — discovering its bairros would cost hundreds
   more calls) and painted outwards from the centre as results land.

   SATURATION
   Search caps a page at 100 results. When an anchor saturates, the radius
   of its furthest hit gives the local DENSITY instead (100 in π·r²), and
   the k-th nearest in a field that dense is √(k / πλ) away. Cells outside
   every fully-covered disc take the smaller of what was found and what
   that density implies — so a dense core doesn't read as holes between
   anchors. See walk-grade-spec.js for the four signals and their curves.

   The honeycomb is inserted under the basemap's water layer, so rivers and
   reservoirs (Guarapiranga, Billings) cut it cleanly, and under the roads,
   so the street grid reads through it. */

import { geocode, nearbySearch, poiSearch } from '../../map/services.js';
import { paramFor } from '../../state.js';
import {
  CATEGORY_SPECS, DETOUR, WALK_M_PER_MIN, decayFor, PAGE, isSaturated, projector, inGeometry,
} from './walk-grade-spec.js';

const SIGNALS = Object.fromEntries(Object.entries(CATEGORY_SPECS).map(([key, spec]) => [key, {
  ...spec,
  decay: decayFor(spec),
  fetch: spec.query
    ? (c, r, n) => poiSearch({ query: spec.query, center: c, radius: r, limit: n })
    : (c, r, n) => nearbySearch({ center: c, radius: r, categorySet: spec.cat, limit: n }),
}]));

const searchSignal = (key, center, radius, limit) => {
  const s = SIGNALS[key];
  return s.fetch(center, radius, limit)
    .then(hits => hits.filter(h => h.position
      && !(s.reject && (h.categories || []).some(c => s.reject.test(c)))
      && !s.rejectName?.test(h.name || '')));
};

/* Presets — one question each over the same honeycomb. The legend's two
   ends are named for what the colours mean under THAT question. */
const PRESETS = {
  walk: {
    label: 'Car-free living', lo: 'Car-dependent', hi: 'Car-free',
    note: 'Bus stops, metro and rail, supermarkets and parks within walking distance.',
    weights: { bus: 3, rail: 3, groceries: 3, parks: 1 },
  },
  transit: {
    label: 'Public transport', lo: 'Few options', hi: 'Well connected',
    note: 'A bus stop within a few minutes, and a metro or train station within a walk. Rail counts double.',
    weights: { bus: 1, rail: 2 },
  },
  errands: {
    label: 'Shops & parks', lo: 'Drive for errands', hi: 'On foot',
    note: 'A supermarket and a park within walking distance.',
    weights: { groceries: 2, parks: 1 },
  },
};

/* Every city in the picker has a snapshot (REGIONS in walk-grade-spec.js);
   only a city typed into the search box is sampled live, over a disc. */
const LIVE_SPAN_M = 12_000;
const LIVE_HEX_M = 700;

/* Live anchor lattice: 3 km apart, 2.2 km radius, reaching every point
   of the disc — 16 anchors × 4 signals = 64 calls. */
const ANCHOR_SPACING_M = 3000;
const ANCHOR_RADIUS_M  = 2200;

/* Search allows ~5 requests a second per key. Queueing at that rate is
   faster than bursting: a burst of 8 gets three 429s back, and each of
   those pays a retry backoff longer than the wait it tried to skip. */
const RATE_PER_S = 5;
let nextSlot = 0;
function throttle() {
  const now = performance.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 1000 / RATE_PER_S;
  return at > now ? new Promise(r => setTimeout(r, at - now)) : Promise.resolve();
}

const REACH_M = 3000;                // beyond this (walked) nothing counts
const SHADE_MIN = 4;                 // below this a cell is left unshaded
/* Cell radius. `auto` is the snapshot's own size, fitted to how big that
   city's neighbourhoods are — a Paris quartier is ~1 km², a São Paulo
   distrito ~15. The others scale it. */
const HEX_SCALE = { fine: 0.7, auto: 1, coarse: 1.45 };

/* Thirteen bands, F → A+. */
const GRADES = [
  [92, 'A+'], [85, 'A'], [78, 'A-'], [71, 'B+'], [64, 'B'], [57, 'B-'],
  [50, 'C+'], [43, 'C'], [36, 'C-'], [29, 'D+'], [22, 'D'], [15, 'D-'], [0, 'F'],
];
const gradeOf = s => GRADES.find(([t]) => s >= t)[1];

/* Two ramps. Classic red → amber → yellow → green, the scale walk maps are
   read in; the colour-blind one is viridis-style, monotonic in lightness. */
const RAMPS = {
  classic:    ['#C0392B', '#D9652B', '#E0A030', '#D8C93A', '#9CC43E', '#4CA64C', '#1E7A45'],
  colorblind: ['#46085C', '#443A83', '#31688E', '#21908C', '#35B779', '#8FD744', '#FDE725'],
};
const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function rampColor(ramp, t) {
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const a = hexToRgb(ramp[i]), b = hexToRgb(ramp[i + 1]), f = x - i;
  return '#' + a.map((v, j) => Math.round(v + (b[j] - v) * f).toString(16).padStart(2, '0')).join('');
}

/* Parsed snapshots and live fields survive a scene re-run (preset, cell
   size and palette changes all re-run it). */
const SNAPSHOTS = new Map();
const LIVE_FIELDS = new Map();

/* ── Geometry ──────────────────────────────────────────────────────── */

/* Pointy-top hex grid in axial coordinates over a bbox in metres; `keep`
   returns false to drop a cell, true to keep it, or the bairro that owns
   it. */
function buildHexes(proj, bb, size, keep) {
  const w = Math.sqrt(3) * size, h = 1.5 * size, cells = [];
  const r0 = Math.floor(bb[1] / h), r1 = Math.ceil(bb[3] / h);
  for (let r = r0; r <= r1; r++) {
    const y = r * h;
    for (let q = Math.floor(bb[0] / w - r / 2) - 1; q <= Math.ceil(bb[2] / w - r / 2) + 1; q++) {
      const x = w * (q + r / 2);
      const owner = keep([x, y]);
      if (owner === false) continue;
      const ring = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i - 30);
        ring.push(proj.toLL([x + size * Math.cos(a), y + size * Math.sin(a)]));
      }
      ring.push(ring[0]);
      cells.push({ id: `${q},${r}`, q, r, xy: [x, y], ring, center: proj.toLL([x, y]), bairro: owner === true ? null : owner });
    }
  }
  return cells;
}
const NEIGHBOURS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/* A cell is graded on its centre plus six points halfway to its corners,
   averaged — a 1.2 km cell is a neighbourhood, and grading it on the one
   point at its centre let a single bus stop decide it. */
const samplePoints = ([x, y], size) => [[x, y], ...Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return [x + size * 0.5 * Math.cos(a), y + size * 0.5 * Math.sin(a)];
})];

function projectGeometry(geom, proj) {
  const ring = r => r.map(p => proj.toXY(p));
  return geom.type === 'Polygon'
    ? { type: 'Polygon', coordinates: geom.coordinates.map(ring) }
    : { type: 'MultiPolygon', coordinates: geom.coordinates.map(p => p.map(ring)) };
}
function bboxXY(geom) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = c => typeof c[0] === 'number'
    ? (b[0] = Math.min(b[0], c[0]), b[1] = Math.min(b[1], c[1]), b[2] = Math.max(b[2], c[0]), b[3] = Math.max(b[3], c[1]))
    : c.forEach(walk);
  walk(geom.coordinates);
  return b;
}

/* ── POI field ─────────────────────────────────────────────────────── */

const BUCKET_M = 300;
function makeIndex() {
  const buckets = new Map();
  return {
    add(p) {
      const key = `${Math.floor(p[0] / BUCKET_M)},${Math.floor(p[1] / BUCKET_M)}`;
      let b = buckets.get(key); if (!b) buckets.set(key, b = []);
      b.push(p);
    },
    /* The k nearest points within `maxM`, as [distance, point]. Scans rings
       of buckets outwards and stops once the k-th hit is closer than the
       ring just finished — in a dense core that is one or two rings. */
    nearest(xy, k, maxM) {
      const bx = Math.floor(xy[0] / BUCKET_M), by = Math.floor(xy[1] / BUCKET_M);
      const reach = Math.ceil(maxM / BUCKET_M), d = [];
      for (let ring = 0; ring <= reach; ring++) {
        for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
          for (const p of buckets.get(`${bx + i},${by + j}`) || []) {
            const m = Math.hypot(p[0] - xy[0], p[1] - xy[1]);
            if (m <= maxM) d.push([m, p]);
          }
        }
        if (d.length >= k) {
          d.sort((a, b) => a[0] - b[0]);
          if (d[k - 1][0] <= ring * BUCKET_M) break;
        }
      }
      return d.sort((a, b) => a[0] - b[0]).slice(0, k);
    },
  };
}

const makeField = () => ({ seen: new Set(), index: makeIndex(), anchors: [], done: 0, failed: 0 });

function ingest(field, proj, anchor, hits) {
  for (const h of hits) {
    const id = h.id || `${h.position[0].toFixed(5)},${h.position[1].toFixed(5)}`;
    if (field.seen.has(id)) continue;
    field.seen.add(id);
    field.index.add([...proj.toXY(h.position), h.name || '']);
  }
  const saturated = isSaturated(hits.length);
  const covered = saturated ? Math.max(50, ...hits.map(h => h.dist || 0)) : ANCHOR_RADIUS_M;
  field.anchors.push({
    xy: anchor.xy, covered, reach: ANCHOR_SPACING_M,
    density: saturated ? hits.length / (Math.PI * covered * covered) : null,
  });
  field.done++;
}

function fieldFromSnapshot(snap, spec) {
  const field = makeField();
  for (let i = 0; i < snap.p.length; i += 2) {
    const name = snap.n?.[i / 2] || '';
    // Re-applied on load, so a snapshot baked before a rule existed obeys it.
    if (spec?.rejectName?.test(name)) continue;
    field.index.add([snap.p[i], snap.p[i + 1], name]);
    field.points = field.points || [];
    field.points.push([snap.p[i], snap.p[i + 1], name]);
  }
  field.anchors = snap.a.map(([x, y, covered, dKm2, reach]) => ({ xy: [x, y], covered, reach, density: dKm2 ? dKm2 / 1e6 : null }));
  field.done = Infinity;
  return field;
}

/* Density context at a cell centre — shared by its seven sample points.
   Outside every fully-covered disc, nearby saturated anchors say the area
   is at least that dense; blend them by inverse distance within a lattice
   step and a half, beyond which the density doesn't transfer. */
function densityAt(field, xy) {
  let wsum = 0, dsum = 0;
  for (const a of field.anchors) {
    const m = Math.hypot(a.xy[0] - xy[0], a.xy[1] - xy[1]);
    if (m <= a.covered) return null;
    if (a.density && m < a.reach * 1.5) { const w = 1 / Math.max(m, 100); wsum += w; dsum += w * a.density; }
  }
  return wsum ? dsum / wsum : null;
}

/* k nearest WALKED distances for one signal at one point. */
function walked(field, xy, k, density) {
  const found = field.index.nearest(xy, k, REACH_M / DETOUR);
  const out = [];
  for (let i = 0; i < k; i++) {
    let m = found[i]?.[0] ?? Infinity;
    if (density) m = Math.min(m, Math.sqrt((i + 1) / (Math.PI * density)));
    out.push(m * DETOUR);
  }
  return out;
}

const truthy = v => v === true || v === 'true';

export default async function city(ctx, uc) {
  const region  = paramFor(uc, 'region') || 'saopaulo';
  const preset  = PRESETS[paramFor(uc, 'preset')] || PRESETS.walk;
  const ramp    = truthy(paramFor(uc, 'colorblind')) ? RAMPS.colorblind : RAMPS.classic;
  const opacity = Number(paramFor(uc, 'opacity')) || 0.7;
  const keys    = Object.keys(preset.weights);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const inkColor  = isDark ? '#F2F5F8' : '#12141A';
  const haloColor = isDark ? '#0E1116' : '#FFFFFF';

  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const colorOf = s => rampColor(ramp, s / 100);
  const badgeInk = s => ramp === RAMPS.colorblind && s > 55 ? '#12141A' : '#FFFFFF';
  const setPanel = html => ctx.setSidePanel(`<div class="city-card">${html}</div>`);
  const optionLabel = uc.params.find(p => p.key === 'region')?.options?.find(o => o.value === region)?.label;

  /* Everything that would compete with the grade goes: POI icons, house
     numbers, building footprints (they draw ABOVE the honeycomb and grey
     it out at street zoom), hillshade — and the basemap's own
     neighbourhood names, which would double up with the bairro labels. */
  ctx.hideLayers(lyr => {
    const id = lyr.id;
    return id.startsWith('POI') || id.startsWith('Buildings') || id === '3D - Building'
      || id === 'Hillshade' || id === 'House Number' || id.endsWith('Road arrow')
      || id === 'TransitLabels - Path' || id === 'LULC - Parking & Driving'
      || id === 'Places - Neighbourhood' || id === 'Places - Village / Hamlet';
  });
  const fontStack = (() => {
    const sym = ctx.ml.getStyle()?.layers?.find(l => l.type === 'symbol' && l.layout?.['text-font']);
    return sym?.layout?.['text-font'] || ['Noto-Regular'];
  })();
  const belowWater = ['Water - Line', 'Water - Shadow', 'Water - Fill'].find(id => ctx.ml.getLayer(id));
  /* Outlines and the selection ring go beneath the basemap's labels, the
     way City live traffic keeps its lines under street names and shields;
     only our own neighbourhood names sit on top. Taken once, before any of
     our layers exist. */
  const belowLabels = ctx.ml.getStyle()?.layers?.find(l => l.type === 'symbol' && !/arrow|Turning/i.test(l.id))?.id;

  /* ── Resolve the city: snapshot, bookmark, or geocode ───────────── */

  let snap = SNAPSHOTS.get(region);
  if (snap === undefined) {
    snap = /^[a-z]+$/.test(region)
      ? await fetch(`${import.meta.env.BASE_URL}data/walk/${region}.json`).then(r => r.ok ? r.json() : null).catch(() => null)
      : null;
    if (snap?.v !== 2) snap = null;
    SNAPSHOTS.set(region, snap);
  }
  if (ctx.cancelled) return;

  let center = snap?.center;
  let cityLabel = snap?.name || optionLabel || String(region);
  if (!center) {
    ctx.beginLoading(`Finding ${region}…`);
    const hit = (await geocode({ query: region, limit: 1, entityType: 'Municipality' }).catch(() => []))[0];
    if (ctx.cancelled) return;
    ctx.endLoading();
    if (!hit) {
      ctx.showError(`Couldn't find “${region}”`, { detail: 'Try a city name, or pick one from the list.', retry: false });
      return;
    }
    center = hit.position;
    cityLabel = hit.name || String(region);
  }
  const proj = projector(center);
  const hexSize = (snap?.hex || LIVE_HEX_M) * (HEX_SCALE[paramFor(uc, 'cellSize')] || 1);

  /* ── Cells and bairros ──────────────────────────────────────────── */

  let bairros = [], cells;
  if (snap) {
    bairros = snap.bairros.map(b => {
      const xyGeom = projectGeometry(b.geometry, proj);
      return { id: b.id, name: b.name, geometry: b.geometry, xyGeom, bb: bboxXY(xyGeom), cells: [] };
    });
    const bb = bairros.reduce((a, b) => [Math.min(a[0], b.bb[0]), Math.min(a[1], b.bb[1]), Math.max(a[2], b.bb[2]), Math.max(a[3], b.bb[3])],
      [Infinity, Infinity, -Infinity, -Infinity]);
    cells = buildHexes(proj, bb, hexSize, xy =>
      bairros.find(b => xy[0] >= b.bb[0] && xy[0] <= b.bb[2] && xy[1] >= b.bb[1] && xy[1] <= b.bb[3] && inGeometry(xy, b.xyGeom)) || false);
    for (const c of cells) c.bairro.cells.push(c);
  } else {
    const half = LIVE_SPAN_M / 2;
    cells = buildHexes(proj, [-half, -half, half, half], hexSize, xy => Math.hypot(...xy) <= half);
  }
  const byId = new Map(cells.map(c => [c.id, c]));

  /* ── Fields ─────────────────────────────────────────────────────── */

  let fields, missing = [];
  const anchors = [];
  if (snap) {
    snap._fields ||= Object.fromEntries(Object.entries(snap.fields).map(([k, f]) => [k, fieldFromSnapshot(f, CATEGORY_SPECS[k])]));
    fields = snap._fields;
  } else {
    const liveKey = center.map(v => v.toFixed(3)).join(',');
    if (!LIVE_FIELDS.has(liveKey)) LIVE_FIELDS.set(liveKey, {});
    fields = LIVE_FIELDS.get(liveKey);
    const n = Math.ceil(LIVE_SPAN_M / ANCHOR_SPACING_M), off = (n - 1) / 2;
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
      const xy = [(k - off) * ANCHOR_SPACING_M, (i - off) * ANCHOR_SPACING_M];
      if (Math.hypot(...xy) - ANCHOR_RADIUS_M <= LIVE_SPAN_M / 2) anchors.push({ xy, ll: proj.toLL(xy) });
    }
    anchors.sort((a, b) => Math.hypot(...a.xy) - Math.hypot(...b.xy));
    // Reusable only if complete; a sweep cancelled halfway starts over.
    for (const k of keys) if (fields[k] && (fields[k].done < anchors.length || fields[k].failed)) delete fields[k];
    missing = keys.filter(k => !fields[k]);
    for (const k of missing) fields[k] = makeField();
  }

  /* ── Grading ────────────────────────────────────────────────────── */

  const wsum = keys.reduce((a, k) => a + preset.weights[k], 0);
  function grade() {
    for (const c of cells) {
      const pts = samplePoints(c.xy, hexSize);
      c.signal = {};
      let total = 0;
      for (const key of keys) {
        const f = fields[key], sig = SIGNALS[key];
        const dens = densityAt(f, c.xy);
        let s = 0;
        for (const p of pts) {
          const d = walked(f, p, sig.k, dens);
          s += d.reduce((a, m) => a + sig.decay(m), 0) / d.length;
        }
        s /= pts.length;
        c.signal[key] = { score: s * 100, nearestM: walked(f, c.xy, 1, dens)[0] };
        total += preset.weights[key] * s;
      }
      c.raw = (total / wsum) * 100;
    }
    /* Light smoothing — 70% the cell, 30% its ring — so a cell whose
       samples happen to sit on a bus terminal doesn't flash green in a
       red block. */
    for (const c of cells) {
      let n = 0, s = 0;
      for (const [dq, dr] of NEIGHBOURS) {
        const nb = byId.get(`${c.q + dq},${c.r + dr}`);
        if (nb) { s += nb.raw; n++; }
      }
      c.score = n ? 0.7 * c.raw + 0.3 * (s / n) : c.raw;
    }
    /* A neighbourhood is graded on its LIVED-IN cells. A cell with next
       to nothing in reach is a reservoir, a forest or a runway — left
       unshaded on the map, and left out of the average, or Grajaú would
       be graded on the Billings reservoir. */
    for (const b of bairros) {
      const lived = b.cells.filter(c => c.score >= SHADE_MIN);
      b.lived = lived;
      if (b.cells.length) {
        b.label = b.cells.reduce((a, c) => [a[0] + c.xy[0] / b.cells.length, a[1] + c.xy[1] / b.cells.length], [0, 0]);
      }
      if (lived.length) {
        b.score = lived.reduce((a, c) => a + c.score, 0) / lived.length;
      } else if (b.cells.length) {
        b.score = b.cells.reduce((a, c) => a + c.score, 0) / b.cells.length;
      } else {
        // Smaller than a cell: grade the one point at its middle.
        b.label = [(b.bb[0] + b.bb[2]) / 2, (b.bb[1] + b.bb[3]) / 2];
        let total = 0;
        for (const key of keys) {
          const f = fields[key], sig = SIGNALS[key];
          const d = walked(f, b.label, sig.k, densityAt(f, b.label));
          total += preset.weights[key] * d.reduce((a, m) => a + sig.decay(m), 0) / d.length;
        }
        b.score = (total / wsum) * 100;
      }
    }
    bairros.sort((a, b) => b.score - a.score).forEach((b, i) => { b.rank = i + 1; });
  }

  /* ── Map ────────────────────────────────────────────────────────── */

  let selected = null;   // a bairro, or (live) a cell
  let layersAdded = false;

  function draw() {
    const hexData = { type: 'FeatureCollection', features: cells.filter(c => c.score >= SHADE_MIN).map(c => ({
      type: 'Feature', geometry: { type: 'Polygon', coordinates: [c.ring] },
      properties: { id: c.id, color: colorOf(c.score) },
    })) };
    const bairroData = { type: 'FeatureCollection', features: bairros.map(b => ({
      type: 'Feature', geometry: b.geometry, properties: { id: b.id },
    })) };
    const labelData = { type: 'FeatureCollection', features: bairros.map(b => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: proj.toLL(b.label) },
      properties: { id: b.id, name: b.name, rank: b.rank },
    })) };
    const selGeom = !selected ? null : selected.geometry || { type: 'Polygon', coordinates: [selected.ring] };
    const selData = { type: 'FeatureCollection', features: selGeom ? [{ type: 'Feature', geometry: selGeom, properties: {} }] : [] };

    if (!layersAdded) {
      ctx.addSource('hexes', { type: 'geojson', data: hexData });
      ctx.addSource('bairros', { type: 'geojson', data: bairroData });
      ctx.addSource('bairro-labels', { type: 'geojson', data: labelData });
      ctx.addSource('selection', { type: 'geojson', data: selData });
      ctx.addLayer({
        id: 'hex-fill', type: 'fill', source: 'hexes',
        paint: {
          'fill-color': ['get', 'color'], 'fill-opacity': opacity,
          // Antialiasing draws a hairline between adjacent cells, which is
          // what makes a honeycomb read as a mesh instead of a surface.
          'fill-antialias': false,
        },
      }, belowWater);
      // Invisible hit target, so a click anywhere in a bairro — including
      // an unshaded cell — selects it.
      ctx.addLayer({ id: 'bairro-hit', type: 'fill', source: 'bairros', paint: { 'fill-color': '#000', 'fill-opacity': 0 } }, belowLabels);
      ctx.addLayer({
        id: 'bairro-line', type: 'line', source: 'bairros',
        paint: { 'line-color': inkColor, 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 13, 1.6] },
      }, belowLabels);
      ctx.addLayer({
        id: 'selection-line', type: 'line', source: 'selection',
        paint: { 'line-color': inkColor, 'line-width': 3 },
      }, belowLabels);
      ctx.addLayer({
        id: 'bairro-label', type: 'symbol', source: 'bairro-labels',
        layout: {
          'text-field': ['get', 'name'], 'text-font': fontStack,
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 13],
          'text-max-width': 7, 'text-padding': 4,
          // Best-ranked names win collisions at city zoom.
          'symbol-sort-key': ['get', 'rank'],
        },
        paint: { 'text-color': inkColor, 'text-halo-color': haloColor, 'text-halo-width': 1.6 },
      });
      layersAdded = true;
    } else {
      ctx.ml.getSource('hexes').setData(hexData);
      ctx.ml.getSource('bairro-labels').setData(labelData);
      ctx.ml.getSource('selection').setData(selData);
    }
  }

  function frame(duration = 0) {
    if (!cells.length) return;
    const lons = cells.map(c => c.center[0]), lats = cells.map(c => c.center[1]);
    ctx.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { duration });
  }

  function legend() {
    const stops = ramp.map((c, i) => `${c} ${Math.round(i / (ramp.length - 1) * 100)}%`).join(', ');
    ctx.setLegend({
      title: preset.label,
      items: [{
        html: `<span class="city-ramp" style="background:linear-gradient(90deg, ${stops})"><span>F</span><span>C</span><span>A+</span></span>`,
        label: `${preset.lo} → ${preset.hi}`,
      }],
    });
  }

  /* ── Panel ──────────────────────────────────────────────────────── */

  const chip = s => `<span class="city-chip" style="background:${colorOf(s)};color:${badgeInk(s)}">${gradeOf(s)}</span>`;
  const source = () => snap
    ? `TomTom Search &amp; Admin Boundaries data, snapshot of ${escapeHtml(snap.builtAt)}.`
    : 'Sampled live from TomTom Search.';

  /* Share of lived-in cells per grade family, with the car-dependent end
     as the headline: "how much of this city needs a car" is the question. */
  function distribution() {
    const fam = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    const lived = cells.filter(c => c.score >= SHADE_MIN);
    for (const c of lived) fam[gradeOf(c.score)[0]]++;
    const total = lived.length || 1;
    const mid = { A: 88, B: 64, C: 43, D: 22, F: 7 };
    const segs = Object.entries(fam).filter(([, n]) => n).map(([g, n]) =>
      `<span class="city-dist-seg" style="flex:${n};background:${colorOf(mid[g])}"></span>`).join('');
    const keysHtml = Object.entries(fam).map(([g, n]) =>
      `<span class="city-dist-key"><b>${g}</b> ${Math.round(n / total * 100)}%</span>`).join('');
    return {
      html: `<div class="city-dist">${segs}</div><div class="city-dist-keys">${keysHtml}</div>`,
      bad: Math.round((fam.D + fam.F) / total * 100),
      good: Math.round((fam.A + fam.B) / total * 100),
    };
  }

  /* While a live sweep runs, every cell that hasn't been reached yet
     scores zero, so the share would open at "100% car-dependent" and fall
     as data lands — a number that's wrong for most of the load. Hold the
     headline and distribution back until the sweep is complete. */
  function renderOverview(progress) {
    const loading = progress != null && progress < 1;
    const { html, bad, good } = distribution();
    const list = bairros.length ? `
      <div class="city-sect">
        <div class="city-sect-head">${bairros.length} neighbourhoods, ranked</div>
        <div class="city-rank">${bairros.map(b => `
          <button class="city-rank-row" data-bairro="${escapeHtml(b.id)}">
            <span class="city-rank-n">${b.rank}</span>
            <span class="city-rank-name">${escapeHtml(b.name)}</span>
            ${chip(b.score)}
          </button>`).join('')}</div>
      </div>` : `<div class="city-note">Neighbourhood rankings are baked for the listed cities; a searched city is graded cell by cell.</div>`;
    setPanel(`
      <div class="city-card-head">
        <div class="city-card-eyebrow">${escapeHtml(preset.label)}</div>
        <div class="city-card-title">${escapeHtml(cityLabel)}</div>
      </div>
      ${loading ? '' : `<div class="city-headline">
        <span class="city-headline-n" style="color:${colorOf(10)}">${bad}%</span>
        <span class="city-headline-text">of the city is ${escapeHtml(preset.lo.toLowerCase())}
          <span class="city-headline-sub">graded D or F · ${good}% grades B or better</span></span>
      </div>
      <div class="city-sect">${html}</div>`}
      ${list}
      <div class="city-note">${escapeHtml(preset.note)}</div>
      <div class="city-note">${source()}</div>`);
    bind();
  }

  /* One bairro: its grade, rank, and per signal how much of its area is
     within the walking budget — all from the snapshot, no call. */
  function renderBairro(b) {
    const rows = keys.map(key => {
      const sig = SIGNALS[key], budgetM = sig.withinMin * WALK_M_PER_MIN;
      const cs = b.lived.length ? b.lived : b.cells.length ? b.cells : null;
      const share = cs ? Math.round(cs.filter(c => c.signal[key].nearestM <= budgetM).length / cs.length * 100) : null;
      const score = cs
        ? cs.reduce((a, c) => a + c.signal[key].score, 0) / cs.length
        : (() => {   // smaller than a cell: this signal alone, at its middle
          const d = walked(fields[key], b.label, sig.k, densityAt(fields[key], b.label));
          return d.reduce((a, m) => a + sig.decay(m), 0) / d.length * 100;
        })();
      let meta = share == null ? '' : `${share}% of the area within ${sig.withinMin} min on foot`;
      if (sig.names) {
        /* Name the stations IN the bairro; if there are none, the nearest
           one to any part of it. A bairro's middle is a poor reference —
           Moema's is a kilometre from Moema station. */
        const inside = [...new Set((fields[key].points || [])
          .filter(p => p[2] && p[0] >= b.bb[0] && p[0] <= b.bb[2] && p[1] >= b.bb[1] && p[1] <= b.bb[3] && inGeometry(p, b.xyGeom))
          .map(p => p[2]))];
        if (inside.length) {
          meta += `${meta ? ' · ' : ''}${inside.length === 1 ? 'station' : `${inside.length} stations`}: ${inside.slice(0, 4).join(', ')}${inside.length > 4 ? '…' : ''}`;
        } else {
          let best = null;
          for (const c of (cs || [{ xy: b.label }])) {
            const n = fields[key].index.nearest(c.xy, 1, 10_000)[0];
            if (n && (!best || n[0] < best[0])) best = n;
          }
          if (best?.[1]?.[2]) meta += `${meta ? ' · ' : ''}no station inside; nearest ${best[1][2]}, ≈${Math.max(1, Math.round(best[0] * DETOUR / WALK_M_PER_MIN))} min away`;
        }
      }
      return `<div class="city-row2">
          <span class="city-row2-label">${escapeHtml(sig.label)}</span>
          ${chip(score)}
          <span class="city-row2-meta">${escapeHtml(meta)}</span>
        </div>`;
    }).join('');
    setPanel(`
      <div class="city-card-head">
        <button class="city-back" data-back="1">← ${escapeHtml(cityLabel)}</button>
        <div class="city-grade">
          <span class="city-grade-badge" style="background:${colorOf(b.score)};color:${badgeInk(b.score)}">${gradeOf(b.score)}</span>
          <span class="city-grade-text">
            <span class="city-card-title">${escapeHtml(b.name)}</span>
            <span class="city-card-sub">#${b.rank} of ${bairros.length} · ${escapeHtml(preset.label)} ${Math.round(b.score)} / 100</span>
          </span>
        </div>
      </div>
      <div class="city-sect"><div class="city-rows">${rows}</div></div>
      <div class="city-note">${source()}</div>`);
    bind();
  }

  /* Live city, no bairros: the same breakdown for one cell. */
  function renderCell(c) {
    const rows = keys.map(key => {
      const sig = SIGNALS[key], m = c.signal[key].nearestM;
      const meta = Number.isFinite(m) ? `nearest ≈${Math.max(1, Math.round(m / WALK_M_PER_MIN))} min on foot` : 'none within reach';
      return `<div class="city-row2"><span class="city-row2-label">${escapeHtml(sig.label)}</span>${chip(c.signal[key].score)}
        <span class="city-row2-meta">${escapeHtml(meta)}</span></div>`;
    }).join('');
    setPanel(`
      <div class="city-card-head">
        <button class="city-back" data-back="1">← ${escapeHtml(cityLabel)}</button>
        <div class="city-grade">
          <span class="city-grade-badge" style="background:${colorOf(c.score)};color:${badgeInk(c.score)}">${gradeOf(c.score)}</span>
          <span class="city-grade-text">
            <span class="city-card-title">This cell</span>
            <span class="city-card-sub">${escapeHtml(preset.label)} ${Math.round(c.score)} / 100</span>
          </span>
        </div>
      </div>
      <div class="city-sect"><div class="city-rows">${rows}</div></div>
      <div class="city-note">${source()}</div>`);
    bind();
  }

  function bind() {
    const host = document.getElementById('map-side');
    if (!host) return;
    for (const el of host.querySelectorAll('[data-bairro]')) {
      el.addEventListener('click', () => selectBairro(bairros.find(b => b.id === el.getAttribute('data-bairro')), true));
    }
    host.querySelector('[data-back]')?.addEventListener('click', () => {
      selected = null; draw(); renderOverview(); frame(600);
    });
  }

  function selectBairro(b, fly) {
    if (!b) return;
    selected = b; draw(); renderBairro(b);
    if (fly) {
      const [x0, y0, x1, y1] = b.bb;
      ctx.fitBounds([proj.toLL([x0, y0]), proj.toLL([x1, y1])], { duration: 600, maxZoom: 13.5 });
    }
  }

  ctx.on('click', snap ? 'bairro-hit' : 'hex-fill', e => {
    const id = e.features?.[0]?.properties?.id;
    if (snap) selectBairro(bairros.find(b => b.id === id), false);
    else { const c = byId.get(id); if (c) { selected = c; draw(); renderCell(c); } }
  });
  for (const lyr of ['bairro-hit', 'hex-fill']) {
    ctx.on('mouseenter', lyr, () => { ctx.ml.getCanvas().style.cursor = 'pointer'; });
    ctx.on('mouseleave', lyr, () => { ctx.ml.getCanvas().style.cursor = ''; });
  }

  /* ── Go ─────────────────────────────────────────────────────────── */

  legend();

  const jobs = anchors.flatMap(a => missing.map(key => ({ a, key })));
  if (jobs.length) {
    grade(); draw(); renderOverview(0); frame();
    ctx.beginLoading('Sampling places live…', { progress: 0 });
    let finished = 0, lastPaint = 0, next = 0;
    await Promise.all(Array.from({ length: RATE_PER_S }, async () => {
      while (next < jobs.length && !ctx.cancelled) {
        const { a, key } = jobs[next++];
        let hits = null;
        for (let attempt = 0; attempt < 3 && hits == null && !ctx.cancelled; attempt++) {
          await throttle();
          hits = await searchSignal(key, a.ll, ANCHOR_RADIUS_M, PAGE).catch(() => null);
        }
        if (ctx.cancelled) return;
        // A failed anchor is NOT an empty one: ingesting [] would claim
        // its whole disc has none of this signal and paint it red.
        if (hits) ingest(fields[key], proj, a, hits);
        else { fields[key].failed++; fields[key].done++; }
        finished++;
        const now = performance.now();
        if (now - lastPaint > 700) {
          lastPaint = now;
          grade(); draw();
          ctx.beginLoading('Sampling places live…', { progress: finished / jobs.length });
          if (!selected) renderOverview(finished / jobs.length);
        }
      }
    }));
    if (ctx.cancelled) return;
  }

  grade(); draw();
  renderOverview();
  // Frame AFTER the panel is up, so safeInsets() reserves its width and the
  // city isn't tucked behind the card.
  if (!jobs.length) frame();
}
