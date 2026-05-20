/* City Planning — neighbourhood analysis from real TomTom data.

   The view a planner wants on a single neighbourhood:
     - Where in the city is it? (Amsterdam municipality outline + every
       stadsdeel drawn faintly for context.)
     - What's its real boundary? (TomTom admin polygon, fetched live.)
     - What's actually inside it? (Live POI counts per category from
       Nearby Search: transit, food, landmarks, EV chargers, parking.)
     - How dense / how busy? (POI density per km² + live traffic flow.)
   Everything on the map is a real TomTom API call — no curated copy,
   no approximated geometry. The user picks the focus from the config
   panel; switching rebuilds the analysis. */

import { statsCard } from '../../render/popup.js';
import { createDot } from '../../render/marker.js';
import { geocode, fetchBoundary, nearbySearch } from '../../map/services.js';
import { OVERLAY_AREA_OUTLINE_WIDTH, OVERLAY_AREA_OUTLINE_WIDTH_FOCUS } from '../../map/config.js';
import { paramFor } from '../../state.js';

const STADSDELEN = [
  'Centrum, Amsterdam',
  'Amsterdam-Noord',
  'Amsterdam-Oost',
  'Amsterdam-West',
  'Nieuw-West, Amsterdam',
  'Amsterdam-Zuid',
  'Amsterdam-Zuidoost',
  'Westpoort, Amsterdam',
];

const CATEGORIES = [
  { key: 'transit',  code: 9942, label: 'Transit stops',  semantic: 'positive'    },
  { key: 'food',     code: 7315, label: 'Food venues',    semantic: 'attention'   },
  { key: 'landmark', code: 7376, label: 'Landmarks',      semantic: 'alternative' },
  { key: 'ev',       code: 7309, label: 'EV chargers',    semantic: 'negative'    },
  { key: 'parking',  code: 7311, label: 'Parking',        semantic: 'neutral'     },
];

const truthy = v => v === true || v === 'true';

/* Try multiple entity types so a stadsdeel that isn't tagged as
   MunicipalitySubdivision in TomTom's data still resolves. Returns
   the first hit with a boundaryId; falls back to any hit so we at
   least pan to the right place. */
async function resolveStadsdeel(query) {
  const attempts = ['MunicipalitySubdivision', 'Municipality', undefined];
  let positional = null;
  for (const entityType of attempts) {
    const hits = await geocode({ query, countrySet: 'NL', entityType, limit: 1 }).catch(() => []);
    const hit = hits[0];
    if (!hit) continue;
    if (hit.boundaryId) return hit;
    positional ??= hit;
  }
  return positional;
}

/* Polygon area (km²) via equirectangular projection at the polygon's
   centroid latitude. Accurate to ~1 % at city scale — fine for the
   density figure shown in the analysis card. Handles Polygon and
   MultiPolygon. */
function polygonAreaKm2(geojson) {
  const geom = geojson?.geometry;
  if (!geom) return 0;
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  let total = 0;
  for (const rings of polys) {
    const outer = rings?.[0];
    if (!outer || outer.length < 4) continue;
    let sumLat = 0;
    for (const [, lat] of outer) sumLat += lat;
    const meanLat = sumLat / outer.length;
    const mLng = 111320 * Math.cos((meanLat * Math.PI) / 180);
    const mLat = 110540;
    let area = 0;
    for (let i = 0; i < outer.length - 1; i++) {
      const [x1, y1] = outer[i];
      const [x2, y2] = outer[i + 1];
      area += (x1 * mLng) * (y2 * mLat) - (x2 * mLng) * (y1 * mLat);
    }
    total += Math.abs(area / 2);
  }
  return total / 1e6;
}

/* Walk a polygon geometry to grow a bbox. Used to frame the camera. */
function growBbox(coords, bbox) {
  for (const c of coords) {
    if (typeof c[0] === 'number') {
      if (c[0] < bbox[0]) bbox[0] = c[0]; if (c[0] > bbox[2]) bbox[2] = c[0];
      if (c[1] < bbox[1]) bbox[1] = c[1]; if (c[1] > bbox[3]) bbox[3] = c[1];
    } else growBbox(c, bbox);
  }
}

