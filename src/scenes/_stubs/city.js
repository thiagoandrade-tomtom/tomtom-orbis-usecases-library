/* Neighbourhood analysis — compare every area of a city on one metric.

   The comparison is the product. A single-area card can only say "this
   area is good"; a city of areas, coloured and ranked together, says
   which is better — which is the question a planner, an insurer or a
   site-selection team actually asks.

   HOW IT WORKS
     1. Sweep an 8×8 grid of reverse-geocode lookups at Neighbourhood
        level and dedupe by boundaryId. There is no "list the children of
        this municipality" endpoint, so enumeration has to be sampled.
        Yield is high: 57 distinct quartiers over Paris, 49 over
        Amsterdam. Where the Neighbourhood level is sparse (Berlin) the
        sweep drops a level and picks up Kreuzberg / Mitte / Neukölln.
     2. Fetch every boundary, drop anything too big to be a neighbourhood.
     3. Score each area on the ACTIVE LENS only — nothing else is fetched.
     4. Colour the polygons on a ramp across the areas on screen, put the
        number on each, and rank them in the side panel.
     5. Clicking an area re-measures that one properly and plots the
        establishments behind the number on the map.

   THE LENS IS THE FILTER
   `metric` picks one question at a time — walk to essentials, road speed
   exposure, live congestion — and that metric is all the map and the
   panel show. Each lens reorders the city almost completely: measured
   over 18 Paris areas, no two lenses agreed on more than 1 of 18 ranks.

   WHAT WE MEASURE, AND FOUR THINGS THAT DIDN'T WORK
   Every one of these looked authoritative and was not. They are recorded
   because each is an easy mistake to make again:

     1. "How many essentials are inside a 1.2 km circle, vs a threshold."
        The counts saturated the API's own `limit` — schools showed 50/50
        in every urban area, transit 100/100, cafés 100/100 — so the tile
        displayed a request parameter, not a measurement. Across nine
        areas only healthcare ever varied, which made a five-star
        walkability rating into "how many pharmacies are nearby".
     2. Straight-line distance. Never saturates, but a crow-flies metre
        is not a walk: routing the same 582 m hop in Midtown gives 702 m
        and 8 minutes, because rivers and rail cuts are real. Kept for the
        overview, where it is cheap and labelled; a click routes it.
     3. A live INCIDENT COUNT as "traffic exposure". Midtown returned 45
        incidents of which exactly one was a jam — the rest road closures
        and long-running works, none carrying a delay value. The card read
        alarming over a street grid running at 98% of free-flow. Replaced
        by the flow ratio, which is derived from the same data the basemap
        paints, so the number and the map cannot disagree.
     4. A city-wide POI cloud, to score areas without a call each. Five
        anchor searches cap out near 100 points per essential, which
        cannot describe a city of thousands of cafés: areas between
        anchors scored zero, including Gros Caillou in the 7th
        arrondissement. Each area searches around its own centre instead.

   And one that needed the metric changed rather than the data: once the
   search radius was wide enough to find everything, "N of 6 within 15
   minutes" came out identical for all 18 Paris areas. The lens ranks on
   MEAN WALK MINUTES, which stays continuous; the card keeps N-of-6 as the
   human verdict.

   The enterprise products TomTom's insurtech and government pages lead
   with — Traffic Stats, Historical Traffic Volumes, Area Analytics,
   Origin-Destination Analysis — are all 403 on a self-serve key, as is
   Routing's Reachable Range. Everything here runs on Admin Boundaries,
   Places, Routing and Traffic Flow.

   The panel is the right rail, not a map popup: a card holding a ranked
   city would blanket the very polygons it describes.

   Restyle: the polygon outline colour / width are exposed below; the fill
   is driven by the lens ramp, so the fill picker no longer applies. */

import {
  geocode, fetchBoundary, nearbySearch, poiSearch, reverseGeocode,
  calculateRoute, flowSegment,
} from '../../map/services.js';
import { paramFor } from '../../state.js';
import { areaParams } from '../_shared.js';

/* Admin levels we try for the clicked area, finest first. Whichever comes
   back with a boundary wins — so a click in NYC scores "Midtown South"
   (walk-scale) rather than the "Manhattan" borough, while a click in Tokyo,
   where neither finer level is mapped, still resolves at Municipality.
   `field` is the matching key on a plain reverse geocode: if that response
   didn't name the level, the level doesn't exist here and we skip the call. */
const AREA_LEVELS = [
  { entityType: 'Neighbourhood',           field: 'neighbourhood' },
  { entityType: 'MunicipalitySubdivision', field: 'municipalitySubdivision' },
  { entityType: 'Municipality',            field: 'municipality' },
];

/* The six daily-life essentials.

   `limit` is 20, not the 100 this scene used to ask for: Search returns
   results sorted by `dist` and we read the nearest acceptable one, so a
   big page was pure waste — and it was the source of the saturated counts
   the card used to display. 20 leaves headroom for `reject` to discard a
   few and still find something.

   `reject` matches TomTom's own sub-categories (`poi.categories`) and
   exists because the top-level category codes are broader than the words
   on this card, which made the nearest "school" an acting studio and the
   nearest "park" a cemetery. Every label below is named after what its
   category actually returns — "Schools & childcare" because a daycare is
   what comes back nearest in most cities (and is a daily essential in its
   own right), "Pharmacy" because that is the daily healthcare unit a
   15-minute city is measured on. 7321 (hospital/polyclinic) was tried and
   dropped: it surfaced "Varicose Vein Treatments Center" as Midtown's
   nearest healthcare, and nobody walks to a hospital daily.

   Verified against the live API — do not swap a code without re-checking
   what it returns. 7328 looks like "doctor" and is not: it returns banks. */
