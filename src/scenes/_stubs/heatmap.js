/* Temperature heatmap — historical open data on a TomTom basemap.

   The "heat" is real daily-high air temperature, sampled on a GLOBAL grid
   from Open-Meteo — a free, open-source weather API (no key, CORS-enabled).
   We bilinearly interpolate those readings into one fluid, continuous
   field and clip it to the selected continent's countries (Natural Earth
   polygons, open data) — so "Europe" paints only Europe, stopping cleanly
   at every coast and border — then drop it in as a single raster image.
   The region picker reframes the camera and reclips.

   It's the showcase for the pattern the case is selling: an open dataset
   folded onto the TomTom Orbis basemap, plus a derived layer of our own —
   the critical-heat glow (≥ 30 °C, baked into the field) and the city
   value pills.

   Pick a moment — yesterday, a year ago, or a notable heatwave. Recent
   dates come from the forecast endpoint (serves ~92 past days); older
   ones from the archive endpoint. Datasets are fetched once and cached
   (module scope + localStorage); flipping palette, units or region
   afterwards is pure client-side work. A bundled snapshot is the last-
   resort fallback so the map is never empty if the weather API is down.
   Map display is the platform's Basemap picker + theme toggle. */

import { paramFor } from '../../state.js';
import { infoCard } from '../../render/popup.js';
import { cssVar } from '../_shared.js';
import { FALLBACK_GRID } from './heatmap-fallback.js';

/* Critical-heat threshold, in °C. Fixed: at or above this the field
   glows and a city's pill flips to the warn style. 30 °C is the line
   where heat starts to bite for most of the inhabited world. */
const CRITICAL_C = 30;

/* The field is sampled + drawn over the whole inhabited world. Latitudes
   are clamped to ±(75 / 56) — past that it's mostly uninhabited ice, and
   Mercator-Y blows the canvas height up for no visual gain. */
const FIELD_BBOX = [-180, -60, 180, 80];   // [w, s, e, n] — north far enough to cover Greenland

/* ---- Regions: pure CAMERA targets now (the data is global). Each has a
   `bbox` to frame and a `cities` list that gets a value pill + popup.
   Cities are ordered by prominence: the first tier shows when zoomed out,
   the rest open up as you zoom in (see the minZoom tiers in the scene). */