export default async function city(ctx, uc) {
  const focusQuery = paramFor(uc, 'place') || STADSDELEN[0];
  const RADIUS     = parseInt(paramFor(uc, 'radius') || '1500', 10);
  const showTraffic = truthy(paramFor(uc, 'traffic'));

  const accent     = ctx.caseColor(uc);
  const cityOutline = ctx.color('general');
  const catColor   = Object.fromEntries(CATEGORIES.map(c => [c.key, ctx.color(c.semantic)]));

  // Anchor camera over Amsterdam while async work resolves.
  ctx.setView({ center: [4.9, 52.37], zoom: 11, pitch: 0, bearing: 0, animate: true });
  if (showTraffic) ctx.enableTrafficFlow();

  // 1. Resolve every stadsdeel (with entityType fallbacks) + the
  //    Amsterdam municipality polygon used as the city frame.
  const [muniHits, ...stadsdeelHits] = await Promise.all([
    geocode({ query: 'Amsterdam', countrySet: 'NL', entityType: 'Municipality', limit: 1 }).catch(() => []),
    ...STADSDELEN.map(q => resolveStadsdeel(q)),
  ]);
  if (ctx.cancelled) return;

  const muni = muniHits[0];
  // Keep one entry per query — preserves order and indices even when a
  // geocode returns nothing for some stadsdeel.
  const stadsdelen = STADSDELEN.map((q, i) => {
    const h = stadsdeelHits[i];
    return h ? { query: q, ...h } : { query: q, position: null, boundaryId: null, name: null };
  });

  // 2. Draw the municipality outline as the city frame.
  if (muni?.boundaryId) {
    try {
      const muniBoundary = await fetchBoundary(muni.boundaryId, { zoom: 11 });
      if (!ctx.cancelled) {
        ctx.addSource('muni', { type: 'geojson', data: muniBoundary });
        ctx.addLayer({
          id: 'muni-outline', type: 'line', source: 'muni',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': cityOutline, 'line-width': 1.5, 'line-opacity': 0.6 },
        });
      }
    } catch {}
    if (ctx.cancelled) return;
  }

  // 3. Locate the focused stadsdeel + pan to it immediately so the
  //    camera tracks the dropdown selection even before polygons land.
  const focusIdx = stadsdelen.findIndex(s => s.query === focusQuery);
  const focus = focusIdx >= 0 && stadsdelen[focusIdx].position ? stadsdelen[focusIdx] : stadsdelen.find(s => s.position) || stadsdelen[0];
  if (focus?.position) {
    ctx.setView({ center: focus.position, zoom: 12, animate: true });
  }

  const focusBbox = [Infinity, Infinity, -Infinity, -Infinity];
  let focusBoundary = null;

  for (let i = 0; i < stadsdelen.length; i++) {
    const s = stadsdelen[i];
    if (!s.boundaryId) continue;
    let boundary;
    try { boundary = await fetchBoundary(s.boundaryId, { zoom: 12 }); } catch { continue; }
    if (ctx.cancelled) return;

    const isFocus = s.query === focus.query;
    const srcId = `stad-${i}`;
    ctx.addSource(srcId, { type: 'geojson', data: boundary });
    ctx.addLayer({
      id: `${srcId}-fill`, type: 'fill', source: srcId,
      paint: {
        'fill-color': accent,
        'fill-opacity': isFocus ? 0.18 : 0.03,
      },
    });
    ctx.addLayer({
      id: `${srcId}-outline`, type: 'line', source: srcId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': accent,
        'line-width': isFocus ? OVERLAY_AREA_OUTLINE_WIDTH_FOCUS : OVERLAY_AREA_OUTLINE_WIDTH,
        'line-opacity': isFocus ? 1.0 : 0.35,
      },
    });

    if (isFocus) {
      focusBoundary = boundary;
      growBbox(boundary.geometry?.coordinates || [], focusBbox);
    }
  }

  if (!focus?.position) return;

  // 4. Real POI sweep inside the focused stadsdeel.
  const center = focus.position;
  const results = await Promise.all(
    CATEGORIES.map(c => nearbySearch({
      center, radius: RADIUS, categorySet: c.code, limit: 100,
    }).catch(() => []))
  );
  if (ctx.cancelled) return;

  const byKey = Object.fromEntries(CATEGORIES.map((c, i) => [c.key, results[i]]));

  // 5. Plot each POI as a small dot in its category colour. Landmarks
  //    get a click popup with the real name — the rest stay quiet so
  //    the density pattern reads cleanly.
  for (const c of CATEGORIES) {
    const colour = catColor[c.key];
    const pois = byKey[c.key];
    for (const p of pois) {
      const opts = { element: createDot(colour, c.key === 'landmark' ? 9 : 6) };
      if (c.key === 'landmark' && p.name) {
        opts.popupHTML = statsCard({
          accent: colour, eyebrow: c.label, title: p.name,
          rows: [['Address', p.address || '—']],
        });
      }
      ctx.addMarker(opts, p.position);
    }
  }

  // 6. Analysis card — every number traceable to a TomTom call.
  const areaKm2 = focusBoundary ? polygonAreaKm2(focusBoundary) : 0;
  const totalPois = results.reduce((sum, r) => sum + r.length, 0);
  const density = areaKm2 > 0 ? totalPois / areaKm2 : 0;

  const topName = (key, n = 3) => byKey[key]
    .filter(p => p.name).slice(0, n).map(p => p.name).join(', ') || '—';

  ctx.addPopup(
    { offset: 18, anchor: 'top', closeButton: true, closeOnClick: false },
    center,
    statsCard({
      accent,
      eyebrow: 'Neighbourhood analysis',
      title: focus.name || focus.query.split(',')[0],
      tagline: `${areaKm2 > 0 ? areaKm2.toFixed(1) + ' km² · ' : ''}${(RADIUS / 1000).toFixed(1)} km search radius`,
      stats: [
        { value: byKey.transit.length,  label: 'Transit stops' },
        { value: byKey.food.length,     label: 'Food venues'   },
        { value: byKey.landmark.length, label: 'Landmarks'     },
      ],
      rows: [
        ['EV chargers',     String(byKey.ev.length)],
        ['Parking',         String(byKey.parking.length)],
        ['POI density',     `${density.toFixed(1)} / km²`],
        ['Top transit',     topName('transit')],
        ['Top food',        topName('food')],
        ['Top landmark',    topName('landmark')],
      ],
      footer: 'Boundaries · TomTom Admin Boundaries · POIs · TomTom Nearby Search',
    })
  );

  // 7. Frame the focused stadsdeel with a comfortable margin so the
  //    surrounding city stays visible at the edges. Falls back to a
  //    zoomed-in view on the centroid when no polygon was returned.
  if (focusBbox[0] !== Infinity) {
    ctx.fitBounds([[focusBbox[0], focusBbox[1]], [focusBbox[2], focusBbox[3]]], { duration: 700 });
  } else if (focus?.position) {
    ctx.setView({ center: focus.position, zoom: 13, animate: true });
  }
}