const ESSENTIALS = [
  { key: 'groceries', label: 'Groceries',
    fetch: (c, r) => poiSearch({ query: 'supermarket', center: c, radius: r, limit: 20 }) },
  { key: 'schools',   label: 'Schools & childcare',
    reject: /vocational training|driving school/i,
    fetch: (c, r) => nearbySearch({ center: c, radius: r, categorySet: 7372, limit: 20 }) },
  { key: 'health',    label: 'Pharmacy',
    fetch: (c, r) => nearbySearch({ center: c, radius: r, categorySet: 7326, limit: 20 }) },
  { key: 'transit',   label: 'Transit stop',
    fetch: (c, r) => nearbySearch({ center: c, radius: r, categorySet: 9942, limit: 20 }) },
  { key: 'parks',     label: 'Park',
    reject: /cemetery|historic site/i,
    fetch: (c, r) => nearbySearch({ center: c, radius: r, categorySet: 9362, limit: 20 }) },
  { key: 'social',    label: 'Cafés & food',
    fetch: (c, r) => nearbySearch({ center: c, radius: r, categorySet: 7315, limit: 20 }) },
];

/* Road profile sampling. Traffic Flow answers per point, so a 3×3 grid
   across the walk buffer characterises the area's road network — its
   speed character and how far below free-flow it's running right now.

   This replaced a live-incident count, which looked authoritative and
   was not: Midtown returned 45 "incidents" of which exactly ONE was a
   jam — the rest were road closures and long-running works, and 0 of the
   45 carried a delay value. A count that reads alarming while the street
   grid is running at 98% of free-flow is a broken metric. The ratio below
   reads 0.98 there and 0.68 in a genuinely jammed Paris core, and it's
   computed from the same Traffic Flow data the basemap paints, so the
   number and the map can't disagree. */
const ROAD_GRID = 3;              // 3×3 = 9 samples per area
const ROAD_GRID_INSET = 0.7;      // keep samples inside the buffer, off its corners
/* frc 0-2 are motorway / major / other-major. Their share is the
   "exposure to fast traffic" signal territory-risk pricing asks for. */
const MAJOR_ROAD_FRC_MAX = 2;

const WALK_RADIUS_M = 1200;     // the 1.2 km buffer the exposure block reports over
const WALK_BUDGET_MIN = 15;     // the "15-minute city" budget every row is banded against
/* Search well past the walk budget. A supermarket 2.1 km away is a more
   useful answer than "none within 1.2 km" — the row can say "26 min" and
   fail the budget honestly, instead of showing an empty dash. */
const SEARCH_RADIUS_M = 3000;
const WALK_SPEED_M_PER_MIN = 80;   // 4.8 km/h — only used if a route call fails
/* An area only behaves like a neighbourhood if a 15-minute walk is the
   right unit for it. Measured across the preset cities, the areas that
   resolve at Neighbourhood / Subdivision run 1-6 km corner to corner,
   while the Municipality fallback lands on Singapore (12 km), Mexico City
   (75 km) and 東京 (335 km — its bbox reaches the Ogasawara islands, so
   its centre is open ocean). Eight walk-radii splits those two groups with
   room to spare; past it we score the click and skip the polygon, rather
   than claim one walkability score for a whole prefecture. */
const AREA_SCALE_MAX_M = WALK_RADIUS_M * 8;
const truthy = v => v === true || v === 'true';

/* Starting camera presets exposed by the `region` combobox. Each preset
   drops the camera right over a city centre so the first click is a
   short hop, not a pan-and-zoom hunt. The engine itself is region-
   agnostic — these are camera bookmarks, nothing more. The combobox
   also accepts any free-text city name; the scene geocodes those at
   runtime and re-aims the camera once coordinates resolve. */
const REGIONS = {
  amsterdam:  { center: [4.9041,   52.3676], zoom: 11 },
  paris:      { center: [2.3522,   48.8566], zoom: 12 },
  berlin:     { center: [13.4050,  52.5200], zoom: 11 },
  london:     { center: [-0.1276,  51.5072], zoom: 11 },
  barcelona:  { center: [2.1734,   41.3874], zoom: 12 },
  newyork:    { center: [-73.9857, 40.7484], zoom: 12 },
  mexicocity: { center: [-99.1332, 19.4326], zoom: 11 },
  saopaulo:   { center: [-46.6333, -23.5505], zoom: 12 },
  tokyo:      { center: [139.7670, 35.6814], zoom: 12 },
  singapore:  { center: [103.8198,  1.3521], zoom: 12 },
};