const REGIONS = {
  world: {
    label: 'World',
    bbox: [-165, -50, 178, 68],
    cities: [
      { name: 'New York',     lon:  -74.006, lat:  40.713 },
      { name: 'London',       lon:   -0.128, lat:  51.507 },
      { name: 'Tokyo',        lon:  139.692, lat:  35.690 },
      { name: 'São Paulo',    lon:  -46.633, lat: -23.550 },
      { name: 'Cairo',        lon:   31.235, lat:  30.044 },
      { name: 'Mumbai',       lon:   72.878, lat:  19.076 },
      { name: 'Sydney',       lon:  151.209, lat: -33.868 },
      { name: 'Los Angeles',  lon: -118.244, lat:  34.052 },
      { name: 'Lagos',        lon:    3.379, lat:   6.524 },
      { name: 'Moscow',       lon:   37.618, lat:  55.756 },
      { name: 'Beijing',      lon:  116.407, lat:  39.904 },
      { name: 'Mexico City',  lon:  -99.133, lat:  19.433 },
      { name: 'Jakarta',      lon:  106.845, lat:  -6.208 },
      { name: 'Dubai',        lon:   55.270, lat:  25.205 },
      { name: 'Johannesburg', lon:   28.034, lat: -26.195 },
      { name: 'Buenos Aires', lon:  -58.381, lat: -34.603 },
    ],
  },
  europe: {
    label: 'Europe',
    bbox: [-11, 35, 32, 66],
    cities: [
      { name: 'London',    lon: -0.128,  lat: 51.507 },
      { name: 'Paris',     lon:  2.352,  lat: 48.857 },
      { name: 'Madrid',    lon: -3.703,  lat: 40.417 },
      { name: 'Berlin',    lon: 13.405,  lat: 52.520 },
      { name: 'Rome',      lon: 12.496,  lat: 41.903 },
      { name: 'Stockholm', lon: 18.069,  lat: 59.329 },
      { name: 'Warsaw',    lon: 21.012,  lat: 52.230 },
      { name: 'Athens',    lon: 23.728,  lat: 37.984 },
      { name: 'Lisbon',    lon: -9.139,  lat: 38.722 },
      { name: 'Amsterdam', lon:  4.904,  lat: 52.368 },
      { name: 'Vienna',    lon: 16.373,  lat: 48.208 },
      { name: 'Kyiv',      lon: 30.523,  lat: 50.450 },
      { name: 'Oslo',      lon: 10.752,  lat: 59.913 },
      { name: 'Helsinki',  lon: 24.941,  lat: 60.170 },
      { name: 'Dublin',    lon: -6.260,  lat: 53.350 },
      { name: 'Barcelona', lon:  2.154,  lat: 41.390 },
      { name: 'Munich',    lon: 11.582,  lat: 48.135 },
      { name: 'Prague',    lon: 14.418,  lat: 50.073 },
    ],
  },
  'north-america': {
    label: 'North America',
    bbox: [-128, 14, -62, 60],
    cities: [
      { name: 'New York',    lon:  -74.006, lat: 40.713 },
      { name: 'Los Angeles', lon: -118.244, lat: 34.052 },
      { name: 'Mexico City', lon:  -99.133, lat: 19.433 },
      { name: 'Chicago',     lon:  -87.630, lat: 41.878 },
      { name: 'Toronto',     lon:  -79.383, lat: 43.653 },
      { name: 'Houston',     lon:  -95.369, lat: 29.760 },
      { name: 'Miami',       lon:  -80.192, lat: 25.762 },
      { name: 'Vancouver',   lon: -123.116, lat: 49.283 },
      { name: 'Denver',      lon: -104.991, lat: 39.739 },
      { name: 'Phoenix',     lon: -112.074, lat: 33.448 },
      { name: 'Montreal',    lon:  -73.567, lat: 45.501 },
      { name: 'Seattle',     lon: -122.332, lat: 47.606 },
      { name: 'Atlanta',     lon:  -84.388, lat: 33.749 },
      { name: 'Dallas',      lon:  -96.797, lat: 32.777 },
      { name: 'Monterrey',   lon: -100.317, lat: 25.686 },
      { name: 'Havana',      lon:  -82.383, lat: 23.133 },
    ],
  },
  'south-america': {
    label: 'South America',
    bbox: [-82, -55, -34, 13],
    cities: [
      { name: 'São Paulo',      lon: -46.633, lat: -23.550 },
      { name: 'Buenos Aires',   lon: -58.381, lat: -34.603 },
      { name: 'Lima',           lon: -77.043, lat: -12.046 },
      { name: 'Bogotá',         lon: -74.072, lat:   4.711 },
      { name: 'Rio de Janeiro', lon: -43.196, lat: -22.907 },
      { name: 'Santiago',       lon: -70.669, lat: -33.448 },
      { name: 'Caracas',        lon: -66.904, lat:  10.481 },
      { name: 'Brasília',       lon: -47.883, lat: -15.794 },
      { name: 'Manaus',         lon: -60.025, lat:  -3.117 },
      { name: 'La Paz',         lon: -68.119, lat: -16.500 },
      { name: 'Montevideo',     lon: -56.165, lat: -34.901 },
      { name: 'Quito',          lon: -78.467, lat:  -0.180 },
      { name: 'Asunción',       lon: -57.575, lat: -25.264 },
      { name: 'Recife',         lon: -34.877, lat:  -8.047 },
      { name: 'Córdoba',        lon: -64.183, lat: -31.420 },
      { name: 'Medellín',       lon: -75.563, lat:   6.244 },
    ],
  },
  africa: {
    label: 'Africa',
    bbox: [-18, -35, 52, 38],
    cities: [
      { name: 'Cairo',         lon:  31.235, lat:  30.044 },
      { name: 'Lagos',         lon:   3.379, lat:   6.524 },
      { name: 'Johannesburg',  lon:  28.034, lat: -26.195 },
      { name: 'Nairobi',       lon:  36.817, lat:  -1.286 },
      { name: 'Casablanca',    lon:  -7.589, lat:  33.573 },
      { name: 'Kinshasa',      lon:  15.266, lat:  -4.325 },
      { name: 'Addis Ababa',   lon:  38.757, lat:   9.030 },
      { name: 'Cape Town',     lon:  18.424, lat: -33.925 },
      { name: 'Dakar',         lon: -17.467, lat:  14.717 },
      { name: 'Khartoum',      lon:  32.560, lat:  15.500 },
      { name: 'Algiers',       lon:   3.059, lat:  36.754 },
      { name: 'Accra',         lon:  -0.187, lat:   5.604 },
      { name: 'Luanda',        lon:  13.234, lat:  -8.839 },
      { name: 'Dar es Salaam', lon:  39.208, lat:  -6.793 },
      { name: 'Tunis',         lon:  10.181, lat:  36.806 },
      { name: 'Abidjan',       lon:  -4.008, lat:   5.345 },
    ],
  },
  asia: {
    label: 'Asia',
    bbox: [40, -10, 150, 60],
    cities: [
      { name: 'Tokyo',            lon: 139.692, lat: 35.690 },
      { name: 'Shanghai',         lon: 121.474, lat: 31.230 },
      { name: 'Mumbai',           lon:  72.878, lat: 19.076 },
      { name: 'Beijing',          lon: 116.407, lat: 39.904 },
      { name: 'New Delhi',        lon:  77.209, lat: 28.614 },
      { name: 'Bangkok',          lon: 100.501, lat: 13.756 },
      { name: 'Singapore',        lon: 103.820, lat:  1.352 },
      { name: 'Istanbul',         lon:  28.979, lat: 41.008 },
      { name: 'Jakarta',          lon: 106.845, lat: -6.208 },
      { name: 'Seoul',            lon: 126.978, lat: 37.567 },
      { name: 'Dubai',            lon:  55.270, lat: 25.205 },
      { name: 'Karachi',          lon:  67.010, lat: 24.860 },
      { name: 'Manila',           lon: 120.984, lat: 14.599 },
      { name: 'Hong Kong',        lon: 114.169, lat: 22.319 },
      { name: 'Tehran',           lon:  51.389, lat: 35.689 },
      { name: 'Riyadh',           lon:  46.675, lat: 24.713 },
      { name: 'Ho Chi Minh City', lon: 106.660, lat: 10.823 },
      { name: 'Dhaka',            lon:  90.412, lat: 23.811 },
    ],
  },
  oceania: {
    label: 'Oceania',
    bbox: [110, -48, 179, -5],
    cities: [
      { name: 'Sydney',       lon: 151.209, lat: -33.868 },
      { name: 'Melbourne',    lon: 144.963, lat: -37.814 },
      { name: 'Brisbane',     lon: 153.025, lat: -27.470 },
      { name: 'Perth',        lon: 115.857, lat: -31.953 },
      { name: 'Auckland',     lon: 174.764, lat: -36.848 },
      { name: 'Adelaide',     lon: 138.600, lat: -34.929 },
      { name: 'Darwin',       lon: 130.845, lat: -12.463 },
      { name: 'Wellington',   lon: 174.776, lat: -41.286 },
      { name: 'Port Moresby', lon: 147.180, lat:  -9.443 },
      { name: 'Christchurch', lon: 172.636, lat: -43.532 },
      { name: 'Gold Coast',   lon: 153.430, lat: -28.017 },
      { name: 'Canberra',     lon: 149.128, lat: -35.282 },
      { name: 'Hobart',       lon: 147.327, lat: -42.882 },
      { name: 'Suva',         lon: 178.442, lat: -18.124 },
    ],
  },
};

