/* Package Tracker — real hub → recipient route, snapped courier movement.

   Hub and recipient addresses go through the TomTom Geocoding API; the
   path is a single Routing API call; the courier marker walks the
   returned polyline so movement always follows the street network. */

import { infoCard, chip } from '../../render/popup.js';
import { createPin, createMovingMarker } from '../../render/marker.js';
import { geocode, calculateRoute } from '../../map/services.js';
import { animateAlong } from '../../map/geo.js';
import { paramFor } from '../../state.js';
import { casingFor, lineParams, HALO } from '../_shared.js';

export default async function packageScn(ctx, uc) {
  const { color: accent, width: lineWidth, dashArray } = lineParams(uc, { defaultColor: ctx.caseColor(uc) });
  const STROKE_COLOR = casingFor(accent);
  const HUB_QUERY  = paramFor(uc, 'hub');
  const DEST_QUERY = paramFor(uc, 'dest');

  const [hubHits, destHits] = await Promise.all([
    geocode({ query: HUB_QUERY,  countrySet: 'NL', limit: 1 }),
    geocode({ query: DEST_QUERY, countrySet: 'NL', limit: 1 }),
  ]);
  if (ctx.cancelled) return;
  const hub  = hubHits[0];
  const dest = destHits[0];
  if (!hub || !dest) return;

  ctx.setView({
    center: [(hub.position[0] + dest.position[0]) / 2, (hub.position[1] + dest.position[1]) / 2],
    zoom: 10.5, animate: false,
  });

  // ETA accuracy depends on road conditions — show them under the route.
  ctx.enableTrafficFlow();
  ctx.enableTrafficIncidents();

  const { geojson, summary } = await calculateRoute({
    origin: hub.position, dest: dest.position,
  });
  if (ctx.cancelled) return;

  // Frame the whole parcel path so the user sees hub → recipient end to
  // end — a fixed zoom around the midpoint either crops the route or
  // shrinks it when the addresses are far apart.
  {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const [lng, lat] of geojson.geometry.coordinates) {
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
    ctx.fitBounds([[minLng, minLat], [maxLng, maxLat]], { duration: 700, maxZoom: 14 });
    ctx.markHomeBounds([[minLng, minLat], [maxLng, maxLat]], { maxZoom: 14 });
  }

  ctx.addSource('parcel-path', { type: 'geojson', data: geojson });
  ctx.addLayer({
    id: 'parcel-casing', type: 'line', source: 'parcel-path',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': STROKE_COLOR, 'line-width': lineWidth + HALO, 'line-opacity': 0.80 },
  });
  const parcelLinePaint = { 'line-color': accent, 'line-width': lineWidth, 'line-opacity': 0.95 };
  if (dashArray) parcelLinePaint['line-dasharray'] = dashArray;
  ctx.addLayer({
    id: 'parcel-line', type: 'line', source: 'parcel-path',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: parcelLinePaint,
  });

  const eta = new Date(Date.now() + summary.travelTimeInSeconds * 1000)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const window2 = new Date(Date.now() + (summary.travelTimeInSeconds + 20 * 60) * 1000)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const km = (summary.lengthInMeters / 1000).toFixed(1);

  ctx.addMarker({
    element: createPin(accent, 'building'), anchor: 'bottom',
    popupHTML: infoCard({
      accent, eyebrow: 'Sorting Hub', title: hub.name || HUB_QUERY,
      subtitle: hub.address || undefined,
      rows: [
        ['Scanned out', '12:08'],
        ['Carrier', 'PostNL Express'],
      ],
      footer: 'Step 2 of 4 complete',
    }),
  }, hub.position);

  ctx.addMarker({
    element: createPin(accent, 'house'), anchor: 'bottom',
    popupHTML: infoCard({
      accent, eyebrow: 'Delivery Address', title: dest.address || DEST_QUERY,
      rows: [
        ['Parcel', '#NL-9921-7733'],
        ['Recipient', 'M. Visser'],
        ['Estimated arrival', eta],
        ['Window', `${eta} – ${window2}`],
        ['Signature', 'Required'],
      ],
      footer: 'Step 3 of 4 · Out for delivery',
    }),
  }, dest.position);

  // Animated courier — walks the real polyline.
  const courierColor = ctx.color('attention');
  const line = geojson.geometry.coordinates;
  const startFraction = 0.35;
  const startIdx = Math.floor(startFraction * (line.length - 1));

  const courier = ctx.addMarker({
    element: createMovingMarker(courierColor, 'pkg'),
    anchor: 'center',
    popupHTML: infoCard({
      accent: courierColor, eyebrow: 'Courier · live', title: 'Van #07 · J. Hendriks',
      rows: [
        ['Total distance', `${km} km`],
        ['Speed', '32 km/h'],
        ['Stops before you', '2'],
      ],
      footer: 'Live tracking · snapped to route',
    }),
  }, line[startIdx]);

  ctx.addPopup(
    { offset: 14, anchor: 'bottom' },
    line[startIdx],
    chip({ accent: courierColor, text: `Arriving ${eta} · ${km} km route` })
  );

  animateAlong({
    ctx, line, speedMps: 9, startFraction, loop: true,
    onTick: ({ lngLat }) => courier.setLngLat(lngLat),
  });
}
