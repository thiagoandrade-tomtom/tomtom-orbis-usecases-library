/* Scene: Origin to Destination Route — fully ported to the SDK.
   Asks the Routing API for the primary route plus alternatives so the
   panel UX matches a real navigation app: pick the fastest, a shorter
   one, or a scenic detour. Each alternative is drawn dim; click to
   promote it to the highlighted route. */

import { calculateRoute, geocode } from '../map/services.js';
import { infoCard, chip } from '../render/popup.js';
import { paramFor } from '../state.js';
import { casingFor, lineParams, HALO, fmtDuration, fmtDurationSec } from './_shared.js';

// Known fallback coordinates for the default param values — used when
// geocode comes back empty so the scene always renders the demo route.
const FALLBACK = {
  'Schiphol Airport, Amsterdam':      [4.7637, 52.3105],
  'Conservatorium Hotel, Amsterdam':  [4.8770, 52.3563],
  // Kept for older saved routes / share links.
  'Amsterdam Centraal':               [4.8898, 52.3740],
  'Rijksmuseum, Amsterdam':           [4.8717, 52.3398],
};

const dimColor = () =>
  document.documentElement.getAttribute('data-theme') === 'dark' ? '#92989F' : '#646E7B';

const fmtClock = (sec) =>
  new Date(Date.now() + sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default async function route(ctx, uc) {
  const { color: accent, width: lineWidth, style: lineStyle, dashArray } = lineParams(uc, { defaultColor: ctx.caseColor(uc) });
  const DIM_COLOR  = dimColor();
  const STROKE_COLOR = casingFor(accent);
  const fromQ      = paramFor(uc, 'from');
  const toQ        = paramFor(uc, 'to');
  const travelMode = paramFor(uc, 'travelMode') || 'car';
  const traffic    = paramFor(uc, 'traffic') !== false;

  ctx.setView({ center: [4.9000, 52.3700], zoom: 11, animate: true });

  /* No country lock — users can type addresses anywhere in the world. */
  const [fromHits, toHits] = await Promise.all([
    geocode({ query: fromQ, limit: 1 }).catch(() => []),
    geocode({ query: toQ,   limit: 1 }).catch(() => []),
  ]);
  if (ctx.cancelled) return;
  const origin = fromHits[0]?.position || FALLBACK[fromQ];
  const dest   = toHits[0]?.position   || FALLBACK[toQ];

  if (!origin || !dest) {
    ctx.addPopup(
      { offset: 0, anchor: 'center', closeButton: true },
      [4.9000, 52.3700],
      infoCard({
        accent, eyebrow: 'Routing', title: 'Could not resolve endpoints',
        rows: [['From', fromQ], ['To', toQ]],
        footer: 'Try a more specific address.',
      })
    );
    return;
  }

  if (traffic) {
    ctx.enableTrafficFlow();
    ctx.enableTrafficIncidents();
  }

  let routed;
  try {
    routed = await calculateRoute({ origin, dest, travelMode, traffic, maxAlternatives: 2 });
  } catch (err) {
    console.warn('[route] calculateRoute failed:', err.message);
    ctx.addPopup(
      { offset: 0, anchor: 'center', closeButton: true },
      origin,
      infoCard({
        accent, eyebrow: 'Routing failed', title: 'TomTom Routing API error',
        rows: [['From', fromQ], ['To', toQ], ['Detail', err.message.slice(0, 120)]],
      })
    );
    return;
  }
  if (ctx.cancelled) return;

  // [primary, ...alternatives] — TomTom returns the recommended route first.
  const routes = [
    { geojson: routed.geojson, summary: routed.summary },
    ...routed.alternatives,
  ];

  // Label each option by its ETA delta vs. the fastest route, and tag the
  // one with the shortest distance — same vocabulary a navigation UI uses.
  const fastestSec = Math.min(...routes.map(r => r.summary.travelTimeInSeconds));
  const shortestMeters = Math.min(...routes.map(r => r.summary.lengthInMeters));
  routes.forEach((r, i) => {
    const deltaMin = Math.round((r.summary.travelTimeInSeconds - fastestSec) / 60);
    const isFastest  = r.summary.travelTimeInSeconds === fastestSec;
    const isShortest = r.summary.lengthInMeters === shortestMeters && !isFastest;
    r.label = isFastest ? 'Fastest'
            : isShortest ? 'Shortest'
            : `+${fmtDuration(deltaMin)}`;
    if (isShortest && deltaMin > 0) r.label = `Shortest · +${fmtDuration(deltaMin)}`;
    r.idx = i;
  });

  // Fit the combined bbox of all route options so none get cropped.
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const r of routes) {
    for (const [lng, lat] of r.geojson.geometry.coordinates) {
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
  }
  ctx.fitBounds([[minLng, minLat], [maxLng, maxLat]], { duration: 900 });
  /* Replace the placeholder "anchor over Amsterdam" home (recorded by
     the initial setView while geocoding resolved) with the real route
     frame, so recenter lands on the actual route. */
  ctx.markHomeBounds([[minLng, minLat], [maxLng, maxLat]]);

  // Draw each route as casing + line. Non-selected routes paint first
  // (so they sit below the selected one), each in its own source.
  routes.forEach((r, i) => {
    ctx.addSource(`route-${i}`, { type: 'geojson', data: r.geojson });
    // Halo: 2px stroke on each side, painted in the UI surface colour
    // so the route reads clearly against any basemap.
    ctx.addLayer({
      id: `route-casing-${i}`,
      type: 'line',
      source: `route-${i}`,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': STROKE_COLOR, 'line-width': lineWidth + HALO, 'line-opacity': 0.80 },
    });
    const linePaint = {
      'line-color': DIM_COLOR,
      'line-width': lineWidth * 0.8,
      'line-opacity': 1,
    };
    if (dashArray) linePaint['line-dasharray'] = dashArray;
    ctx.addLayer({
      id: `route-line-${i}`,
      type: 'line',
      source: `route-${i}`,
      layout: {
        'line-cap': lineStyle === 'dotted' ? 'round' : 'round',
        'line-join': 'round',
      },
      paint: linePaint,
    });
  });

  // Per-option chip at midpoint, kept around so we can restyle on select.
  const chipPopups = routes.map(r => {
    const coords = r.geojson.geometry.coordinates;
    const mid = coords[Math.floor(coords.length / 2)];
    return ctx.addPopup(
      /* Stay open while the user clicks between alternatives — comparing
         travel times is the whole point of this case, so the chips can't
         vanish on the first map click. */
      { offset: 14, anchor: 'bottom', className: `route-chip route-chip-${r.idx}`, closeOnClick: false },
      mid,
      chip({ accent: DIM_COLOR, text: `${r.label} · ${fmtDurationSec(r.summary.travelTimeInSeconds)} · ${(r.summary.lengthInMeters / 1000).toFixed(1)} km` })
    );
  });

  let selected = 0;

  function applySelection() {
    routes.forEach((r, i) => {
      const sel = i === selected;
      ctx.ml.setPaintProperty(`route-casing-${i}`, 'line-width', (sel ? lineWidth : lineWidth * 0.8) + HALO);
      ctx.ml.setPaintProperty(`route-line-${i}`,   'line-color',   sel ? accent : DIM_COLOR);
      ctx.ml.setPaintProperty(`route-line-${i}`,   'line-width',   sel ? lineWidth : lineWidth * 0.8);
      ctx.ml.setPaintProperty(`route-line-${i}`,   'line-opacity', 1);
      // Re-render chip with accent for selected, dim for the rest.
      const km = (r.summary.lengthInMeters / 1000).toFixed(1);
      const dur = fmtDurationSec(r.summary.travelTimeInSeconds);
      chipPopups[i].setHTML(chip({
        accent: sel ? accent : DIM_COLOR,
        text: `${r.label} · ${dur} · ${km} km`,
      }));
    });
    // Bring the selected route to the top of the overlay stack.
    try {
      ctx.ml.moveLayer(`route-casing-${selected}`);
      ctx.ml.moveLayer(`route-line-${selected}`);
    } catch {}
    // Refresh the destination marker's popup so its ETA reflects the pick.
    const r = routes[selected];
    const km = (r.summary.lengthInMeters / 1000).toFixed(1);
    destMarker.getPopup().setHTML(infoCard({
      accent, eyebrow: 'Destination', title: toHits[0]?.name || toQ,
      subtitle: toHits[0]?.address || undefined,
      rows: [
        ['Option', r.label],
        ['ETA', fmtClock(r.summary.travelTimeInSeconds)],
        ['Distance', `${km} km`],
        ['Drive time', fmtDurationSec(r.summary.travelTimeInSeconds)],
      ],
    }));
  }

  // Endpoint markers — added after route layers so they sit on top.
  ctx.addMarker({
    color: accent, icon: 'location',
    popupHTML: infoCard({
      accent, eyebrow: 'Origin', title: fromHits[0]?.name || fromQ,
      subtitle: fromHits[0]?.address || undefined,
      rows: [['Depart', 'now']],
    }),
  }, origin);
  // Seed the destination marker with a minimal popup so .getPopup() returns
  // a real instance; applySelection() will replace the HTML on every pick.
  const destMarker = ctx.addMarker({
    color: accent, icon: 'flag',
    popupHTML: infoCard({
      accent, eyebrow: 'Destination', title: toHits[0]?.name || toQ,
      subtitle: toHits[0]?.address || undefined,
    }),
  }, dest);

  // Click a route line — promote it.
  routes.forEach((_, i) => {
    ctx.on('click', `route-line-${i}`, () => { selected = i; applySelection(); });
    ctx.on('mouseenter', `route-line-${i}`, () => { ctx.ml.getCanvas().style.cursor = 'pointer'; });
    ctx.on('mouseleave', `route-line-${i}`, () => { ctx.ml.getCanvas().style.cursor = ''; });
  });

  applySelection();
}