/* Walk a coordinate tree of any nesting depth to grow a bbox. */
function growBbox(coords, bbox) {
  for (const c of coords) {
    if (typeof c[0] === 'number') {
      if (c[0] < bbox[0]) bbox[0] = c[0]; if (c[0] > bbox[2]) bbox[2] = c[0];
      if (c[1] < bbox[1]) bbox[1] = c[1]; if (c[1] > bbox[3]) bbox[3] = c[1];
    } else growBbox(c, bbox);
  }
}

/* Bounding box of a boundary, used to frame the area and to place the
   essentials sweep at its centre. Admin Boundaries hands back a
   FeatureCollection, not a bare Feature — reading `.geometry` straight off
   the top level yields undefined, which is how the framing step here used
   to no-op. Handle both shapes. Returns null for an empty geometry. */
function bboxOf(boundary) {
  const features = boundary?.features || (boundary?.geometry ? [boundary] : []);
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) growBbox(f.geometry?.coordinates || [], bbox);
  return bbox[0] === Infinity ? null : bbox;
}

/* Corner-to-corner size of a bbox in metres — the scale test for whether
   an area is a neighbourhood or a whole prefecture. */
function bboxDiagonalM(bbox) {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const w = (bbox[2] - bbox[0]) * 111_320 * Math.cos(midLat * Math.PI / 180);
  const h = (bbox[3] - bbox[1]) * 110_540;
  return Math.hypot(w, h);
}

/* One essential, measured: nearest by straight-line distance from Search,
   then the routed pedestrian time to it. Search sorts by `dist`, so
   results[0] is the nearest and no client-side sort is needed.

   `routed` records whether the minutes came from the Routing API or from
   the crow-flies fallback, so the card can mark an estimate as one rather
   than passing it off as a measurement. */
async function measureEssential(essential, center) {
  const hits = await essential.fetch(center, SEARCH_RADIUS_M).catch(() => []);
  // Nearest ACCEPTABLE hit. The reject pattern runs against TomTom's own
  // sub-categories, so "Groceries" can't resolve to a driving school and
  // "Park" can't resolve to a cemetery — see ESSENTIALS.
  const nearest = hits.find(h =>
    h.position && !(essential.reject && (h.categories || []).some(c => essential.reject.test(c))));
  if (!nearest) {
    return { key: essential.key, label: essential.label, nearest: null, walkMin: null, walkM: null, routed: false };
  }
  let walkMin = null, walkM = null, routed = false;
  try {
    const r = await calculateRoute({
      origin: center, dest: nearest.position, travelMode: 'pedestrian', traffic: false,
    });
    walkMin = Math.max(1, Math.round(r.summary.travelTimeInSeconds / 60));
    walkM = r.summary.lengthInMeters;
    routed = true;
  } catch {
    // No pedestrian route (an island, a POI behind a barrier, a throttled
    // call). Fall back to the straight line so the row still carries a
    // number, flagged as an estimate.
    walkM = nearest.dist;
    walkMin = nearest.dist != null ? Math.max(1, Math.round(nearest.dist / WALK_SPEED_M_PER_MIN)) : null;
  }
  return {
    key: essential.key, label: essential.label,
    nearest: { name: nearest.name || null, dist: nearest.dist, position: nearest.position },
    walkMin, walkM, routed,
    within: walkMin != null && walkMin <= WALK_BUDGET_MIN,
  };
}

/* Measure all six in parallel, then summarise. `within` is the headline
   fraction, `gap` names the essential that costs the most walking — the
   single most actionable line on the card. */
async function measureAccess(center) {
  const rows = await Promise.all(ESSENTIALS.map(e => measureEssential(e, center)));
  const within = rows.filter(r => r.within).length;
  const timed = rows.filter(r => r.walkMin != null).map(r => r.walkMin).sort((a, b) => a - b);
  const median = timed.length ? timed[Math.floor(timed.length / 2)] : null;
  // The worst row, whether or not it has a time — an essential with no
  // result at all inside 3 km is a bigger gap than one at 26 minutes.
  const gap = rows.reduce((worst, r) => {
    if (!worst) return r;
    if (r.walkMin == null) return worst.walkMin == null ? worst : r;
    if (worst.walkMin == null) return worst;
    return r.walkMin > worst.walkMin ? r : worst;
  }, null);
  return { rows, within, median, gap };
}

/* Road profile over the walk buffer: what kind of streets these are, and
   how they're running right now. Two different questions, from one
   sampling pass.

   - `freeFlow` (mean, and the fastest found) is the road CHARACTER, and
     it's stable: a dense pedestrian core measures ~18 km/h, a district on
     a ring road ~53 km/h. For territory-risk pricing, fast roads beside
     homes are a severity signal.
   - `ratio` is the LIVE congestion — mean current over mean free-flow.
     This is the number that has to agree with the colours on the map.
   - `majorShare` is how much of the sampled network is motorway / major. */
/* ── City-level comparison ─────────────────────────────────────────────
   The comparison happens at CITY level: load every neighbourhood at once,
   score them all on the selected lens, colour and rank them on the map.
   A single-area card can only ever say "this area is good" — twenty areas
   side by side say which is better, which is the actual question.

   There is no "list the children of this municipality" endpoint, so
   enumeration is a sweep: reverse-geocode a grid at Neighbourhood level
   and dedupe by boundaryId. Measured yield is high — 22 distinct areas
   from 25 samples over Paris, 18 over New York, 14 over São Paulo. Where
   the Neighbourhood level is sparse (Berlin returns almost none) the
   sweep drops a level and picks up Kreuzberg / Mitte / Neukölln instead. */
