/* City live traffic — the worst jams in a city right now, ready to put
   on air.

   Modelled on the broadcast traffic desks TV stations run at rush hour:
   a presenter stands in front of a full-screen map, taps a jam, and
   reads three numbers off it — speed, length, delay — while the camera
   centres on it. The board's job is to make that tap-and-talk loop
   effortless: the worst jams are already picked, already numbered and
   already enriched when the segment starts.

   HOW IT WORKS
     1. Incident Details over the city bbox, narrowed server-side to live
        jams (categoryFilter=6, timeValidityFilter=present). São Paulo at
        5 pm returns ~470 of them — too many to talk about.
     2. Rank by delay × length. Delay alone favours a 400 m side street
        stuck at a light; length alone favours a long, slow-moving
        motorway. The product is the queue a viewer might actually be in:
        4.3 km of Marginal Tietê at +13 min outranks 500 m at +16 min.
     3. Enrich only the top N, in parallel:
          - Traffic Flow Segment Data at the jam's midpoint → the road's
            free-flow speed. Incidents carry delay and length but no
            speed, and speed is the number a viewer relates to.
            The speed shown is the AVERAGE through the jam, derived from
            the incident's own numbers: length ÷ (free-flow time + delay).
            The flow sample's currentSpeed is one point on the road, and
            on Rio's Linha Vermelha it read 52 km/h beside a +56 min delay
            over 6 km — three numbers that contradicted each other on air.
            It stays as the fallback when free-flow is unknown.
          - Reverse Geocoding at the same point → the road's name.
            Incidents only name the cross streets (`from` / `to`), so
            without this the headline reads "Rua Poema dos Olhos" for a
            jam on Rodovia Raposo Tavares.
     4. Draw the top N as thick lines with a numbered marker, over the
        SDK's live flow layer, and list them in the side panel.
     5. Refresh on a timer. A selection survives the refresh by incident
        id; if the jam has cleared, the same rank takes its place.

   LIVE VIEW
   One button (Live) turns the case into the broadcast view: browser full
   screen, every piece of library chrome hidden, and the side panel
   becomes a lower-third card with the three numbers set large enough to
   read from across a studio. ← / → (what a presentation clicker sends)
   step through the ranking; Esc leaves. Tapping a line or marker still
   works, which is the touch-screen workflow.

   The live-view flag is module state, not ctx state, so it survives the
   scene replays the provider runs on a theme or basemap swap — see
   `onAirWanted` / `pendingExit` below. */

import { trafficJams, flowSegment, reverseGeocode, geocode } from '../../map/services.js';
import { cumulative, pointAtDistance, haversine } from '../../map/geo.js';
import { paramFor } from '../../state.js';
import { createStatefulNumberPin, createStatefulPin } from '../../render/marker.js';

/* City presets: a bbox that covers the metro's jam-prone road network
   without running into the 10,000 km² Incident Details limit. */
const CITIES = {
  saopaulo:   { label: 'São Paulo',   bbox: [-46.83, -23.70, -46.45, -23.42] },
  mexicocity: { label: 'Mexico City', bbox: [-99.30,  19.30, -98.98,  19.56] },
  newyork:    { label: 'New York',    bbox: [-74.10,  40.60, -73.80,  40.88] },
  losangeles: { label: 'Los Angeles', bbox: [-118.55, 33.90, -118.10, 34.15] },
  london:     { label: 'London',      bbox: [-0.35,   51.40,  0.12,   51.62] },
  paris:      { label: 'Paris',       bbox: [2.20,    48.78,  2.50,   48.95] },
  berlin:     { label: 'Berlin',      bbox: [13.20,   52.43, 13.60,   52.60] },
  amsterdam:  { label: 'Amsterdam',   bbox: [4.75,    52.30,  5.02,   52.43] },
};

/* Incident events carry a description per code; these are the two a
   jam arrives with most often, shortened for a headline. */
const EVENT_SHORT = {
  'Stationary traffic': 'Stationary',
  'Queuing traffic':    'Queuing',
  'Slow traffic':       'Slow',
  'Heavy traffic':      'Heavy',
};

/* Survives the teardown → re-run the provider does on theme and basemap
   swaps, so a presenter who is live stays live. `pendingExit` is set
   by teardown and cleared by the next run of this scene; if a different
   scene runs instead, the deferred exit fires and restores the chrome. */