/* All periods are historical daily highs. `recent` dates (yesterday) come
   from the forecast endpoint, which still serves the last ~92 days;
   older dates come from the archive endpoint. `yesterday` / `last-year`
   are resolved relative to today at run time. */
const PERIODS = {
  yesterday:    { label: 'Yesterday',                      relative: 'yesterday' },
  'last-year':  { label: 'A year ago',                     relative: 'last-year' },
  '2023-07-18': { label: 'Jul 2023 · Cerberus heatwave',   date: '2023-07-18' },
  '2021-06-29': { label: 'Jun 2021 · Pacific NW dome',     date: '2021-06-29' },
};

function resolvePeriod(key) {
  const p = PERIODS[key] || PERIODS.yesterday;
  if (p.relative === 'yesterday') {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
    const date = d.toISOString().slice(0, 10);
    return { key: 'yesterday', mode: 'recent', date, label: `Yesterday · ${date}` };
  }
  if (p.relative === 'last-year') {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    const date = d.toISOString().slice(0, 10);
    return { key: 'last-year', mode: 'archive', date, label: `A year ago · ${date}` };
  }
  return { key, mode: 'archive', date: p.date, label: p.label };
}

/* Cache bucket: every period is a fixed date now, so it keys on the date
   (yesterday rolls over to a new bucket each day). */
function bucketFor(rp) {
  return rp.date;
}

/* ---- Palettes (the "colour tones" control). Each is a cold→hot ramp of
   [°C, hex] stops over roughly -30…45 °C, so a colour always means the
   same temperature regardless of palette — which is what makes the fixed
   30 °C critical line meaningful. */
const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const PALETTES = {
  classic: {
    label: 'Classic · blue → red',
    ramp: [[-30,'#3a2c86'],[-12,'#3b6fd4'],[0,'#4ea3e8'],[10,'#74cfc4'],[18,'#f4d35e'],[26,'#ef9d3c'],[34,'#e8602f'],[44,'#9e1530']],
  },
  spectral: {
    label: 'Spectral · meteo',
    ramp: [[-30,'#5e4fa2'],[-12,'#3288bd'],[0,'#66c2a5'],[10,'#abdda4'],[18,'#e6f598'],[24,'#fee08b'],[30,'#fdae61'],[36,'#f46d43'],[44,'#9e0142']],
  },
  inferno: {
    label: 'Inferno · warm',
    ramp: [[-30,'#1b0c41'],[-10,'#4a0c6b'],[5,'#781c6d'],[16,'#a52c60'],[24,'#cf4446'],[30,'#ed6925'],[37,'#fb9a06'],[44,'#fcf6b1']],
  },
  viridis: {
    label: 'Viridis · perceptual',
    ramp: [[-30,'#440154'],[-12,'#414487'],[0,'#2a788e'],[12,'#22a884'],[26,'#7ad151'],[40,'#fde725'],[44,'#fde725']],
  },
};
// Precompute [°C, [r,g,b]] for fast per-pixel sampling.
for (const p of Object.values(PALETTES)) p.rgb = p.ramp.map(([t, h]) => [t, hexToRgb(h)]);