const CITY_GRID = 8;             // 8×8 sweep = 64 lookups per city
const CITY_MIN_AREAS = 8;        // below this, retry a level coarser
/* No upper cap. A partial set of neighbourhoods reads as an arbitrary
   handful rather than a comparison — the 5×5 sweep this started with
   found 18 of Paris's ~80 quartiers, and which 18 depended on where the
   grid happened to land. Denser sweep, and everything it finds is drawn. */

/* Bounded-concurrency map. The dense sweep plus per-area scoring is a few
   hundred calls for a big city; unbounded Promise.all trips TomTom's rate
   limit and then every request pays retry backoff, which is slower than
   just queueing in the first place. */
async function pool(items, fn, limit = 8) {
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

async function discoverAreas(center, spanKm) {
  const [lon, lat] = center;
  const dLat = (spanKm / 2) / 111;
  const dLon = (spanKm / 2) / (111 * Math.cos(lat * Math.PI / 180));
  const points = [];
  for (let i = 0; i < CITY_GRID; i++) {
    for (let k = 0; k < CITY_GRID; k++) {
      points.push([
        lon + ((k / (CITY_GRID - 1)) * 2 - 1) * dLon,
        lat + ((i / (CITY_GRID - 1)) * 2 - 1) * dLat,
      ]);
    }
  }
  const found = new Map();   // boundaryId -> { name, level }
  for (const level of AREA_LEVELS) {
    if (level.entityType === 'Municipality') break;   // too coarse to compare
    const hits = await pool(points, p =>
      reverseGeocode({ point: p, entityType: level.entityType }).catch(() => null));
    for (const h of hits) {
      if (!h?.boundaryId || found.has(h.boundaryId)) continue;
      const name = h[level.field] || h.address;
      if (name) found.set(h.boundaryId, { name, level: level.entityType, municipality: h.municipality });
    }
    if (found.size >= CITY_MIN_AREAS) break;
  }
  return [...found.entries()].map(([boundaryId, v]) => ({ boundaryId, ...v }));
}

/* Overview access for ONE area, in three calls instead of six.

   A city-wide POI cloud was tried first and was wrong: five anchor
   searches cap out around 100 points per essential, which cannot describe
   a city of thousands of cafés. Areas that fell between anchors scored
   0 of 6 — including Gros Caillou in the 7th arrondissement, one of the
   most walkable places in Paris. Same saturation trap as the original
   counts, one level up.

   So each area searches around its own centre. The three calls are split
   by density, not by essential:
     1. free-text "supermarket" — the MARKET category is too broad
        (it returns telecom shops and a ravioli counter)
     2. the four sparse essentials in one multi-category call
     3. restaurants alone, because in a dense core they take 74 of 100
        slots in a shared call and push the park out entirely — which is
        exactly how "Alsace, Paris" reported no park within 3 km

   Distances here are STRAIGHT-LINE, which is what makes them cheap.
   Clicking an area re-measures that one with pedestrian routing: the
   overview ranks, the card proves. */
const SPARSE_SET = '7372,7326,9942,9362';
const CODE_TO_KEY = {
  SCHOOL: 'schools',
  PHARMACY: 'health',
  PUBLIC_TRANSPORT_STOP: 'transit',
  PARK_RECREATION_AREA: 'parks',
};

async function overviewAccess(center) {
  const [grocery, sparse, food] = await Promise.all([
    poiSearch({ query: 'supermarket', center, radius: SEARCH_RADIUS_M, limit: 5 }).catch(() => []),
    nearbySearch({ center, radius: SEARCH_RADIUS_M, categorySet: SPARSE_SET, limit: 100 }).catch(() => []),
    nearbySearch({ center, radius: SEARCH_RADIUS_M, categorySet: 7315, limit: 5 }).catch(() => []),
  ]);

  const best = {};
  const consider = (key, hit) => {
    if (hit.dist == null) return;
    const ess = ESSENTIALS.find(e => e.key === key);
    if (ess?.reject && (hit.categories || []).some(c => ess.reject.test(c))) return;
    if (!best[key] || hit.dist < best[key].dist) best[key] = { dist: hit.dist, name: hit.name };
  };
  for (const h of grocery) consider('groceries', h);
  for (const h of food) consider('social', h);
  for (const h of sparse) {
    for (const c of h.classifications || []) {
      const key = CODE_TO_KEY[c.code];
      if (key) consider(key, h);
    }
  }

  const rows = ESSENTIALS.map(e => {
    const b = best[e.key];
    if (!b) return { key: e.key, label: e.label, dist: null, min: null, name: null, within: false };
    const min = Math.max(1, Math.round(b.dist / WALK_SPEED_M_PER_MIN));
    return { key: e.key, label: e.label, dist: b.dist, min, name: b.name, within: min <= WALK_BUDGET_MIN };
  });
  const within = rows.filter(r => r.within).length;
  const timed = rows.filter(r => r.min != null).map(r => r.min).sort((a, b) => a - b);
  // `mean` is what the lens ranks on — see LENSES. Essentials with no hit
  // inside the search radius count as the radius itself rather than being
  // dropped, so an area missing a pharmacy can't outrank one that has all
  // six just by having fewer numbers to average.
  const capMin = Math.round(SEARCH_RADIUS_M / WALK_SPEED_M_PER_MIN);
  const mean = rows.reduce((a, r) => a + (r.min ?? capMin), 0) / rows.length;
  return {
    rows, within, mean,
    median: timed.length ? timed[Math.floor(timed.length / 2)] : null,
  };
}

async function measureRoads(center) {
  const [lon, lat] = center;
  const dLat = WALK_RADIUS_M / 110_540;
  const dLon = WALK_RADIUS_M / (111_320 * Math.cos(lat * Math.PI / 180));
  const points = [];
  for (let i = 0; i < ROAD_GRID; i++) {
    for (let k = 0; k < ROAD_GRID; k++) {
      const fy = (i / (ROAD_GRID - 1)) * 2 - 1;
      const fx = (k / (ROAD_GRID - 1)) * 2 - 1;
      points.push([lon + fx * dLon * ROAD_GRID_INSET, lat + fy * dLat * ROAD_GRID_INSET]);
    }
  }
  const samples = (await Promise.all(points.map(p => flowSegment({ point: p }).catch(() => null))))
    .filter(s => s && s.freeFlowSpeed > 0);
  if (!samples.length) return null;

  // Neighbouring grid points often land on the same street. De-duplicate
  // so one long avenue crossing the buffer doesn't outvote the side
  // streets in the mean.
  const uniq = [...new Map(samples.map(s => [`${s.frc}|${s.freeFlowSpeed}|${s.currentSpeed}`, s])).values()];
  const meanFree = uniq.reduce((a, s) => a + s.freeFlowSpeed, 0) / uniq.length;
  const meanCurr = uniq.reduce((a, s) => a + s.currentSpeed, 0) / uniq.length;
  const major = uniq.filter(s => s.frc <= MAJOR_ROAD_FRC_MAX).length;
  return {
    sampled: uniq.length,
    attempted: points.length,
    meanFree,
    maxFree: Math.max(...uniq.map(s => s.freeFlowSpeed)),
    ratio: meanFree > 0 ? meanCurr / meanFree : null,
    majorShare: major / uniq.length,
  };
}

/* The lenses the `metric` param exposes. One question at a time: the
   filter picks the metric, and the metric is ALL the map and the panel
   show. Stacking access, roads and a ranking in one card asked the reader
   to hold three unrelated scales at once, and buried the comparison.

   `needs` says which measurement the lens depends on, so a city load only
   fetches what the active filter actually reads.

   `of` returns the RAW quantity — minutes, km/h, a ratio. An earlier
   version normalised inside `of` against a fixed floor, which collapsed
   distinct values into ties: 10 km/h and 15 km/h both clamped to zero, so
   two areas differing by a third of their speed ranked equal. Scaling
   belongs in the colour ramp, against the areas actually on screen. */
const LENSES = [
  {
    key: 'access', label: 'Walk to essentials', unit: 'min', better: 'low', needs: 'access',
    note: 'Mean walk to the nearest of six daily essentials.',
    of: a => a.access?.mean ?? null,
    text: a => a.access?.mean != null ? a.access.mean.toFixed(1) : '—',
  },
  {
    key: 'speed', label: 'Road speed', unit: 'km/h', better: 'low', needs: 'roads',
    note: 'Typical free-flow speed of the streets — the exposure a territory-risk model prices.',
    of: a => a.roads?.meanFree ?? null,
    text: a => a.roads ? String(Math.round(a.roads.meanFree)) : '—',
  },
  {
    key: 'congestion', label: 'Live congestion', unit: '% of free-flow', better: 'high',
    note: 'Current speed as a share of free-flow, from the data the basemap paints.',
    needs: 'roads',
    of: a => a.roads?.ratio ?? null,
    text: a => a.roads?.ratio != null ? String(Math.round(a.roads.ratio * 100)) : '—',
  },
];

/* Two flow samples per area is enough for a comparative mean across a
   whole city; a selected area gets the full 9-point profile. */
async function measureRoadsLight(center) {
  const [lon, lat] = center;
  const d = WALK_RADIUS_M / 110_540;
  const dLon = WALK_RADIUS_M / (111_320 * Math.cos(lat * Math.PI / 180));
  const pts = [[lon, lat], [lon + dLon * 0.6, lat + d * 0.6]];
  const samples = (await Promise.all(pts.map(p => flowSegment({ point: p }).catch(() => null))))
    .filter(s => s && s.freeFlowSpeed > 0);
  if (!samples.length) return null;
  const meanFree = samples.reduce((a, s) => a + s.freeFlowSpeed, 0) / samples.length;
  const meanCurr = samples.reduce((a, s) => a + s.currentSpeed, 0) / samples.length;
  return { meanFree, ratio: meanFree > 0 ? meanCurr / meanFree : null };
}

export default async function city(ctx, uc) {
  const showTraffic = truthy(paramFor(uc, 'traffic'));
  const region      = paramFor(uc, 'region') || 'paris';
  const lens = LENSES.find(l => l.key === paramFor(uc, 'metric')) || LENSES[0];

  const startView = REGIONS[region] || REGIONS.paris;
  const needsGeocode = !REGIONS[region] && typeof region === 'string' && region.trim();

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const area = areaParams(uc, { defaultFill: '#646E7B', defaultStroke: isDark ? '#C8D0DA' : '#646E7B', defaultWidth: 1.5 });
  const passColor = ctx.color('positive');
  const warnColor = ctx.color('attention');
  const failColor = ctx.color('negative');
  const inkColor  = isDark ? '#F2F5F8' : '#12141A';
  const haloColor = isDark ? '#0E1116' : '#FFFFFF';

  ctx.setView({ center: startView.center, zoom: startView.zoom, pitch: 0, bearing: 0, animate: false });

  // With every boundary filled and a number on each, basemap POI icons and
  // house numbers are pure interference.
  ctx.hideLayers(lyr => {
    const id = lyr.id;
    if (id.startsWith('POI')) return true;
    if (id.startsWith('TransitLabels')) return true;
    if (id.startsWith('NatureLabels')) return true;
    if (id.startsWith('Buildings')) return true;
    if (id === '3D - Building') return true;
    if (id === 'Hillshade') return true;
    if (id === 'House Number') return true;
    if (id === 'LULC - Parking & Driving') return true;
    if (id.endsWith('Road arrow')) return true;
    return false;
  });

  if (showTraffic) ctx.enableTrafficFlow();

  /* Borrow the basemap's own font stack — naming an unavailable text-font
     silently kills a symbol layer. */
  const fontStack = (() => {
    const sym = ctx.ml.getStyle()?.layers?.find(l => l.type === 'symbol' && l.layout?.['text-font']);
    return sym?.layout?.['text-font'] || ['Noto-Regular'];
  })();

  let areas = [];
  let selectedId = null;
  let cityLabel = REGIONS[region] ? region[0].toUpperCase() + region.slice(1) : String(region);
  let layersAdded = false;
  let pendingSelect = 0;

  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const fmtDist = m => m == null ? '—' : m < 25 ? 'on site' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;

  /* ── Ranking + colour ────────────────────────────────────────────── */

  function ranked() {
    const dir = lens.better === 'high' ? -1 : 1;
    return areas
      .map(a => ({ a, v: lens.of(a) }))
      .sort((x, y) => (x.v == null) - (y.v == null) || dir * ((x.v ?? 0) - (y.v ?? 0)))
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }

  /* Scale against the areas on screen, not an absolute range: the question
     is which of THESE is better. */
  function scaleOf(rows) {
    const vals = rows.map(r => r.v).filter(v => v != null);
    if (!vals.length) return { lo: 0, span: 1 };
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return { lo, span: (hi - lo) || 1 };
  }

  function colorFor(v, lo, span) {
    if (v == null) return isDark ? '#3A424D' : '#C9CFD6';
    const norm = (v - lo) / span;
    const t = lens.better === 'high' ? norm : 1 - norm;
    return t >= 0.66 ? passColor : t >= 0.33 ? warnColor : failColor;
  }

  /* ── Map ─────────────────────────────────────────────────────────── */

  function draw() {
    const rows = ranked();
    const { lo, span } = scaleOf(rows);

    const polys = { type: 'FeatureCollection', features: rows.flatMap(({ a, v }) =>
      (a.boundary?.features || []).map(f => ({
        type: 'Feature', geometry: f.geometry,
        properties: { id: a.boundaryId, color: colorFor(v, lo, span), selected: a.boundaryId === selectedId },
      })))
    };
    // Just the number on each area. The name is one click away in the
    // panel; twenty names at once is noise, twenty numbers is a map.
    const labels = { type: 'FeatureCollection', features: rows.map(({ a }) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: a.center },
      properties: { id: a.boundaryId, value: lens.text(a) },
    })) };

    if (!layersAdded) {
      ctx.addSource('areas', { type: 'geojson', data: polys });
      ctx.addSource('area-labels', { type: 'geojson', data: labels });
      ctx.addLayer({
        id: 'areas-fill', type: 'fill', source: 'areas',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['get', 'selected'], isDark ? 0.6 : 0.45, isDark ? 0.28 : 0.2],
        },
      });
      ctx.addLayer({
        id: 'areas-line', type: 'line', source: 'areas',
        paint: {
          'line-color': ['case', ['get', 'selected'], area.stroke, ['get', 'color']],
          'line-width': ['case', ['get', 'selected'], 3, area.width],
          'line-opacity': 0.85,
        },
      });
      ctx.addLayer({
        id: 'areas-value', type: 'symbol', source: 'area-labels',
        layout: {
          'text-field': ['get', 'value'], 'text-font': fontStack, 'text-size': 13,
          // Let MapLibre drop colliding numbers rather than stacking 57 of
          // them at city zoom: the set thins out when zoomed out and fills
          // back in as you zoom into a district.
          'text-allow-overlap': false, 'text-padding': 2,
        },
        paint: { 'text-color': inkColor, 'text-halo-color': haloColor, 'text-halo-width': 1.8 },
      });
      layersAdded = true;
    } else {
      ctx.ml.getSource('areas').setData(polys);
      ctx.ml.getSource('area-labels').setData(labels);
    }
  }

  /* The establishments behind an access number. Showing "3 min to a
     pharmacy" without showing WHICH pharmacy asks the reader to trust the
     number; plotting it lets them check it. */
  const EMPTY = { type: 'FeatureCollection', features: [] };
  let poiLayerAdded = false;

  function drawPois(rows) {
    const data = { type: 'FeatureCollection', features: (rows || [])
      .filter(r => r.nearest?.position)
      .map(r => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: r.nearest.position },
        properties: {
          // A row can carry a position but no time (no pedestrian route
          // and no straight-line distance either) — name it without
          // inventing a number.
          label: r.walkMin == null
            ? (r.nearest.name || r.label)
            : `${r.nearest.name || r.label} · ${r.walkMin} min`,
          color: r.within ? passColor : failColor,
        },
      })) };
    if (!poiLayerAdded) {
      if (!data.features.length) return;
      ctx.addSource('pois', { type: 'geojson', data });
      ctx.addLayer({
        id: 'poi-dot', type: 'circle', source: 'pois',
        paint: {
          'circle-radius': 5, 'circle-color': ['get', 'color'],
          'circle-stroke-width': 2, 'circle-stroke-color': haloColor,
        },
      });
      ctx.addLayer({
        id: 'poi-label', type: 'symbol', source: 'pois',
        layout: {
          'text-field': ['get', 'label'], 'text-font': fontStack, 'text-size': 11,
          'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-allow-overlap': false,
        },
        paint: { 'text-color': inkColor, 'text-halo-color': haloColor, 'text-halo-width': 1.6 },
      });
      poiLayerAdded = true;
    } else {
      ctx.ml.getSource('pois').setData(data);
    }
  }

  const clearPois = () => { if (poiLayerAdded) ctx.ml.getSource('pois').setData(EMPTY); };

  /* ── Panel ───────────────────────────────────────────────────────── */

  function setPanel(html) { ctx.setSidePanel(`<div class="city-card">${html}</div>`); }

  function loading(label) {
    setPanel(`
      <div class="city-card-head">
        <div class="city-card-eyebrow">${escapeHtml(lens.label)}</div>
        <div class="city-card-title"><span class="city-spinner" aria-hidden="true"></span>${escapeHtml(label)}</div>
      </div>`);
  }

  /* The city list. Rank, name, value — nothing else. The colour lives on
     the map where it means something; repeating it as a swatch here added
     a legend the reader has to decode twice. */
  function renderList() {
    const rows = ranked();
    const vals = rows.map(r => r.v).filter(v => v != null);
    const best = vals.length ? rows.find(r => r.v != null) : null;
    const list = rows.map(({ a, rank }) => `
      <button class="city-rank-row${a.boundaryId === selectedId ? ' is-focus' : ''}" data-area="${escapeHtml(a.boundaryId)}">
        <span class="city-rank-n">${rank}</span>
        <span class="city-rank-name">${escapeHtml(a.name)}</span>
        <span class="city-rank-value">${escapeHtml(lens.text(a))}</span>
      </button>`).join('');
    setPanel(`
      <div class="city-card-head">
        <div class="city-card-eyebrow">${escapeHtml(lens.label)} · ${escapeHtml(lens.unit)}</div>
        <div class="city-card-title">${escapeHtml(cityLabel)}</div>
        <div class="city-card-sub">${areas.length} areas${best ? ` · best ${escapeHtml(best.a.name)} at ${escapeHtml(lens.text(best.a))}` : ''}</div>
      </div>
      <div class="city-sect"><div class="city-rank">${list}</div></div>`);
    bind();
  }

  /* One selected area, showing ONLY what the active lens measures. */
  function renderArea(a, detail) {
    const rank = ranked().find(r => r.a.boundaryId === a.boundaryId)?.rank;
    let body = '';

    if (lens.needs === 'access') {
      const rows = detail.access.rows;
      body = `<div class="city-rows">${rows.map(r => `
        <div class="city-row2">
          <span class="city-row2-label">${escapeHtml(r.label)}</span>
          <span class="city-row2-time" style="color:${r.within ? passColor : failColor}">${
            r.walkMin == null ? '—' : `${r.walkMin}<span class="city-row2-unit">min</span>`}</span>
          <span class="city-row2-meta">${escapeHtml([r.nearest?.name, fmtDist(r.walkM)].filter(Boolean).join(' · '))}</span>
        </div>`).join('')}</div>
        <div class="city-note">Pedestrian routes, drawn on the map.</div>`;
    } else {
      const rd = detail.roads;
      body = rd ? `<div class="city-strip">
          <span class="city-strip-item"><b>${Math.round(rd.meanFree)}</b> km/h typical</span>
          <span class="city-strip-item"><b>${Math.round(rd.maxFree)}</b> km/h fastest</span>
          <span class="city-strip-item"><b>${Math.round(rd.ratio * 100)}%</b> of free-flow</span>
          <span class="city-strip-item"><b>${Math.round(rd.majorShare * 100)}%</b> major roads</span>
        </div>
        <div class="city-note">${rd.sampled} distinct road segments sampled.</div>`
        : '<div class="city-note">No road data here.</div>';
    }

    setPanel(`
      <div class="city-card-head">
        <button class="city-back" data-back="1">← ${escapeHtml(cityLabel)}</button>
        <div class="city-card-title">${escapeHtml(a.name)}</div>
        <div class="city-card-sub">#${rank} of ${areas.length} · ${escapeHtml(lens.text(a))} ${escapeHtml(lens.unit)}</div>
      </div>
      <div class="city-sect">${body}</div>`);
    bind();
  }

  function bind() {
    const host = document.getElementById('map-side');
    if (!host) return;
    for (const el of host.querySelectorAll('[data-area]')) {
      el.addEventListener('click', () => select(el.getAttribute('data-area')));
    }
    const back = host.querySelector('[data-back]');
    if (back) back.addEventListener('click', () => {
      selectedId = null;
      clearPois();
      draw();
      renderList();
    });
  }

  /* ── Selection ───────────────────────────────────────────────────── */

  async function select(boundaryId) {
    const a = areas.find(x => x.boundaryId === boundaryId);
    if (!a) return;
    const token = ++pendingSelect;
    selectedId = boundaryId;
    draw();
    if (a.bbox) ctx.fitBounds([[a.bbox[0], a.bbox[1]], [a.bbox[2], a.bbox[3]]], { duration: 600, maxZoom: 14 });

    if (!a.detail) {
      loading(a.name);
      // Only measure what the lens shows. The overview ranked on
      // straight-line distance; for the access lens this is where the
      // number becomes a real routed walk.
      const detail = {};
      if (lens.needs === 'access') detail.access = await measureAccess(a.center);
      else detail.roads = await measureRoads(a.center);
      if (token !== pendingSelect || ctx.cancelled) return;
      a.detail = detail;
    }
    if (token !== pendingSelect || ctx.cancelled) return;
    if (lens.needs === 'access') drawPois(a.detail.access.rows);
    else clearPois();
    renderArea(a, a.detail);
  }

  /* ── Boot ────────────────────────────────────────────────────────── */

  async function loadCity(center, spanKm, label) {
    cityLabel = label;
    loading(`Finding areas in ${label}…`);

    const found = await discoverAreas(center, spanKm);
    if (ctx.cancelled) return;
    if (!found.length) {
      setPanel(`
        <div class="city-card-head">
          <div class="city-card-eyebrow">No areas</div>
          <div class="city-card-title">Nothing to compare</div>
          <div class="city-card-sub">TomTom has no neighbourhood or subdivision boundaries here.</div>
        </div>`);
      return;
    }

    loading(`Scoring ${found.length} areas…`);
    const boundaries = await pool(found, f =>
      fetchBoundary(f.boundaryId, { zoom: 12 }).catch(() => null));
    if (ctx.cancelled) return;

    areas = found.map((f, i) => {
      const boundary = boundaries[i];
      const bbox = boundary ? bboxOf(boundary) : null;
      if (!bbox || bboxDiagonalM(bbox) > AREA_SCALE_MAX_M) return null;
      return { ...f, boundary, bbox, center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] };
    }).filter(Boolean);

    // Only the active lens's measurement — 3 calls per area for access,
    // 2 for either road lens, instead of all five regardless.
    if (lens.needs === 'access') {
      const got = await pool(areas, a => overviewAccess(a.center).catch(() => null), 5);
      areas.forEach((a, i) => { a.access = got[i]; });
    } else {
      const got = await pool(areas, a => measureRoadsLight(a.center).catch(() => null), 5);
      areas.forEach((a, i) => { a.roads = got[i]; });
    }
    if (ctx.cancelled) return;

    draw();
    renderList();
    ctx.setLegend({
      title: lens.label,
      items: [
        { color: passColor, shape: 'bar', label: lens.better === 'low' ? 'lower' : 'higher' },
        { color: failColor, shape: 'bar', label: lens.better === 'low' ? 'higher' : 'lower' },
      ],
    });

    const all = areas.reduce((b, a) => [
      Math.min(b[0], a.bbox[0]), Math.min(b[1], a.bbox[1]),
      Math.max(b[2], a.bbox[2]), Math.max(b[3], a.bbox[3]),
    ], [Infinity, Infinity, -Infinity, -Infinity]);
    if (all[0] !== Infinity) ctx.fitBounds([[all[0], all[1]], [all[2], all[3]]], { duration: 700 });
  }

  ctx.on('click', 'areas-fill', (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (id) select(id);
  });
  ctx.on('mouseenter', 'areas-fill', () => { ctx.ml.getCanvas().style.cursor = 'pointer'; });
  ctx.on('mouseleave', 'areas-fill', () => { ctx.ml.getCanvas().style.cursor = ''; });

  const CITY_SPAN_KM = { newyork: 12, mexicocity: 12, saopaulo: 12, tokyo: 12, berlin: 12, london: 12, singapore: 10 };

  if (needsGeocode) {
    const hits = await geocode({ query: region, limit: 1, entityType: 'Municipality' }).catch(() => []);
    if (ctx.cancelled) return;
    if (hits[0]) {
      ctx.setView({ center: hits[0].position, zoom: 11, animate: true });
      await loadCity(hits[0].position, 10, hits[0].name || String(region));
      return;
    }
  }
  await loadCity(startView.center, CITY_SPAN_KM[region] || 8, cityLabel);
}