let onAirWanted = false;
let pendingExit = false;
let lastSelection = null;       // { cityKey, id } — reselected after a replay

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const fmtLength = m => m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)}` : `${Math.round(m / 10) * 10}`;
const lengthUnit = m => m >= 1000 ? 'km' : 'm';
const fmtDelayMin = s => Math.max(1, Math.round(s / 60));

/* Average speed through the jam, km/h: the time to cross it at free
   flow, plus the delay the incident reports. */
function avgSpeed(lengthM, delaySec, freeFlowKmh) {
  if (!(lengthM > 0) || !(freeFlowKmh > 0)) return null;
  const freeSec = lengthM / (freeFlowKmh / 3.6);
  return (lengthM / (freeSec + (delaySec || 0))) * 3.6;
}

function bboxOfLine(coords) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x; if (x > e) e = x;
    if (y < s) s = y; if (y > n) n = y;
  }
  return [[w, s], [e, n]];
}

/* Midpoint by distance, not by vertex index — a jam's vertices bunch up
   at junctions, so the middle vertex can sit near one end. */
function midpoint(coords) {
  if (coords.length < 2) return coords[0];
  const cum = cumulative(coords);
  return pointAtDistance(coords, cum, cum[cum.length - 1] / 2).lngLat;
}

/* Bounded fan-out. Ten jams means twenty enrichment calls; firing them
   all at once is what earns a 429 from the QPS limit on a busy key. */
async function pool(items, fn, limit = 4) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

/* What "worst" means. Each score reads only the incident's own delay and
   length, so switching lens re-ranks without a single extra call.
     impact   delay × length — the queue a viewer is sitting in (default)
     delay    the most minutes lost crossing the jam
     length   the longest queue
     slowest  minutes lost per km — stop-and-go density. Jams under 300 m
              are left out: a 100 m stretch at a light scores absurdly.
   No lens can be "volume": no public TomTom API counts live vehicles. */
const RANKS = {
  impact:  { label: 'queue impact',   score: p => p.delay * (p.length || 0) / 1000 },
  delay:   { label: 'longest delay',  score: p => p.delay },
  length:  { label: 'longest queue',  score: p => p.length || 0 },
  slowest: { label: 'slowest',        score: p => (p.length >= 300 ? p.delay / (p.length / 1000) : 0) },
};

/* Incidents shown beside the ranking as context — what is ALSO happening
   on the road, not a claimed cause: in São Paulo only 1 of 416 jams came
   linked to its cause. iconCategory from Incident Details. */
const HAZARDS = {
  1: { kind: 'accident', label: 'Accident',
       svg: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>' },
  8: { kind: 'closed',   label: 'Road closed',
       svg: '<circle cx="12" cy="12" r="9"/><path d="M7.5 12h9"/>' },
  9: { kind: 'works',    label: 'Roadworks',
       svg: '<rect x="2" y="6" width="20" height="8" rx="1"/><path d="M17 14v7"/><path d="M7 14v7"/><path d="M17 3v3"/><path d="M7 3v3"/><path d="M10 14 2.3 6.3"/><path d="m14 6 7.7 7.7"/><path d="m8 6 8 8"/>' },
};
const HAZARD_NEAR_M = 400;     // only context that touches a ranked jam
const HAZARD_MAX = 12;

/* Street-name abbreviations, applied only when the full name does not
   fit its line (see fitNames). The ones a local reader already knows —
   Av., R., Rod. in Portuguese; Ave, St, Rd in English — so the short form
   is recognisable, not a code. Whole words only, case-sensitive. */
const ABBR = [
  // Portuguese
  ['Avenida', 'Av.'], ['Rua', 'R.'], ['Rodovia', 'Rod.'], ['Alameda', 'Al.'],
  ['Estrada', 'Estr.'], ['Travessa', 'Tv.'], ['Praça', 'Pç.'], ['Viaduto', 'Vd.'],
  ['Presidente', 'Pres.'], ['Professor', 'Prof.'],
  ['Professora', 'Profa.'], ['Doutor', 'Dr.'], ['Engenheiro', 'Eng.'],
  ['Marechal', 'Mal.'], ['General', 'Gen.'], ['Brigadeiro', 'Brig.'],
  ['Embaixador', 'Emb.'], ['Governador', 'Gov.'], ['Senador', 'Sen.'],
  ['Deputado', 'Dep.'], ['Comendador', 'Com.'], ['Almirante', 'Alm.'],
  ['Coronel', 'Cel.'], ['Capitão', 'Cap.'],
  // Not abbreviated: Marginal (part of the name — "Marginal Tietê"), São /
  // Santo / Santa ("S. Caetano" reads as a typo, not an abbreviation).
  // Spanish
  ['Calzada', 'Calz.'], ['Calle', 'C.'], ['Carretera', 'Carr.'], ['Periférico', 'Perif.'],
  ['Circuito', 'Cto.'], ['Boulevard', 'Blvd'],
  // English / French
  ['Avenue', 'Ave'], ['Street', 'St'], ['Road', 'Rd'], ['Highway', 'Hwy'],
  ['Expressway', 'Expy'], ['Parkway', 'Pkwy'], ['Drive', 'Dr'], ['Freeway', 'Fwy'],
  ['Autoroute', 'Aut.'],   // (French Boulevard is covered by 'Blvd' above)
];
const ABBR_RE = ABBR.map(([full, short]) => [new RegExp(`(^|[\\s(/–-])${full}(?=$|[\\s,)/–-])`, 'gu'), `$1${short}`]);
function abbreviate(name) {
  let out = String(name ?? '');
  for (const [re, rep] of ABBR_RE) out = out.replace(re, rep);
  return out;
}

/* Jam colours, taken from the Orbis style's own traffic-flow layers
   ("Traffic - Slow / Queueing / Stationary flow"), per theme. The board
   speaks the same colour language as the basemap's traffic: red means
   queueing, dark red means stopped — our earlier coral / saffron read as
   *lighter* traffic than the map's red, on the very jams ranked worst.

   Each jam is a gradient from its tail to its head (incident geometry
   runs in the driving direction, `from` → `to`), deepening toward the
   bottleneck:
     major    (magnitudeOfDelay ≥ 3)  queueing → stationary
     moderate                          slow     → queueing
   `mark` fills the marker and rank dots. Both carry a white label at
   AA: stationary 9.7:1 (dark) / 7.6:1 (light); queueing 4.8:1 in dark.
   The light style's queueing red (#FB2D09) passes with neither white
   (3.8:1) nor dark ink (4.3:1), so its marker takes the same hue 5 %
   darker (#DD2403, 4.85:1) — the line keeps the style's exact tone. */
/* Colour maths for reading the style's traffic colours at runtime and
   keeping the marker label at AA: parse hsl()/hex, then darken the fill
   in 1 % lightness steps until white text reaches 4.5:1. */
function parseColor(c) {
  if (typeof c !== 'string') return null;
  const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (hex) { const n = parseInt(hex[1], 16); return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255); }
  const m = /hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i.exec(c);
  return m ? { h: +m[1], s: +m[2], l: +m[3] } : null;
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}
function hslToHex({ h, s, l }) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
function whiteContrast(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return 1.05 / (L + 0.05);
}
function markFor(color) {
  const c = parseColor(color);
  if (!c) return color;
  let hex = hslToHex(c);
  while (whiteContrast(hex) < 4.5 && c.l > 5) { c.l -= 1; hex = hslToHex(c); }
  return hex;
}

const JAM_PALETTE = {
  dark:  { slow: '#DB9200', queue: '#DA2E0B', stop: '#8F0000', queueMark: '#DA2E0B' },
  light: { slow: '#FFC105', queue: '#FB2D09', stop: '#AD0000', queueMark: '#DD2403' },
};

/* Where a jam's marker may sit, best first: the middle, then points
   stepping out toward both ends. Every candidate is ON the jam, so a
   marker nudged out of a collision still marks the road it describes. */
const ANCHOR_FRACTIONS = [0.5, 0.38, 0.62, 0.26, 0.74, 0.14, 0.86];
function anchorsAlong(coords) {
  if (coords.length < 2) return [coords[0]];
  const cum = cumulative(coords);
  const total = cum[cum.length - 1];
  return ANCHOR_FRACTIONS.map(f => pointAtDistance(coords, cum, total * f).lngLat);
}

/* Marker footprints in screen pixels, from the stateful marker geometry
   (34 px dot; 44 × 52 pin standing on its coordinate). */
const DOT_R = 17;
const PIN_R = 24, PIN_LIFT = 28;   // the pin's head, centred above the tip
const GAP = 4;

/* Resolve the `city` param: a preset key, or any city name typed into
   the combobox. A searched city gets its geocoded viewport, capped so a
   sprawling municipality can't exceed the endpoint's area limit. */
async function resolveCity(value) {
  if (CITIES[value]) return { key: value, ...CITIES[value] };
  const hit = (await geocode({ query: String(value), limit: 1, entityType: 'Municipality' }).catch(() => []))[0];
  if (!hit) return { key: 'saopaulo', ...CITIES.saopaulo };
  const [lng, lat] = hit.position;
  const vp = hit.viewport;
  const MAX_HALF = 0.22;   // ≈ 48 km across at the equator — well under 10,000 km²
  let halfLng = 0.15, halfLat = 0.12;
  if (vp?.topLeftPoint && vp?.btmRightPoint) {
    halfLng = Math.min(MAX_HALF, Math.abs(vp.btmRightPoint.lon - vp.topLeftPoint.lon) / 2);
    halfLat = Math.min(MAX_HALF, Math.abs(vp.topLeftPoint.lat - vp.btmRightPoint.lat) / 2);
  }
  return {
    key: `q:${String(value).toLowerCase()}`,
    label: hit.name || String(value),
    bbox: [lng - halfLng, lat - halfLat, lng + halfLng, lat + halfLat],
  };
}

export default async function traffic(ctx, uc) {
  // A replay of this scene cancels the deferred exit its teardown queued.
  pendingExit = false;

  /* Registered before the first await: a teardown that lands while this
     run is still booting (theme replay, then another case picked) must
     still hand the chrome back. A replay of this scene runs
     synchronously right after teardown and clears `pendingExit`;
     anything else leaves it set, and the deferred exit fires. */
  ctx.onTeardown(() => {
    if (!onAirWanted) return;
    pendingExit = true;
    setTimeout(() => {
      if (!pendingExit) return;
      pendingExit = false;
      onAirWanted = false;
      lastSelection = null;
      document.documentElement.classList.remove('is-on-air');
      try { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); } catch {}
    }, 0);
  });

  const count      = Number(paramFor(uc, 'count')) || 10;
  const refreshSec = Number(paramFor(uc, 'refresh')) || 600;
  const flowMode   = paramFor(uc, 'flow') || 'main';
  const rankBy     = RANKS[paramFor(uc, 'rankBy')] || RANKS.impact;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  /* The flow module is loaded (hidden) first in every mode: its style
     layers are where the theme's native traffic colours live. Read them
     at runtime so a style update carries through; the constants above
     are only the fallback if the module can't load. */
  const flowSource = await ctx.ensureTrafficFlowSource();
  if (ctx.cancelled) return;

  /* Every line this scene draws goes UNDER the basemap's labels — where
     the style keeps its own traffic — so street names stay readable on
     top of the jams instead of being buried by them (they were: the
     layers used to land at the top of the stack). The anchor is the
     first layer after the style's traffic layers, taken once, before any
     of ours exist, so inserting each of ours before it keeps our order. */
  const LABEL_ANCHOR = (() => {
    const ls = ctx.ml.getStyle()?.layers || [];
    let last = -1;
    ls.forEach((l, i) => { if (l.source === 'vectorTilesFlow' || l.source === 'vectorTilesIncidents') last = i; });
    const after = last >= 0 ? ls.slice(last + 1).find(l => !l.id.startsWith('jam')) : null;
    if (after) return after.id;
    // No traffic layers in the style: fall back to its first real label.
    return ls.find(l => l.type === 'symbol' && !/arrow|Turning/i.test(l.id))?.id;
  })();
  const addUnderLabels = def => ctx.addLayer(def, ctx.ml.getLayer(LABEL_ANCHOR) ? LABEL_ANCHOR : undefined);
  const styleColor = id => {
    const v = ctx.ml.getLayer(id) ? ctx.ml.getPaintProperty(id, 'line-color') : null;
    return typeof v === 'string' ? v : null;
  };
  const fallback = isDark ? JAM_PALETTE.dark : JAM_PALETTE.light;
  const pal = {
    stop:  styleColor('Traffic - Stationary flow') || fallback.stop,
    queue: styleColor('Traffic - Queueing flow')   || fallback.queue,
    slow:  styleColor('Traffic - Slow flow')       || fallback.slow,
    free:  styleColor('Traffic - Free flow')       || (isDark ? '#1F7A45' : '#2E9E5B'),
  };
  // Line gradients (tail → head), in the style's own traffic colours.
  const MAJOR    = { from: pal.queue, to: pal.stop,  mark: markFor(pal.stop) };
  const MODERATE = { from: pal.slow,  to: pal.queue, mark: markFor(pal.queue) };

  /* Marker, list-dot and rank-tile colour follow the RANK, not TomTom's
     magnitudeOfDelay. Ranking by delay × length while colouring by
     magnitude put a queueing-red #1 above a stationary-dark-red #3, and
     the list read out of order. Now #1 takes the style's stationary red
     and the scale lightens step by step to its queueing red at #N —
     never amber: every jam on the board is a serious one. Whatever the
     lens, colour and order say the same thing. Each step is darkened
     only as far as a white label needs for 4.5:1. */
  const mixHsl = (a, b, t) => {
    const A = parseColor(a), B = parseColor(b);
    if (!A || !B) return a;
    const dh = ((B.h - A.h + 540) % 360) - 180;   // shortest way round the hue wheel
    return `hsl(${(A.h + dh * t + 360) % 360}, ${A.s + (B.s - A.s) * t}%, ${A.l + (B.l - A.l) * t}%)`;
  };
  const rankColor = (rank, n) => markFor(mixHsl(pal.stop, pal.queue, n > 1 ? Math.min(1, (rank - 1) / (n - 1)) : 0));
  const OFF_BOARD = markFor(pal.queue);
  const familyOf = mag => (mag >= 3 ? MAJOR : MODERATE);
  /* White casing on both themes. On the dark map a casing in the ground
     colour vanished into it; a dark casing on the light map (tried, the
     inverse rule) read as a heavy outline. White lifts the red off either
     basemap, and matches the white direction chevrons. */
  const casing = '#FFFFFF';

  const city = await resolveCity(paramFor(uc, 'city') || 'saopaulo');
  if (ctx.cancelled) return;
  const cityBounds = [[city.bbox[0], city.bbox[1]], [city.bbox[2], city.bbox[3]]];
  ctx.fitBounds(cityBounds, { duration: 0, animate: false });

  // Basemap POI icons compete with the numbered markers for attention.
  ctx.hideLayers(lyr => lyr.id.startsWith('POI') || lyr.id === 'House Number');

  /* Road traffic under the jams — added first so the jam layers stack on
     top of it.
       all   the SDK's own flow overlay, every road class
       main  motorways, trunks and primaries only, the Waze-style read: the
             arteries a city's traffic report is about, whole, with the
             rest of the network left quiet. Drawn from the style's own
             flow source ("Traffic flow" tiles carry `relative_speed` and
             `road_category`) in the style's own flow colours, as one
             continuous ramp instead of four steps. */
  if (flowMode === 'all') await ctx.enableTrafficFlow();
  if (ctx.cancelled) return;
  if (flowMode === 'main' && flowSource) {
    const c = pal;
    /* Own widths, not the style's: its flow lines are sized to sit under
       every road class and read as hairlines once they are the story.
       Both directions of a two-way road overlap into one band — the
       arterial, not its carriageways, is what a report talks about. */
    const byClass = (motorway, trunk, primary) =>
      ['match', ['get', 'road_category'], 'motorway', motorway, 'trunk', trunk, primary];
    addUnderLabels({
      id: 'jams-arterials', type: 'line', source: 'vectorTilesFlow', 'source-layer': 'Traffic flow',
      // Closures are not slow traffic: relative_speed 0 there means "no
      // traffic allowed", and painting it stationary red told a reader
      // Avenida do Estado was jammed at 0 km/h when it was closed. They
      // get the style's own closed-road treatment below instead.
      filter: ['all',
        ['match', ['get', 'road_category'], ['motorway', 'trunk', 'primary'], true, false],
        ['!', ['has', 'road_closure']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        // The style's own step thresholds (0.15 / 0.35 / 0.75), blended.
        'line-color': ['interpolate', ['linear'], ['get', 'relative_speed'],
          0.1, c.stop, 0.25, c.queue, 0.55, c.slow, 0.85, c.free],
        'line-width': ['interpolate', ['linear'], ['zoom'],
          9, byClass(3, 2.5, 1.5), 12, byClass(5, 4, 3), 15, byClass(8, 7, 5)],
        'line-opacity': 0.95,
      },
    });

    /* Closed main roads, drawn the way the Orbis style draws them: a red
       outline carrying a light dashed pattern — the colours read from its
       "Traffic - Closed road outline / pattern" layers. */
    const closedFilter = ['all',
      ['match', ['get', 'road_category'], ['motorway', 'trunk', 'primary'], true, false],
      ['has', 'road_closure']];
    const closedOutline = ctx.ml.getLayer('Traffic - Closed road outline')
      ? ctx.ml.getPaintProperty('Traffic - Closed road outline', 'line-color') : null;
    const closedPattern = styleColor('Traffic - Closed road pattern') || '#C8CFD2';
    addUnderLabels({
      id: 'jams-arterials-closed', type: 'line', source: 'vectorTilesFlow', 'source-layer': 'Traffic flow',
      filter: closedFilter,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': closedOutline || pal.stop,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, byClass(4, 3.5, 2.5), 12, byClass(6, 5, 4), 15, byClass(10, 9, 7)],
      },
    });
    addUnderLabels({
      id: 'jams-arterials-closed-pattern', type: 'line', source: 'vectorTilesFlow', 'source-layer': 'Traffic flow',
      filter: closedFilter,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': closedPattern,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, byClass(1.5, 1.2, 1), 12, byClass(2.5, 2, 1.5), 15, byClass(4, 3.5, 3)],
        'line-dasharray': [1.5, 1.5],
      },
    });
  }

  let all = [];          // every live jam in the bbox (for the summary line)
  let top = [];          // ranked + enriched top N
  let selectedId = null;
  let updatedAt = null;
  let layersAdded = false;
  let pins = new Map();   // jam / hazard id → marker
  let hazards = [];       // closures, works, accidents next to ranked jams
  let rankOf = new Map(); // incident id → rank under the active lens, all jams
  let explainToken = 0;   // bumps on every selection change; stale road taps drop out
  let closures = [];      // every reported road closure in the bbox
  let refreshing = false;

  /* ── Data ─────────────────────────────────────────────────────────── */

  async function load() {
    const maxAgeMs = Math.max(30_000, refreshSec * 1000 - 5_000);
    const [raw, context] = await Promise.all([
      trafficJams({ bbox: city.bbox.join(','), maxAgeMs }),
      trafficJams({ bbox: city.bbox.join(','), maxAgeMs, categoryFilter: '1,8,9' }).catch(() => []),
    ]);
    all = raw.filter(j => j.geometry?.type === 'LineString' && (j.properties?.delay ?? 0) > 0);

    const order = all
      .map(j => ({ j, score: rankBy.score(j.properties) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);
    // Every jam's position under the active lens — so a tap on a red road
    // outside the board can say "#18", not just "not in the list".
    rankOf = new Map(order.map((r, i) => [r.j.properties.id, i + 1]));
    const ranked = order.slice(0, count).map(({ j }) => j);

    const enriched = await pool(ranked, (j, i) => enrich(j, i + 1, maxAgeMs));
    for (const j of enriched) j.color = rankColor(j.rank, enriched.length);
    top = enriched;
    hazards = nearbyHazards(context, top);
    closures = context.filter(i => i.properties?.iconCategory === 8 && i.geometry);
    updatedAt = Date.now();
  }

  /* One jam → everything the card and the map need: live speed (Flow
     Segment Data at its midpoint) and the road's name (Reverse
     Geocoding). Used for the board, and on demand for a jam tapped below
     the cut. */
  async function enrich(j, rank, maxAgeMs) {
    const p = j.properties;
    const coords = j.geometry.coordinates;
    const mid = midpoint(coords);
    const [flow, place] = await Promise.all([
      flowSegment({ point: mid, zoom: 10, maxAgeMs }),
      reverseGeocode({ point: mid }).catch(() => null),
    ]);
    const event = p.events?.[0]?.description || 'Slow traffic';
    return {
      id: p.id,
      rank,
      coords,
      mid,
      anchors: anchorsAlong(coords),
      cum: cumulative(coords),
      bounds: bboxOfLine(coords),
      magnitude: p.magnitudeOfDelay ?? 0,
      major: (p.magnitudeOfDelay ?? 0) >= 3,
      color: OFF_BOARD,   // the board recolours by rank after enrichment
      delay: p.delay,
      length: p.length || 0,
      from: p.from, to: p.to,
      roadNumbers: p.roadNumbers || [],
      // The road's own name beats its number for a viewer; the cross
      // street is the last resort, and still better than nothing.
      name: place?.streetName || p.roadNumbers?.[0] || p.from || 'Unnamed road',
      area: place?.municipalitySubdivision || place?.municipality || null,
      event: EVENT_SHORT[event] || event,
      speed: avgSpeed(p.length || 0, p.delay, flow?.freeFlowSpeed) ?? flow?.currentSpeed ?? null,
      freeFlow: flow?.freeFlowSpeed ?? null,
    };
  }

  /* Context incidents that touch a ranked jam, nearest to the worst jam
     first. Distance is to the jam's vertices — dense enough on a jam line
     for a 400 m test. */
  function nearbyHazards(list, jams) {
    const out = [];
    for (const inc of list) {
      const type = HAZARDS[inc.properties?.iconCategory];
      const g = inc.geometry;
      if (!type || !g) continue;
      // Point or LineString only — a MultiLineString would hand midpoint()
      // nested arrays and poison every distance with NaN.
      if (g.type !== 'Point' && g.type !== 'LineString') continue;
      const pos = g.type === 'Point' ? g.coordinates : midpoint(g.coordinates);
      let best = null;
      for (const j of jams) {
        for (const c of j.coords) {
          const d = haversine(pos, c);
          if (d <= HAZARD_NEAR_M && (!best || j.rank < best.rank || (j.rank === best.rank && d < best.d))) {
            best = { rank: j.rank, d };
            break;
          }
        }
      }
      if (!best) continue;
      const desc = inc.properties.events?.[0]?.description || type.label;
      out.push({
        id: `hz:${inc.properties.id}`, hazard: true, type, pos, anchors: [pos],
        near: best.rank, dist: best.d,
        title: [desc, inc.properties.from].filter(Boolean).join(' · '),
      });
    }
    return out.sort((a, b) => a.near - b.near || a.dist - b.dist).slice(0, HAZARD_MAX)
      .map((h, i) => ({ ...h, rank: 100 + i }));
  }

  /* `extra` is a road tapped off the board (see explainRoad): shown with
     the same card, highlight and camera as a board jam, but not ranked
     among them and gone as soon as the selection changes. */
  let extra = null;
  const byId = id => top.find(j => j.id === id) || (extra && extra.id === id ? extra : null);
  const current = () => byId(selectedId);

  /* ── Map ──────────────────────────────────────────────────────────── */

  /* Direction chevron, drawn once as an SDF so its colour follows the
     casing. Removed on teardown — the ctx does not track images. */
  const ARROW = 'jam-arrow';
  if (!ctx.ml.hasImage(ARROW)) {
    const px = 2, w = 16 * px, h = 16 * px;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.strokeStyle = '#000'; g.lineWidth = 3 * px; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(5 * px, 3 * px); g.lineTo(11 * px, 8 * px); g.lineTo(5 * px, 13 * px); g.stroke();
    ctx.ml.addImage(ARROW, g.getImageData(0, 0, w, h), { pixelRatio: px, sdf: true });
  }
  ctx.onTeardown(() => { try { ctx.ml.hasImage(ARROW) && ctx.ml.removeImage(ARROW); } catch {} });

  /* ── Direction arrows ─────────────────────────────────────────────────
     Chevrons walk along each jam in the driving direction, and how fast
     they walk is the jam's own average speed: a stopped queue crawls, a
     moving one flows. Screen-space, not real speed — 15 km/h at true
     scale would not visibly move — so the mapping is px/s, kept constant
     across zoom by converting through metres-per-pixel each frame.
     Honours prefers-reduced-motion: the arrows then sit still. */
  const ARROW_GAP_PX = 64;
  const MAX_ARROWS_PER_JAM = 200;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  /* Deliberately slow — these are cars in a queue, not a flow map. A
     stopped jam barely creeps; the fastest jam on the board still reads
     as congested. 5 km/h ≈ 2.8 px/s, 20 km/h ≈ 6.5 px/s, cap ≈ 11 px/s. */
  const arrowPxPerSec = j => 1.5 + Math.min(40, j.speed ?? 5) * 0.25;

  function arrowData(now) {
    const z = ctx.ml.getZoom();
    const features = [];
    for (const j of extra?.kind === 'jam' ? [...top, extra] : top) {
      const total = j.cum[j.cum.length - 1];
      if (!(total > 0)) continue;
      const mpp = 40075016.686 * Math.cos(j.mid[1] * Math.PI / 180) / (512 * 2 ** z);
      const gap = ARROW_GAP_PX * mpp;
      const phase = reduceMotion ? gap / 2 : ((now / 1000) * arrowPxPerSec(j) * mpp) % gap;
      const dim = !!selectedId && j.id !== selectedId;
      const order = j.id === selectedId ? 1000 : 100 - j.rank;
      let n = 0;
      for (let d = phase; d < total && n < MAX_ARROWS_PER_JAM; d += gap, n++) {
        const { lngLat, bearing } = pointAtDistance(j.coords, j.cum, d);
        // The chevron is drawn pointing east; bearings count from north.
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: lngLat },
          properties: { rot: bearing - 90, dim, order } });
      }
    }
    return { type: 'FeatureCollection', features };
  }

  /* ~30 fps is plenty for a slow chevron and halves the setData work. */
  let arrowFrame = null, arrowLast = 0;
  function arrowLoop(now) {
    arrowFrame = null;
    if (ctx.cancelled) return;
    if (!top.length && !extra) { arrowFrame = null; return; }   // kicked again by draw()
    if (now - arrowLast >= 33) {
      arrowLast = now;
      ctx.ml.getSource('jam-arrows')?.setData(arrowData(now));
    }
    if (!reduceMotion) arrowFrame = requestAnimationFrame(arrowLoop);
  }
  const kickArrows = () => { if (arrowFrame == null) arrowFrame = requestAnimationFrame(arrowLoop); };
  // Static arrows still need re-spacing when the zoom changes.
  if (reduceMotion) ctx.on('zoomend', kickArrows);
  ctx.onTeardown(() => { if (arrowFrame != null) cancelAnimationFrame(arrowFrame); });

  const gradient = f => ['interpolate', ['linear'], ['line-progress'], 0, f.from, 1, f.to];
  const width = (sel, idle) => ['interpolate', ['linear'], ['zoom'], 10, sel ? sel[0] : idle[0], 15, sel ? sel[1] : idle[1]];

  function draw() {
    const sel = selectedId;
    const data = {
      type: 'FeatureCollection',
      features: [...top].reverse().map(j => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: j.coords },
        properties: {
          id: j.id, major: j.major,
          // Rank 1 last and sort-keyed highest: the worse jam wins a
          // shared carriageway.
          order: 100 - j.rank,
          selected: j.id === sel, dim: !!sel && j.id !== sel,
        },
      })),
    };

    if (!layersAdded) {
      // lineMetrics: line-progress (the gradient) is only defined with it.
      ctx.addSource('jams', { type: 'geojson', data, lineMetrics: true });

      /* line-gradient can't read feature properties, so each colour
         family is its own layer over the one source; the selected jam
         gets its own pair on top of everything. */
      const lineLayers = (suffix, filter, w, f) => [
        { id: `jams-casing${suffix}`, type: 'line', source: 'jams', filter,
          layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'order'] },
          paint: {
            'line-color': casing,
            'line-width': width(null, [w[0] + 4, w[1] + 5]),
            'line-opacity': ['case', ['get', 'dim'], 0.35, 0.9],
          } },
        { id: `jams-line${suffix}`, type: 'line', source: 'jams', filter,
          layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'order'] },
          paint: {
            'line-gradient': gradient(f),
            'line-width': width(null, w),
            'line-opacity': ['case', ['get', 'dim'], 0.45, 1],
          } },
      ];
      const idle = ['!', ['get', 'selected']];
      const defs = [
        ...lineLayers('-moderate', ['all', idle, ['!', ['get', 'major']]], [5, 10], MODERATE),
        ...lineLayers('-major',    ['all', idle, ['get', 'major']],        [5, 10], MAJOR),
      ];
      // The selected jam: one casing, then its family's gradient.
      defs.push(
        { ...lineLayers('-sel', ['get', 'selected'], [7, 14], MAJOR)[0] },
        { ...lineLayers('-sel-moderate', ['all', ['get', 'selected'], ['!', ['get', 'major']]], [7, 14], MODERATE)[1] },
        { ...lineLayers('-sel-major',    ['all', ['get', 'selected'], ['get', 'major']],        [7, 14], MAJOR)[1] },
      );
      for (const d of defs) addUnderLabels(d);

      // Which way the traffic is going — see the arrow loop below.
      ctx.addSource('jam-arrows', { type: 'geojson', data: arrowData(performance.now()) });
      addUnderLabels({
        id: 'jams-arrows', type: 'symbol', source: 'jam-arrows',
        layout: {
          'icon-image': ARROW,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 15, 0.8],
          'icon-rotate': ['get', 'rot'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'symbol-sort-key': ['get', 'order'],
        },
        paint: {
          'icon-color': casing,
          'icon-opacity': ['case', ['get', 'dim'], 0.35, 0.95],
        },
      });
      layersAdded = true;
    } else {
      ctx.ml.getSource('jams')?.setData(data);
    }
    kickArrows();

    syncPins();
  }

  /* The platform's stateful marker — round with the rank while idle, the
     teardrop pin on the one selected — so this field behaves like every
     other selectable field in the library. `data-rank` asks the ctx to
     stack by rank instead of screen depth: #1 always on top. */
  function buildPins() {
    for (const m of pins.values()) ctx.removeMarker(m);
    pins = new Map();
    placedAt.clear();
    for (const j of top) {
      const el = createStatefulNumberPin(j.color, j.rank);
      el.classList.add('jam-mk');
      el.dataset.rank = String(j.rank);
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `Jam ${j.rank}: ${j.name}`);
      el.addEventListener('click', (e) => { e.stopPropagation(); select(j.id); });
      pins.set(j.id, ctx.addMarker({ element: el }, j.mid));
    }
    /* Context markers: small, flat and below every ranked marker (no
       z-index of their own, so the ranked ones — z 1…N — stack over). The
       icon says what it is; the tooltip names it. Not selectable: the
       board is about the jams. */
    for (const h of hazards) {
      const el = document.createElement('div');
      el.className = `jam-hz jam-hz--${h.type.kind}`;
      el.title = h.title;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', h.title);
      el.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">${h.type.svg}</svg>`;
      pins.set(h.id, ctx.addMarker({ element: el, anchor: 'center' }, h.pos));
    }
    if (extra) addExtraPin();
  }

  function addExtraPin() {
    const old = pins.get(extra.id);
    if (old) ctx.removeMarker(old);
    const el = createStatefulPin(extra.color, 'dot');
    el.classList.add('jam-mk');
    el.dataset.rank = '0';          // stacking: under the board, except while selected
    el.setAttribute('aria-label', extra.name);
    placedAt.delete(extra.id);
    pins.set(extra.id, ctx.addMarker({ element: el }, extra.mid));
  }

  function syncPins() {
    for (const [id, m] of pins) {
      const el = m.getElement();
      el.classList.toggle('is-selected', id === selectedId);
      el.classList.toggle('is-dim', !!selectedId && id !== selectedId);
    }
    ctx.restack();
    layoutPins();
  }

  /* ── Collision ────────────────────────────────────────────────────────
     Greedy placement in priority order — the selected jam, then #1 … #N.
     Each marker keeps the anchor it already had if that is still clear
     (so markers don't hop between frames), otherwise takes the first
     clear anchor along its own jam. If every anchor collides, it hides
     until zooming makes room; its line and its list row stay. */
  const placedAt = new Map();   // jam id → { i, dx, dy }
  /* Screen offsets tried when no point along the jam is clear — first
     straight above, fanning round, then one ring further out. */
  const OFFSETS = [44, 68].flatMap(r => [-90, -45, -135, 0, 180, 45, 135, 90]
    .map(a => [Math.round(r * Math.cos(a * Math.PI / 180)), Math.round(r * Math.sin(a * Math.PI / 180))]));
  let layoutFrame = null;

  function layoutPins() {
    layoutFrame = null;
    if (!pins.size) return;
    // Ranked jams claim space first; context markers take what is left.
    const order = [...(extra ? [extra] : []), ...top].sort((a, b) =>
      (b.id === selectedId) - (a.id === selectedId) || a.rank - b.rank).concat(hazards);
    const taken = [];   // { x, y, r }
    const clear = (c) => taken.every(t => Math.hypot(t.x - c.x, t.y - c.y) >= t.r + c.r + GAP);
    const footprint = (lngLat, selected) => {
      const p = ctx.ml.project(lngLat);
      return selected ? { x: p.x, y: p.y - PIN_LIFT, r: PIN_R } : { x: p.x, y: p.y, r: DOT_R };
    };
    const HZ_R = 12;

    for (const j of order) {
      const m = pins.get(j.id);
      if (!m) continue;
      const selected = j.id === selectedId;
      const prev = placedAt.get(j.id) || { i: 0, dx: 0, dy: 0 };
      const R = j.hazard ? HZ_R : DOT_R;
      const el = m.getElement();
      let pick = null;

      // 1. A clear point on the jam itself (the previous one first).
      const tries = [prev.i, ...j.anchors.keys()].filter((v, k, arr) => arr.indexOf(v) === k);
      for (const i of tries) {
        const c = { ...footprint(j.anchors[i], selected), ...(j.hazard ? { r: R } : {}) };
        if (selected || clear(c)) { pick = { i, dx: 0, dy: 0, fp: c }; break; }
      }
      // 2. Parallel carriageways leave no clear point: step the marker
      //    aside, with a leader back to its jam, rather than hide #2.
      if (!pick && !j.hazard) {
        const p = ctx.ml.project(j.anchors[prev.i] || j.anchors[0]);
        const prevOff = OFFSETS.findIndex(([dx, dy]) => dx === prev.dx && dy === prev.dy);
        const order2 = prevOff > 0 ? [OFFSETS[prevOff], ...OFFSETS] : OFFSETS;
        for (const [dx, dy] of order2) {
          const c = { x: p.x + dx, y: p.y + dy, r: DOT_R };
          if (clear(c)) { pick = { i: prev.i, dx, dy, fp: c }; break; }
        }
      }

      if (!pick) { el.classList.add('is-collided'); continue; }
      el.classList.remove('is-collided');
      taken.push(pick.fp);
      if (pick.i !== prev.i || !placedAt.has(j.id)) m.setLngLat(j.anchors[pick.i]);
      if (pick.dx !== prev.dx || pick.dy !== prev.dy || !placedAt.has(j.id)) {
        m.setOffset([pick.dx, pick.dy]);
        setLeader(el, pick.dx, pick.dy);
      }
      placedAt.set(j.id, { i: pick.i, dx: pick.dx, dy: pick.dy });
    }
  }

  /* A hairline from a stepped-aside marker back to the point on its jam.
     It lives inside the marker's zero-size root, so it moves with it. */
  function setLeader(el, dx, dy) {
    let lead = el.querySelector('.jam-leader');
    if (!dx && !dy) { lead?.remove(); return; }
    if (!lead) {
      lead = document.createElement('span');
      lead.className = 'jam-leader';
      el.prepend(lead);
    }
    const len = Math.hypot(dx, dy) - DOT_R;
    lead.style.width = `${Math.max(0, len)}px`;
    lead.style.transform = `rotate(${Math.atan2(-dy, -dx)}rad) translateX(${DOT_R}px)`;
  }

  const scheduleLayout = () => {
    if (layoutFrame == null) layoutFrame = requestAnimationFrame(layoutPins);
  };
  ctx.on('move', scheduleLayout);
  ctx.onTeardown(() => { if (layoutFrame != null) cancelAnimationFrame(layoutFrame); });

  /* ── Camera ───────────────────────────────────────────────────────── */

  /* Live, the card is a lower third across the bottom, not a right-hand
     rail, so safeInsets() (which reserves the rail) frames the jam in the
     wrong place. Measure the card and keep the jam above it. */
  function airPadding() {
    const host = document.getElementById('map-side');
    const h = host && !host.hidden ? host.getBoundingClientRect().height : 0;
    const bottom = Math.min(Math.round(window.innerHeight * 0.55), Math.round(h) + 72);
    // +52 on top: the selected pin stands above its coordinate.
    return { top: 72 + 52, right: 72, bottom, left: 72 };
  }

  /* Phones: the map is the strip between the topbar and the card that
     rides on the drawer. The shared insets reserve 48 px for a teardrop
     pin above every point, which on a 375 px screen leaves too little
     strip to frame a city in (it fell back to zoom 8). Reserve only what
     this layer draws: an 18 px dot, or the selected pin's 52 px. */
  function phonePadding(pinLift) {
    const vh = window.innerHeight;
    const bar = document.querySelector('.topbar')?.getBoundingClientRect();
    const covers = ['map-side', 'panel-detail']
      .map(id => document.getElementById(id))
      .filter(el => el && !el.hidden && el.getBoundingClientRect().height > 0)
      .map(el => el.getBoundingClientRect().top);
    const coverTop = covers.length ? Math.min(...covers) : vh;
    return {
      top: Math.round((bar?.bottom ?? 64) + 12 + pinLift),
      bottom: Math.round(vh - coverTop + 12 + 18),
      left: 24, right: 72,
    };
  }
  const isPhone = () => window.innerWidth <= 720;

  /* On air the camera move IS the transition the viewer watches while
     the presenter starts talking, so it takes its time: a slow flight
     with a gentle zoom-out arc, instead of the library's snappy 900 ms. */
  const AIR_FLIGHT = { duration: 2600, curve: 1.2, easing: t => 1 - Math.pow(1 - t, 3) };

  function frameJam(j) {
    const opts = { duration: 900, maxZoom: 15.5 };
    if (onAirWanted) Object.assign(opts, AIR_FLIGHT, { padding: airPadding() });
    else if (isPhone()) opts.padding = phonePadding(52);
    ctx.fitBounds(j.bounds, opts);
  }

  const topBounds = () => top.reduce((acc, j) => [
    [Math.min(acc[0][0], j.bounds[0][0]), Math.min(acc[0][1], j.bounds[0][1])],
    [Math.max(acc[1][0], j.bounds[1][0]), Math.max(acc[1][1], j.bounds[1][1])],
  ], [[Infinity, Infinity], [-Infinity, -Infinity]]);

  function frameAll() {
    if (!top.length) return;
    const b = topBounds();
    const opts = { duration: 900, maxZoom: 14 };
    if (onAirWanted) Object.assign(opts, AIR_FLIGHT, { padding: airPadding() });
    else if (isPhone()) opts.padding = phonePadding(18);
    ctx.fitBounds(b, opts);
  }

  /* ── Panel ────────────────────────────────────────────────────────── */

  /* Every number appears once per view. The data source lives in Tools &
     APIs, the refresh interval in Configure and the colour key in the
     legend, so none of them is repeated in the card. Colour marks the
     marker only: coral and saffron text on a light surface fail contrast
     (3.2:1 and 2.2:1), the dark label inside the marker passes (≥ 5.2:1). */

  function agoText() {
    if (!updatedAt) return 'Loading';
    const s = Math.round((Date.now() - updatedAt) / 1000);
    if (s < 45) return 'Updated just now';
    return `Updated ${Math.round(s / 60)} min ago`;
  }

  const ICON_PREV = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" d="m15 6-6 6 6 6"/></svg>';
  const ICON_NEXT = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6"/></svg>';
  const ICON_CLOSE = '<svg width="12" height="12" viewBox="0 0 7 7" aria-hidden="true"><path fill="currentColor" d="M4.44593 3.49999L6.99997 6.05403L6.05403 6.99997L3.49999 4.44593L0.945943 6.99997L1.53095e-06 6.05403L2.55404 3.49999L0 0.945942L0.945942 0L3.49999 2.55404L6.05403 0L6.99997 0.945942L4.44593 3.49999Z"/></svg>';

  /* LIVE is a status, not a control: the pulsing badge says the data is
     real-time, and its tooltip says how fresh (kept current by the tick
     below). The broadcast view has its own icon button, in the same
     round style as the card's close and step buttons. */
  const ICON_EXPAND = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  const liveBadge = () =>
    `<span class="jam-live-badge" tabindex="0" data-ago-title title="${escapeHtml(agoText())}" aria-label="Live data, ${escapeHtml(agoText().toLowerCase())}">Live</span>`;
  const fullscreenBtn = () =>
    `<button class="jam-icon-btn" type="button" data-live="1" title="Full-screen broadcast view · ← → switch jams · Esc exits" aria-label="Full-screen broadcast view">${ICON_EXPAND}</button>`;

  // `short` is the label a phone shows, where "Avg speed" would be cut.
  const stat = (label, value, unit, cap, short) => `
      <div class="jam-stat">
        <span class="jam-stat-label">${short
          ? `<span class="jam-l-full">${label}</span><span class="jam-l-short">${short}</span>` : label}</span>
        <span class="jam-stat-value">${value}${unit ? `<span class="jam-stat-unit">${unit}</span>` : ''}</span>
        ${cap ? `<span class="jam-stat-cap">${cap}</span>` : ''}
      </div>`;

  const statsHtml = j => `
    <div class="jam-stats">
      ${j.speed == null
        ? stat('Avg speed', '—', '', '', 'Speed')
        : stat('Avg speed', Math.round(j.speed), 'km/h', j.freeFlow ? `free-flow ${Math.round(j.freeFlow)}` : '', 'Speed')}
      ${stat('Length', fmtLength(j.length), lengthUnit(j.length))}
      ${stat('Delay', `+${fmtDelayMin(j.delay)}`, 'min')}
    </div>`;

  const roadChips = j => j.roadNumbers
    .filter(r => r !== j.name).slice(0, 2)
    .map(r => `<span class="jam-road">${escapeHtml(r)}</span>`).join('');

  const fromToText = j => (j.from || j.to) ? `${j.from || '…'} → ${j.to || '…'}` : '';
  const fromTo = j => fitText(fromToText(j));

  /* A name that shortens itself instead of being cut: the full text, plus
     its abbreviated form for fitNames() to swap in when it overflows.
     The full name stays in the tooltip and for screen readers. */
  function fitText(text) {
    if (!text) return '';
    const short = abbreviate(text);
    const attrs = short !== text ? ` data-short="${escapeHtml(short)}"` : '';
    return `<span class="jam-fit" title="${escapeHtml(text)}"${attrs}>${escapeHtml(text)}</span>`;
  }

  /* After render: any fitted name that overflows its box takes its short
     form. Live, a name still too long after that is allowed a second line
     (.is-wrapped) — on air a cut-off road name is worse than two lines. */
  function fitNames() {
    const host = document.getElementById('map-side');
    if (!host) return;
    for (const el of host.querySelectorAll('.jam-fit')) {
      const box = el.closest('.jam-row-name, .jam-air-name, .jam-air-sub, .jam-card-sub') || el;
      const over = () => box.scrollWidth > box.clientWidth + 1;
      if (over() && el.dataset.short) el.textContent = el.dataset.short;
      if (onAirWanted && over() && box.matches('.jam-air-name, .jam-air-sub')) box.classList.add('is-wrapped');
    }
  }

  function totalQueueKm() {
    return Math.round(all.reduce((s, j) => s + (j.properties.length || 0), 0) / 1000);
  }

  function renderList() {
    const rows = top.map(j => `
      <button class="jam-row" type="button" data-jam="${escapeHtml(j.id)}">
        <span class="jam-row-n" style="--jam:${j.color}">${j.rank}</span>
        <span class="jam-row-main">
          <span class="jam-row-name">${fitText(j.name)}</span>
          <span class="jam-row-sub">${fmtLength(j.length)} ${lengthUnit(j.length)}${j.area ? ` · ${escapeHtml(j.area)}` : ''}</span>
        </span>
        <span class="jam-row-delay">+${fmtDelayMin(j.delay)}<span class="jam-row-unit">min</span></span>
      </button>`).join('');

    ctx.setSidePanel(`
      <div class="jam-card">
        <div class="jam-card-head">
          <div class="jam-title-row">
            <div class="jam-city">
              <span class="jam-card-title">${escapeHtml(city.label)}</span>
              ${liveBadge()}
            </div>
            ${top.length ? fullscreenBtn() : ''}
          </div>
          <div class="jam-card-sub">${all.length} jams · ${totalQueueKm()} km of queues</div>
        </div>
        <div class="jam-list">${rows || '<div class="jam-note">No jams right now. Traffic is flowing.</div>'}</div>
      </div>`);
  }

  /* Stats for a road with no reported jam: what the flow tile knows. */
  const flowStatsHtml = j => `
    <div class="jam-stats">
      ${stat('Speed now', Math.round(j.speed), 'km/h', '', 'Speed')}
      ${j.freeFlow ? stat('Free-flow', Math.round(j.freeFlow), 'km/h') : ''}
      ${j.freeFlow ? stat('Of normal', Math.round((j.speed / j.freeFlow) * 100), '%') : ''}
    </div>`;
  const extraEyebrow = j => j.kind === 'jam'
    ? (j.rank ? `#${j.rank} · outside the top ${top.length}` : 'Reported jam')
    : j.kind === 'closed' ? 'Road closed · no traffic allowed'
    : `${j.event} · not reported as a jam`;
  const closedStatsHtml = j => j.length
    ? `<div class="jam-stats">${stat('Closed for', fmtLength(j.length), lengthUnit(j.length))}</div>` : '';
  const extraStats = j => j.kind === 'jam' ? statsHtml(j) : j.kind === 'closed' ? closedStatsHtml(j) : flowStatsHtml(j);

  function renderDetail(j) {
    if (j.extra) {
      ctx.setSidePanel(`
      <div class="jam-card">
        <div class="jam-card-head">
          <div class="jam-title-row">
            <div class="jam-card-eyebrow">${escapeHtml(extraEyebrow(j))}</div>
            <button class="jam-icon-btn" type="button" data-back="1" aria-label="Close — back to the ${escapeHtml(city.label)} ranking">${ICON_CLOSE}</button>
          </div>
          <div class="jam-card-title">${escapeHtml(j.name)} ${roadChips(j)}</div>
          ${fromTo(j) ? `<div class="jam-card-sub">${fromTo(j)}</div>` : ''}
        </div>
        ${extraStats(j) ? `<div class="jam-sect">${extraStats(j)}</div>` : ''}
      </div>`);
      return;
    }
    ctx.setSidePanel(`
      <div class="jam-card">
        <div class="jam-card-head">
          <div class="jam-title-row">
            <div class="jam-card-eyebrow">${escapeHtml(j.event)} traffic</div>
            <button class="jam-icon-btn" type="button" data-back="1" aria-label="Close — back to the ${escapeHtml(city.label)} ranking">${ICON_CLOSE}</button>
          </div>
          <div class="jam-card-title">${escapeHtml(j.name)} ${roadChips(j)}</div>
          ${fromTo(j) ? `<div class="jam-card-sub">${fromTo(j)}</div>` : ''}
        </div>
        <div class="jam-sect">${statsHtml(j)}</div>
        <div class="jam-nav">
          <button class="jam-icon-btn" type="button" data-step="-1" aria-label="Previous jam" ${j.rank === 1 ? 'disabled' : ''}>${ICON_PREV}</button>
          <span class="jam-nav-pos">${j.rank} of ${top.length}</span>
          <button class="jam-icon-btn" type="button" data-step="1" aria-label="Next jam" ${j.rank === top.length ? 'disabled' : ''}>${ICON_NEXT}</button>
        </div>
      </div>`);
  }

  /* The lower third. Everything a presenter reads, nothing they'd have
     to explain: rank, road, cross streets, three numbers. */
  /* The lower third. Everything a presenter reads, nothing they'd have
     to explain: rank, road, cross streets, three numbers — and, for a
     presenter on a touch screen, the same step / overview controls the
     clicker drives, so moving between jams never means leaving live. */
  const ICON_OVERVIEW = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>';

  function airControls(j) {
    const pos = j ? `${j.rank} of ${top.length}` : 'Overview';
    return `
      <div class="jam-air-ctrl">
        <button class="jam-icon-btn" type="button" data-step="-1" aria-label="${j && j.rank === 1 ? 'Overview' : 'Previous jam'}" ${j ? '' : 'disabled'}>${ICON_PREV}</button>
        <span class="jam-nav-pos">${pos}</span>
        <button class="jam-icon-btn" type="button" data-step="1" aria-label="Next jam" ${j && j.rank === top.length ? 'disabled' : ''}>${ICON_NEXT}</button>
        <button class="jam-icon-btn" type="button" data-back="1" aria-label="Overview of ${escapeHtml(city.label)}" ${j ? '' : 'disabled'}>${ICON_OVERVIEW}</button>
        <button class="jam-icon-btn" type="button" data-exit="1" aria-label="Exit live view">${ICON_CLOSE}</button>
      </div>`;
  }

  /* The headline a presenter opens on, written from the data — Waze's
     "Heavy delays · Paulista: slow traffic". Level from how much of the
     city is queueing; line from the worst jam on the board. There is no
     "as usual" half: that needs a typical-for-this-hour baseline, which
     only the enterprise Traffic Stats product has. Thresholds are a
     reading aid, not a TomTom index. */
  function headline() {
    const km = totalQueueKm();
    const majors = all.filter(j => (j.properties.magnitudeOfDelay ?? 0) >= 3).length;
    const level = km >= 100 || majors >= 50 ? 'Heavy delays'
      : km >= 30 || majors >= 15 ? 'Delays building'
      : 'Traffic mostly moving';
    const w = top[0];
    return { level, line: w ? `${w.name}: ${w.event.toLowerCase()} traffic` : '' };
  }

  function renderAir(j) {
    if (j?.extra) {
      ctx.setSidePanel(`
      <div class="jam-air" style="--jam:${j.color}">
        ${j.rank ? `<div class="jam-air-rank" aria-label="Rank ${j.rank}">${j.rank}</div>` : ''}
        <div class="jam-air-main">
          <div class="jam-air-eyebrow"><span class="jam-live">Live</span><span class="jam-air-eyebrow-text">${escapeHtml(city.label)} · ${escapeHtml(extraEyebrow(j))}</span></div>
          <div class="jam-air-title"><span class="jam-air-name">${fitText(j.name)}</span>${roadChips(j)}</div>
          ${fromTo(j) ? `<div class="jam-air-sub">${fromTo(j)}</div>` : ''}
        </div>
        ${extraStats(j)}
        ${airControls(null)}
      </div>`);
      return;
    }
    if (!top.length) {
      ctx.setSidePanel(`
        <div class="jam-air">
          <div class="jam-air-main">
            <div class="jam-air-eyebrow"><span class="jam-live">Live</span>${escapeHtml(city.label)}</div>
            <div class="jam-air-title">Traffic is flowing</div>
          </div>
          ${airControls(null)}
        </div>`);
      return;
    }
    if (!j) {
      // Overview — the segment's opening shot: the city and its totals.
      const worst = top.reduce((m, x) => Math.max(m, x.delay || 0), 0);
      const h = headline();
      ctx.setSidePanel(`
        <div class="jam-air">
          <div class="jam-air-main">
            <div class="jam-air-eyebrow"><span class="jam-live">Live</span><span class="jam-air-eyebrow-text">${escapeHtml(city.label)} · top ${top.length} by ${escapeHtml(rankBy.label)}</span></div>
            <div class="jam-air-title"><span class="jam-air-name">${escapeHtml(h.level)}</span></div>
            <div class="jam-air-sub">${fitText(h.line)}</div>
          </div>
          <div class="jam-stats">
            ${stat('Jams', all.length)}
            ${stat('Queues', totalQueueKm(), 'km')}
            ${stat('Worst delay', `+${fmtDelayMin(worst)}`, 'min', '', 'Worst')}
          </div>
          ${airControls(null)}
        </div>`);
      return;
    }
    ctx.setSidePanel(`
      <div class="jam-air" style="--jam:${j.color}">
        <div class="jam-air-rank" aria-label="Rank ${j.rank} of ${top.length}">${j.rank}</div>
        <div class="jam-air-main">
          <div class="jam-air-eyebrow"><span class="jam-live">Live</span><span class="jam-air-eyebrow-text">${escapeHtml(city.label)} · ${escapeHtml(j.event)} traffic</span></div>
          <div class="jam-air-title"><span class="jam-air-name">${fitText(j.name)}</span>${roadChips(j)}</div>
          ${fromTo(j) ? `<div class="jam-air-sub">${fromTo(j)}</div>` : ''}
        </div>
        ${statsHtml(j)}
        ${airControls(j)}
      </div>`);
  }

  function render() {
    const j = current();
    if (onAirWanted) renderAir(j);
    else if (j) renderDetail(j);
    else renderList();
    // Measure once the new card is laid out (fonts included).
    requestAnimationFrame(fitNames);
  }

  /* ── Selection ────────────────────────────────────────────────────── */

  function select(id, { fly = true } = {}) {
    const j = byId(id);
    if (!j) return;
    if (!String(id).match(/^[xfc]:/)) explainToken++;   // a pending road tap loses to this pick
    if (extra && id !== extra.id) dropExtra();
    selectedId = id;
    lastSelection = { cityKey: city.key, id };
    draw();
    render();
    if (fly) frameJam(j);
  }

  function clearSelection() {
    explainToken++;
    dropExtra();
    selectedId = null;
    lastSelection = null;
    draw();
    render();
    frameAll();
  }

  /* Live, the ranking has a position 0 — the overview — so a clicker
     can walk overview → #1 … #N and back. Off air, ← stops at #1. */
  function step(dir) {
    if (!top.length) return;
    const i = top.findIndex(j => j.id === selectedId);
    // Live, ← from #1 — or from a road tapped off the board — is the overview.
    if (onAirWanted && dir < 0 && i <= 0) return clearSelection();
    const next = i < 0 ? 0 : Math.min(top.length - 1, Math.max(0, i + dir));
    if (top[next].id !== selectedId) select(top[next].id);
  }

  /* ── Live view ────────────────────────────────────────────────────── */

  const root = document.documentElement;

  function applyAirClass() {
    root.classList.toggle('is-on-air', onAirWanted);
    // The map container changes size in the split layout; tell MapLibre.
    requestAnimationFrame(() => { try { ctx.ml.resize(); } catch {} });
  }

  function enterAir() {
    onAirWanted = true;
    applyAirClass();
    try {
      if (!document.fullscreenElement) root.requestFullscreen?.().catch(() => {});
    } catch {}
    // A selected jam carries over; otherwise live opens on the overview.
    draw();
    render();
    // Wait a frame so the lower third has a height to frame around.
    requestAnimationFrame(() => { const j = current(); if (j) frameJam(j); else frameAll(); });
  }

  function exitAir() {
    onAirWanted = false;
    applyAirClass();
    try { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); } catch {}
    render();
    const j = current();
    requestAnimationFrame(() => (j ? frameJam(j) : frameAll()));
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  const side = document.getElementById('map-side');
  const onSideClick = (e) => {
    const t = e.target.closest?.('[data-jam],[data-back],[data-step],[data-live],[data-exit]');
    if (!t) return;
    if (t.dataset.jam)    return select(t.dataset.jam);
    if (t.dataset.back)   return clearSelection();
    if (t.dataset.step)   return step(Number(t.dataset.step));
    if (t.dataset.live)   return enterAir();
    if (t.dataset.exit)   return exitAir();
  };
  side?.addEventListener('click', onSideClick);

  const onKey = (e) => {
    if (!onAirWanted) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ') { e.preventDefault(); e.stopPropagation(); step(1); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp')             { e.preventDefault(); e.stopPropagation(); step(-1); }
    else if (k === 'Home') { e.preventDefault(); e.stopPropagation(); if (selectedId) clearSelection(); }
    else if (k === 'Escape') { e.preventDefault(); exitAir(); }
  };
  document.addEventListener('keydown', onKey, true);

  // Esc in browser full screen exits full screen without a keydown; the
  // presenter meant "leave live view", so follow it.
  const onFullscreen = () => { if (!document.fullscreenElement && onAirWanted) exitAir(); };
  document.addEventListener('fullscreenchange', onFullscreen);

  // Casings are the widest layer of each jam, so they are the hit target.
  for (const id of ['jams-casing-moderate', 'jams-casing-major', 'jams-casing-sel']) {
    ctx.on('click', id, (e) => {
      const jam = e.features?.[0]?.properties?.id;
      if (jam) select(jam);
    });
    ctx.on('mouseenter', id, () => { ctx.ml.getCanvas().style.cursor = 'pointer'; });
    ctx.on('mouseleave', id, () => { ctx.ml.getCanvas().style.cursor = ''; });
  }

  /* Tapping empty map closes the selection — the way back to the ranking
     on a phone, where the card is small and the map is the big target.
     Marker taps never reach here (markers sit outside the canvas); a tap
     on a jam line is handled by the layer listeners above. */
  const JAM_HIT_LAYERS = ['jams-casing-moderate', 'jams-casing-major', 'jams-casing-sel'];
  ctx.on('click', (e) => {
    const layers = JAM_HIT_LAYERS.filter(id => ctx.ml.getLayer(id));
    if (ctx.ml.queryRenderedFeatures(e.point, { layers }).length) return;
    const pad = 6;
    const roadLayers = ['jams-arterials', 'jams-arterials-closed'].filter(id => ctx.ml.getLayer(id));
    const onRoad = roadLayers.length && ctx.ml.queryRenderedFeatures(
      [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers: roadLayers }).length;
    if (onRoad) { explainRoad(e); return; }
    if (selectedId) clearSelection();
  });

  /* ── Why is this road red? ───────────────────────────────────────────
     The arterial layer paints every main road by live speed, so a reader
     sees red the board doesn't list and asks why. A tap answers it:
       - a reported jam below the cut → its rank, delay, length, speed;
       - one that IS on the board → just selects it;
       - no jam reported → the flow speed, labelled as unreported.
     Measured over São Paulo: of 12 stopped arterial stretches near the
     board, 2 were board jams, 7 jams ranked #11+, 3 had no incident. */
  const JAM_MATCH_M = 60;

  function dropExtra() {
    if (!extra) return;
    const m = pins.get(extra.id);
    if (m) { ctx.removeMarker(m); pins.delete(extra.id); }
    placedAt.delete(extra.id);
    extra = null;
    ctx.ml.getSource('jam-extra')?.setData({ type: 'FeatureCollection', features: [] });
  }

  /* The tapped road's highlight: the board's casing + gradient, on its
     own source so it never joins the ranking. Under the arrows. */
  function drawExtra() {
    const data = { type: 'FeatureCollection', features: [{
      type: 'Feature', geometry: { type: 'LineString', coordinates: extra.coords }, properties: {} }] };
    const fam = extra.fam;
    // Under the arrows when they exist (a tap can land before the board
    // has drawn); on top otherwise.
    const below = ctx.ml.getLayer('jams-arrows') ? 'jams-arrows'
      : ctx.ml.getLayer(LABEL_ANCHOR) ? LABEL_ANCHOR : undefined;
    if (!ctx.ml.getLayer('jam-extra-line')) {
      ctx.addSource('jam-extra', { type: 'geojson', data, lineMetrics: true });
      ctx.addLayer({ id: 'jam-extra-casing', type: 'line', source: 'jam-extra',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': casing, 'line-width': width(null, [11, 19]), 'line-opacity': 0.9 } }, below);
      ctx.addLayer({ id: 'jam-extra-line', type: 'line', source: 'jam-extra',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-gradient': gradient(fam), 'line-width': width(null, [7, 14]) } }, below);
    } else {
      ctx.ml.getSource('jam-extra').setData(data);
      ctx.ml.setPaintProperty('jam-extra-line', 'line-gradient', gradient(fam));
    }
  }

  function showExtra(x) {
    dropExtra();
    extra = x;
    selectedId = x.id;
    lastSelection = null;
    addExtraPin();
    drawExtra();
    draw();
    render();
    frameJam(x);
  }

  async function explainRoad(e) {
    if (!ctx.ml.getLayer('jams-arterials')) return false;
    const pad = 6;
    const box = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
    const layers = ['jams-arterials-closed', 'jams-arterials'].filter(id => ctx.ml.getLayer(id));
    const seg = ctx.ml.queryRenderedFeatures(box, { layers })[0];
    if (!seg) return false;
    const at = [e.lngLat.lng, e.lngLat.lat];
    const token = ++explainToken;

    // A closed road: say so, with the closure TomTom reports there.
    if (seg.properties.road_closure) {
      let inc = null, bestD = 150;
      for (const c of closures) {
        const gt = c.geometry.type;
        if (gt !== 'Point' && gt !== 'LineString') continue;
        const pts = gt === 'Point' ? [c.geometry.coordinates] : c.geometry.coordinates;
        for (const pt of pts) { const d = haversine(at, pt); if (d < bestD) { bestD = d; inc = c; } }
      }
      const g = inc?.geometry || seg.geometry;
      const coords = g.type === 'LineString' ? g.coordinates : g.type === 'Point' ? [g.coordinates, g.coordinates] : g.coordinates?.[0];
      const place = await reverseGeocode({ point: at }).catch(() => null);
      if (token !== explainToken || ctx.cancelled) return true;
      const closedColor = markFor(pal.stop);
      showExtra({
        id: `c:${inc?.properties?.id || at.map(v => v.toFixed(5)).join(',')}`, extra: true, kind: 'closed',
        rank: null, coords, mid: at, anchors: [at], cum: cumulative(coords), bounds: bboxOfLine(coords),
        color: closedColor, fam: { from: pal.stop, to: pal.stop },
        name: place?.streetName || inc?.properties?.roadNumbers?.[0] || 'Main road',
        from: inc?.properties?.from, to: inc?.properties?.to, roadNumbers: inc?.properties?.roadNumbers || [],
        event: 'Road closed', length: inc?.properties?.length || 0,
      });
      return true;
    }

    // The reported jam under the tap, if any.
    let jam = null, best = JAM_MATCH_M;
    for (const j of all) {
      for (const c of j.geometry.coordinates) {
        const d = haversine(at, c);
        if (d < best) { best = d; jam = j; }
      }
    }
    if (jam && top.some(t => t.id === jam.properties.id)) { select(jam.properties.id); return true; }

    if (jam) {
      const x = await enrich(jam, rankOf.get(jam.properties.id) || null, Math.max(30_000, refreshSec * 1000 - 5_000));
      if (token !== explainToken || ctx.cancelled) return true;
      showExtra({ ...x, id: `x:${x.id}`, extra: true, kind: 'jam', fam: familyOf(x.magnitude) });
      return true;
    }

    // No jam reported here: describe the flow segment itself.
    const rs = Number(seg.properties.relative_speed);
    const abs = Number(seg.properties.absolute_speed);
    const g = seg.geometry;
    const coords = g.type === 'LineString' ? g.coordinates : g.coordinates?.[0];
    if (!coords?.length || !Number.isFinite(abs)) return false;
    const band = rs < 0.15 ? ['Stopped traffic', pal.stop] : rs < 0.35 ? ['Queueing traffic', pal.queue]
      : rs < 0.75 ? ['Slow traffic', pal.slow] : ['Traffic flowing', pal.free];
    const place = await reverseGeocode({ point: at }).catch(() => null);
    if (token !== explainToken || ctx.cancelled) return true;
    showExtra({
      id: `f:${at.map(v => v.toFixed(5)).join(',')}`, extra: true, kind: 'flow',
      rank: null, coords, mid: at, anchors: [at], cum: cumulative(coords), bounds: bboxOfLine(coords),
      color: markFor(band[1]), fam: { from: band[1], to: band[1] },
      name: place?.streetName || 'Main road', area: place?.municipalitySubdivision || null,
      roadNumbers: [], event: band[0],
      speed: abs, freeFlow: rs > 0 ? abs / rs : null,
    });
    return true;
  }

  const tick = setInterval(() => {
    for (const el of side?.querySelectorAll('[data-ago-title]') || []) {
      el.title = agoText();
      el.setAttribute('aria-label', `Live data, ${agoText().toLowerCase()}`);
    }
  }, 15_000);

  const refreshTimer = setInterval(async () => {
    if (ctx.cancelled || refreshing) return;
    refreshing = true;
    const prevRank = current()?.rank;
    try {
      await load();
    } catch (err) {
      console.warn('[traffic] refresh', err.message);
    } finally {
      refreshing = false;
    }
    if (ctx.cancelled) return;
    // Keep the jam the presenter is on. If it cleared, hold the same rank
    // — the card should never go blank mid-sentence.
    let flyTo = false;
    // A jam tapped off the board that has now joined it: use the board's.
    if (extra?.kind === 'jam') {
      const joined = top.find(t => `x:${t.id}` === extra.id);
      if (joined) { dropExtra(); selectedId = joined.id; }
    }
    if (selectedId && !byId(selectedId)) {
      const replacement = top[Math.min((prevRank || 1), top.length) - 1];
      selectedId = replacement?.id ?? null;
      lastSelection = selectedId ? { cityKey: city.key, id: selectedId } : null;
      flyTo = !!replacement;
    }
    buildPins();
    draw();
    render();
    renderLegend();
    if (flyTo) frameJam(current());
  }, refreshSec * 1000);

  ctx.onTeardown(() => {
    clearInterval(tick);
    clearInterval(refreshTimer);
    side?.removeEventListener('click', onSideClick);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('fullscreenchange', onFullscreen);
    // Leaving live view is handled by the hook registered at the top.
  });

  /* ── Boot ─────────────────────────────────────────────────────────── */

  ctx.setSidePanel(`
    <div class="jam-card">
      <div class="jam-card-head">
        <div class="jam-card-eyebrow">Live traffic</div>
        <div class="jam-card-title"><span class="jam-spinner" aria-hidden="true"></span>Finding jams in ${escapeHtml(city.label)}…</div>
      </div>
    </div>`);

  try {
    await load();
  } catch (err) {
    if (ctx.cancelled) return;
    console.warn('[traffic]', err.message);
    ctx.setSidePanel(`
      <div class="jam-card">
        <div class="jam-card-head">
          <div class="jam-card-eyebrow">Live traffic</div>
          <div class="jam-card-title">Traffic data unavailable</div>
          <div class="jam-card-sub">The Traffic Incidents request failed. Try again in a moment.</div>
        </div>
      </div>`);
    return;
  }
  if (ctx.cancelled) return;

  // Restore the jam a presenter was on before a theme / basemap replay.
  if (lastSelection?.cityKey === city.key && byId(lastSelection.id)) selectedId = lastSelection.id;
  else lastSelection = null;

  applyAirClass();
  buildPins();
  draw();
  render();

  function renderLegend() {
  if (!top.length) { ctx.setLegend({ items: [] }); return; }
  const kinds = [...new Map(hazards.map(h => [h.type.kind, h.type])).values()];
  ctx.setLegend({
    title: 'Jams',
    items: [
      // Markers run dark → light down the ranking; the line gradients keep
      // the style's own reading of each jam's severity.
      { gradient: [rankColor(1, top.length), rankColor(top.length, top.length)], label: `#1 → #${top.length || 10}` },
      { gradient: [MODERATE.from, MAJOR.to], label: 'Slow → stopped' },
      ...kinds.map(t => ({
        html: `<span class="jam-hz jam-hz--${t.kind} jam-hz--legend" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">${t.svg}</svg></span>`,
        label: t.label,
      })),
    ],
  });
  }
  renderLegend();

  // Recenter returns to the whole ranking, not the raw city bbox.
  if (top.length) ctx.markHomeBounds(topBounds(), { duration: 900, maxZoom: 14 });
  const sel = current();
  if (sel) frameJam(sel);
  else frameAll();
}