const CRITICAL_RGB = hexToRgb('#ef4444');   // glow blended in at/above CRITICAL_C

function sampleRamp(rgb, c) {
  if (c <= rgb[0][0]) return rgb[0][1];
  const last = rgb[rgb.length - 1];
  if (c >= last[0]) return last[1];
  for (let i = 1; i < rgb.length; i++) {
    const [t1, c1] = rgb[i];
    if (c <= t1) {
      const [t0, c0] = rgb[i - 1];
      const f = (c - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return last[1];
}
const toHex = ([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
const rampHex = (palette, c) => toHex(sampleRamp(palette.rgb, c));

/* A legend swatch that walks the SAME ramp the field uses (multi-stop),
   sampled across the observed range — so the bar matches the map exactly,
   not a flat two-colour approximation. */
function gradientSwatch(palette, min, max, steps = 8) {
  const stops = [];
  for (let i = 0; i <= steps; i++) {
    const t = min + ((max - min) * i) / steps;
    stops.push(`${rampHex(palette, t)} ${Math.round((i / steps) * 100)}%`);
  }
  return `<span class="map-legend-swatch bar" style="background:linear-gradient(90deg, ${stops.join(', ')});color:transparent;"></span>`;
}

const cToF = (c) => (c * 9) / 5 + 32;
const fmtTemp = (c, unit) => unit === 'f' ? `${Math.round(cToF(c))}°F` : `${Math.round(c)}°C`;

/* ---- Country mask. Natural Earth's 110m country polygons (open data,
   each tagged with a CONTINENT) are fetched once and used to clip the
   field canvas: the field shows ONLY on the selected continent's
   countries, so "Europe" paints Europe and stops at every coast/border.
   (We can't lean on the basemap's water to mask us — MapLibre renders
   raster layers without the depth test, so an opaque fill above the
   image doesn't occlude it; baking the clip into the image is the way.) */
const COUNTRIES_URL = 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/110m/cultural/ne_110m_admin_0_countries.json';
let countriesPromise = null;
function loadCountries() {
  if (!countriesPromise) {
    countriesPromise = fetch(COUNTRIES_URL)
      .then(r => { if (!r.ok) throw new Error(`countries ${r.status}`); return r.json(); })
      .then(gj => gj.features || [])
      .catch(() => null);   // null → masking skipped, field still renders
  }
  return countriesPromise;
}
/* Region key → Natural Earth CONTINENT value. `world` masks to all land. */
const CONTINENT_OF = {
  world: null,
  europe: 'Europe',
  'north-america': 'North America',
  'south-america': 'South America',
  africa: 'Africa',
  asia: 'Asia',
  oceania: 'Oceania',
};

/* ---- Open-Meteo. One round for up to ~100 coordinates; temps align to
   the input order (NaN where a point came back empty). The free tier
   rate-limits bursts (429), so we back off and retry rather than drop
   the chunk. */
async function fetchChunk(coords, rp, attempt = 0) {
  const lat = coords.map(c => c.lat).join(',');
  const lon = coords.map(c => c.lon).join(',');
  // Both endpoints return that day's high; `recent` (last ~92 days) uses
  // the forecast host, older dates use the archive host.
  const host = rp.mode === 'archive'
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast';
  const url = `${host}?latitude=${lat}&longitude=${lon}`
    + `&start_date=${rp.date}&end_date=${rp.date}&daily=temperature_2m_max&timezone=GMT`;
  const res = await fetch(url);
  if (res.status === 429 && attempt < 4) {
    await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    return fetchChunk(coords, rp, attempt + 1);
  }
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
  const rows = Array.isArray(data) ? data : [data];
  return coords.map((_, i) => {
    const v = rows[i]?.daily?.temperature_2m_max?.[0];
    return typeof v === 'number' ? v : NaN;
  });
}
/* Open-Meteo accepts the whole grid in one request (≈765 coords, tested),
   so a load is just 1 call for the field + 1 for the cities instead of a
   burst of eight — which is what kept tripping the free-tier rate limit.
   Still chunked + paced + retried as a safety net for very large grids. */
async function fetchTemps(points, rp) {
  const CHUNK = 1000;
  const out = [];
  for (let i = 0; i < points.length; i += CHUNK) {
    if (i > 0) await new Promise(r => setTimeout(r, 150));  // pace under the burst limit
    const c = points.slice(i, i + CHUNK);
    try { out.push(...await fetchChunk(c, rp)); }
    catch { out.push(...c.map(() => NaN)); }
  }
  return out;
}

/* Fetch grid temps. For a `recent` date (yesterday) the forecast endpoint
   can be rate-limited; if it comes back sparse, fall back to the nearest
   ARCHIVED day (~5 days earlier, the archive's lag) on the archive host —
   a separate API budget — so we still show real, near-current data
   instead of the bundled last-year snapshot. */
async function fetchGridTemps(points, rp) {
  const countFinite = (arr) => arr.reduce((n, v) => n + (Number.isFinite(v) ? 1 : 0), 0);
  let temps = await fetchTemps(points, rp);
  if (rp.mode === 'recent' && countFinite(temps) < points.length * 0.5) {
    const d = new Date(`${rp.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 5);
    const fb = { key: rp.key, mode: 'archive', date: d.toISOString().slice(0, 10) };
    const t2 = await fetchTemps(points, fb);
    if (countFinite(t2) > countFinite(temps)) temps = t2;
  }
  return temps;
}

/* Global sample grid — a regular lon/lat lattice. We keep its structure
   (cols × rows) so the field can be BILINEARLY interpolated: that yields a
   naturally smooth surface with no IDW bullseyes and no blur filter. The
   smoothing you see on the map is MapLibre's own linear raster resampling
   acting on a clean interpolated source. ~8° spacing ≈ 45×17 cells. */
const GRID_STEP = 8;
function gridMeta() {
  const [w, s, e, n] = FIELD_BBOX;
  const cols = Math.floor((e - w) / GRID_STEP) + 1;
  const rows = Math.floor((n - s) / GRID_STEP) + 1;
  return { w, s, step: GRID_STEP, cols, rows };
}
function buildGlobalGrid() {
  const { w, s, step, cols, rows } = gridMeta();
  const list = [];
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      list.push({ col: c, row: r, lon: w + c * step, lat: s + r * step });
  return list;
}
/* Fill the occasional missing cell (a chunk that 429'd) by averaging
   finite neighbours, so bilinear sampling never lands on a hole. */
function fillHoles(g, cols, rows) {
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      if (Number.isFinite(g[c][r])) continue;
      let sum = 0, cnt = 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && Number.isFinite(g[nc][nr])) { sum += g[nc][nr]; cnt++; }
      }
      if (cnt) { g[c][r] = sum / cnt; changed = true; }
    }
    if (!changed) break;
  }
}

const GRID_CACHE = new Map();
const CITY_CACHE = new Map();

/* localStorage persistence. The free Open-Meteo tier is rate-limited, so
   we keep the last good fetch on disk: reloads reuse it within the 30-min
   bucket (no network at all), and if a fetch fails we fall back to
   the most recent stored dataset rather than showing an empty map. */
const LS = 'heat:';
const lsGet = (k) => { try { const v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : null; } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify({ ...v, _t: Date.now() })); } catch {} };
const lsLatest = (prefix) => {   // newest stored entry whose key starts with prefix
  try {
    let best = null, bestT = -1;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LS + prefix)) continue;
      const o = JSON.parse(localStorage.getItem(k));
      if (o && o._t > bestT) { bestT = o._t; best = o; }
    }
    return best;
  } catch { return null; }
};

/* Expand the bundled snapshot into the {g, meta, pts} shape loadGrid
   returns. Flagged `_fallback` so the legend can label it honestly. */
function fallbackGrid() {
  const { meta, g } = FALLBACK_GRID;
  const pts = [];
  for (let c = 0; c < meta.cols; c++)
    for (let r = 0; r < meta.rows; r++) {
      const v = g[c]?.[r];
      if (Number.isFinite(v)) pts.push({ lon: meta.w + c * meta.step, lat: meta.s + r * meta.step, temp: v });
    }
  return { g, meta, pts, _fallback: true };
}

function loadGrid(rp) {
  const key = `grid:${rp.key}:${bucketFor(rp)}`;
  if (GRID_CACHE.has(key)) return GRID_CACHE.get(key);
  const fromLS = lsGet(key);
  if (fromLS) { const p = Promise.resolve(fromLS); GRID_CACHE.set(key, p); return p; }
  const meta = gridMeta();
  const list = buildGlobalGrid();
  const promise = fetchGridTemps(list, rp).then(temps => {
    const g = Array.from({ length: meta.cols }, () => new Array(meta.rows).fill(NaN));
    const pts = [];
    list.forEach((p, i) => {
      if (Number.isFinite(temps[i])) { g[p.col][p.row] = temps[i]; pts.push({ lon: p.lon, lat: p.lat, temp: temps[i] }); }
    });
    if (pts.length < list.length * 0.5) throw new Error('sparse temperature data');
    fillHoles(g, meta.cols, meta.rows);
    const data = { g, meta, pts };
    lsSet(key, data);
    return data;
  }).catch(() => {
    // Fetch failed (rate limit / offline) → reuse the last good grid
    // for this period; if there's none, fall back to the bundled snapshot
    // so the map is never empty.
    const stale = lsLatest(`grid:${rp.key}:`);
    if (stale) return { ...stale, _stale: true };
    GRID_CACHE.delete(key);
    return fallbackGrid();
  });
  GRID_CACHE.set(key, promise);
  return promise;
}
function loadCities(regionKey, rp) {
  const key = `cities:${regionKey}:${rp.key}:${bucketFor(rp)}`;
  if (CITY_CACHE.has(key)) return CITY_CACHE.get(key);
  const fromLS = lsGet(key);
  if (fromLS) { const p = Promise.resolve(fromLS.arr); CITY_CACHE.set(key, p); return p; }
  const cities = (REGIONS[regionKey] || REGIONS.europe).cities;
  const promise = fetchTemps(cities, rp).then(temps => {
    const pts = cities.map((c, i) => ({ ...c, temp: temps[i] })).filter(c => Number.isFinite(c.temp));
    if (!pts.length) throw new Error('no city data');
    lsSet(key, { arr: pts });
    return pts;
  }).catch(() => {
    const stale = lsLatest(`cities:${regionKey}:${rp.key}:`);
    if (stale) return stale.arr;
    CITY_CACHE.delete(key);
    return [];   // cities are non-fatal — field still renders
  });
  CITY_CACHE.set(key, promise);
  return promise;
}

/* ---- Render the field over a given bbox (the framed region, padded),
   bilinearly interpolating the GLOBAL grid and clipping to the selected
   continent's countries. Rendering per-region instead of one tiny global
   canvas is what makes the clip edges sharp: a continent fills ~700–1200
   px (≈9 km/px) instead of ~1°/px, so coastlines/borders read crisp after
   MapLibre's linear upscale. Mercator-Y so it aligns with the basemap. */
const RAD = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
const IMG_CACHE = new Map();

/* Bilinearly sample the grid at an arbitrary lon/lat — used so a city
   pill always has a value (the field's own value at that point) even when
   the precise per-city fetch is unavailable. */
function sampleGridAt(gridData, lon, lat) {
  const { g, meta } = gridData;
  const { cols, rows, step } = meta;
  let gx = (lon - meta.w) / step; if (gx < 0) gx = 0; else if (gx > cols - 1) gx = cols - 1;
  let gy = (lat - meta.s) / step; if (gy < 0) gy = 0; else if (gy > rows - 1) gy = rows - 1;
  const c0 = Math.floor(gx), c1 = Math.min(c0 + 1, cols - 1), fx = gx - c0;
  const r0 = Math.floor(gy), r1 = Math.min(r0 + 1, rows - 1), fy = gy - r0;
  const top = g[c0][r0] * (1 - fx) + g[c1][r0] * fx;
  const bot = g[c0][r1] * (1 - fx) + g[c1][r1] * fx;
  return top * (1 - fy) + bot * fy;
}

function buildFieldImage(gridData, palette, maskFeatures, renderBbox) {
  const { g, meta } = gridData;
  const { cols, rows, step } = meta;
  const [w, s, e, n] = renderBbox;
  const mn = mercY(n), ms = mercY(s);
  const lonSpan = e - w;
  // Global canvas — cap the width so a continent still gets enough detail
  // for clean coastlines without a multi-megapixel image.
  const W = Math.min(1600, Math.max(640, Math.round(lonSpan / 0.09)));
  const H = Math.max(120, Math.round((W * (mn - ms)) / (lonSpan * RAD)));
  const cvs = document.createElement('canvas');
  cvs.width = W; cvs.height = H;
  const c2d = cvs.getContext('2d');
  const img = c2d.createImageData(W, H);
  const invMercY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;
  for (let y = 0; y < H; y++) {
    const lat = invMercY(mn - ((y + 0.5) / H) * (mn - ms));
    let gy = (lat - meta.s) / step; if (gy < 0) gy = 0; else if (gy > rows - 1) gy = rows - 1;
    const r0 = Math.floor(gy), r1 = Math.min(r0 + 1, rows - 1), fy = gy - r0;
    for (let x = 0; x < W; x++) {
      const lon = w + ((x + 0.5) / W) * lonSpan;
      let gx = (lon - meta.w) / step; if (gx < 0) gx = 0; else if (gx > cols - 1) gx = cols - 1;
      const c0 = Math.floor(gx), c1 = Math.min(c0 + 1, cols - 1), fx = gx - c0;
      const top = g[c0][r0] * (1 - fx) + g[c1][r0] * fx;
      const bot = g[c0][r1] * (1 - fx) + g[c1][r1] * fx;
      const temp = top * (1 - fy) + bot * fy;   // bilinear → smooth, no bullseyes
      let [r, gg, bb] = sampleRamp(palette.rgb, temp);
      let a = 195;
      if (temp >= CRITICAL_C) {   // critical glow blended into the field
        const f = 0.32;
        r = Math.round(r + (CRITICAL_RGB[0] - r) * f);
        gg = Math.round(gg + (CRITICAL_RGB[1] - gg) * f);
        bb = Math.round(bb + (CRITICAL_RGB[2] - bb) * f);
        a = 230;
      }
      const idx = (y * W + x) * 4;
      img.data[idx] = r; img.data[idx + 1] = gg; img.data[idx + 2] = bb; img.data[idx + 3] = a;
    }
  }
  c2d.putImageData(img, 0, 0);

  // Clip to the continent's countries: keep field pixels only where a
  // country polygon is drawn (the sea + other continents fall away).
  if (maskFeatures && maskFeatures.length) {
    const projX = (lon) => ((lon - w) / lonSpan) * W;
    const projY = (lat) => ((mn - mercY(lat)) / (mn - ms)) * H;
    c2d.globalCompositeOperation = 'destination-in';
    c2d.fillStyle = '#000';
    c2d.beginPath();
    for (const f of maskFeatures) {
      const geom = f.geometry; if (!geom) continue;
      const polys = geom.type === 'MultiPolygon' ? geom.coordinates
                  : geom.type === 'Polygon' ? [geom.coordinates] : [];
      for (const poly of polys) {
        for (const ring of poly) {
          for (let i = 0; i < ring.length; i++) {
            const X = projX(ring[i][0]), Y = projY(ring[i][1]);
            if (i === 0) c2d.moveTo(X, Y); else c2d.lineTo(X, Y);
          }
          c2d.closePath();
        }
      }
    }
    c2d.fill('evenodd');   // even-odd so inner rings (lakes) cut back to sea
    c2d.globalCompositeOperation = 'source-over';
  }
  return cvs.toDataURL();
}

/* City value pill (HTML marker). Critical cities flip to a solid warn fill. */
function cityPill(label, critical) {
  const el = document.createElement('div');
  el.style.cssText = [
    'font:700 12px/1 var(--f-title)', 'padding:4px 7px', 'border-radius:var(--r-sm)',
    'white-space:nowrap', 'box-shadow:var(--e2)', 'cursor:pointer',
    critical
      ? 'background:#ef4444;color:#fff;border:1px solid #ef4444'
      : 'background:var(--s0);color:var(--t-hi);border:1px solid var(--b-med)',
  ].join(';');
  el.textContent = label;
  return el;
}

export default async function heatmap(ctx, uc) {
  const regionKey  = paramFor(uc, 'region') || 'europe';
  const region     = REGIONS[regionKey] || REGIONS.europe;
  const periodKey  = paramFor(uc, 'period') || 'yesterday';
  const rp         = resolvePeriod(periodKey);
  const unit       = paramFor(uc, 'unit') || 'c';
  const paletteKey = paramFor(uc, 'palette') || 'classic';
  const palette    = PALETTES[paletteKey] || PALETTES.classic;

  const countriesP = loadCountries();   // open country polygons — parallel, cached

  // Fly the camera to the chosen region. The data underneath is global.
  const [w, s, e, n] = region.bbox;
  ctx.fitBounds([[w, s], [e, n]], { duration: 800, maxZoom: 5 });
  ctx.markHomeBounds([[w, s], [e, n]], { maxZoom: 5 });

  // (The subtle "loading" indicator in the legend pill is handled centrally
  //  by the provider via ctx.beginLoading/endLoading — every case gets it.)

  // Serial, not concurrent: grid + cities both hit Open-Meteo, and firing
  // them together trips the rate limiter. Land is a different host, so it
  // can ride alongside.
  let grid, cities, countries;
  try {
    countries = await countriesP;
    if (ctx.cancelled) return;
    grid = await loadGrid(rp);
    if (ctx.cancelled) return;
    cities = await loadCities(regionKey, rp);
  } catch (err) {
    if (ctx.cancelled) return;
    ctx.setLegend({ items: [{ color: '#ef4444', shape: 'dot', label: 'Open-Meteo unavailable — retry shortly' }] });
    return;
  }
  if (ctx.cancelled) return;

  if (!grid.pts.length) {
    ctx.setLegend({ items: [{ color: '#ef4444', shape: 'dot', label: 'Open-Meteo: no data' }] });
    return;
  }

  // Mask the field to the selected continent's countries (world → all
   // land). Units don't change the pixels, so the cache still hits on a
   // °C/°F flip; region/palette/period are part of the key.
  const continent = CONTINENT_OF[regionKey];
  const maskFeatures = (continent && Array.isArray(countries))
    ? countries.filter(f => f.properties?.CONTINENT === continent)
    : countries;
  // Render the field GLOBALLY (clipped to the continent's countries), so
  // the painted edge follows real borders/coastlines everywhere — no hard
  // rectangular cut where a region bbox would slice through a country.
  const renderBbox = FIELD_BBOX.slice();
  const imgKey = `${rp.key}:${bucketFor(rp)}:${paletteKey}:${regionKey}`;
  let dataUrl = IMG_CACHE.get(imgKey);
  if (!dataUrl) { dataUrl = buildFieldImage(grid, palette, maskFeatures, renderBbox); IMG_CACHE.set(imgKey, dataUrl); }

  // Insert the field BELOW the basemap's labels (the first symbol layer)
  // so city + country names stay readable on top of the heat — crucial on
  // satellite, where there's no vector water and the field would otherwise
  // bury the imagery and its labels. Lower opacity on satellite so the
  // imagery shows through and the heat reads as a tint, not a sticker.
  const [rw, rs, re, rn] = renderBbox;
  const firstSymbol = ctx.ml.getStyle().layers.find(l => l.type === 'symbol');
  const family = document.documentElement.getAttribute('data-map-family') || 'standard';
  const fieldOpacity = family === 'satellite' ? 0.72 : 0.9;
  ctx.addSource('temp-field', {
    type: 'image',
    url: dataUrl,
    coordinates: [[rw, rn], [re, rn], [re, rs], [rw, rs]],
  });
  ctx.addLayer({
    id: 'temp-field',
    type: 'raster',
    source: 'temp-field',
    paint: { 'raster-opacity': fieldOpacity, 'raster-resampling': 'linear', 'raster-fade-duration': 0 },
  }, firstSymbol?.id);

  // City pills. Every region city gets one — its precise fetched value
  // when available, otherwise the field's value at that point — so the
  // numbers are ALWAYS there, never blank. Critical cities (the heat
  // points) show at every zoom; the rest reveal as you zoom in.
  const fetchedTemp = new Map((cities || []).map(c => [c.name, c.temp]));
  let criticalCities = 0;
  const pills = [];
  region.cities.forEach((c, i) => {
    const temp = fetchedTemp.has(c.name) ? fetchedTemp.get(c.name) : sampleGridAt(grid, c.lon, c.lat);
    const critical = temp >= CRITICAL_C;
    if (critical) criticalCities++;
    const minZoom = critical ? 0 : (i < 12 ? 0 : 3.2);
    const m = ctx.addMarker(
      {
        element: cityPill(fmtTemp(temp, unit), critical),
        anchor: 'center',
        popupHTML: infoCard({
          accent: critical ? cssVar('--c-negative', '#EE6748') : cssVar('--c-neutral', '#3C5C98'),
          eyebrow: 'Daily high',
          title: c.name,
          rows: [
            ['Temperature', fmtTemp(temp, unit)],
            ['Status', critical ? `Critical · ≥ ${fmtTemp(CRITICAL_C, unit)}` : 'Within normal range'],
            ['Reading', rp.label],
            ['Source', 'Open-Meteo (open data)'],
          ],
          footer: 'Open data · Open-Meteo, rendered on the TomTom Orbis basemap',
        }),
        popupOpts: { offset: 14 },
      },
      [c.lon, c.lat],
    );
    pills.push({ el: m.getElement(), minZoom });
  });

  // Reveal more pills as you zoom in — a few headline cities when zoomed
  // out, the rest opening up on approach, like a cluster expanding.
  const applyPillZoom = () => {
    const z = ctx.ml.getZoom();
    for (const p of pills) p.el.style.display = z >= p.minZoom ? '' : 'none';
  };
  ctx.on('zoom', applyPillZoom);
  applyPillZoom();

  // Legend: range for what's framed (the data is global, but the bar
   // reads the in-view grid so the scale stays meaningful per region) +
   // the critical tally. Short on purpose — the gradient walks the full
   // palette so it matches the field exactly.
  const inView = grid.pts.filter(p => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n);
  const range = inView.length > 3 ? inView : grid.pts;
  const temps = range.map(p => p.temp);
  const min = Math.min(...temps), max = Math.max(...temps);
  // No title — keep the pill small; the gradient + values speak for it.
  // Flag the bundled snapshot as "sample" so it's never passed off as real.
  const legendItems = [
    { html: gradientSwatch(palette, min, max), label: `${fmtTemp(min, unit)} → ${fmtTemp(max, unit)}` },
    { color: '#ef4444', shape: 'dot', label: `≥ ${fmtTemp(CRITICAL_C, unit)} · ${criticalCities}` },
  ];
  // Name the weather source on the fallback so it's clear the weather data
  // (Open-Meteo) is what's unavailable — the TomTom map is fine.
  if (grid._fallback) legendItems.push({ color: 'transparent', shape: 'dot', label: 'Open-Meteo · sample' });
  ctx.setLegend({ items: legendItems });
}
