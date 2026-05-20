/* Fleet & Device Tracking — real positions, snapped movement.

   Each vehicle has an origin and destination resolved through the TomTom
   Geocoding API; the path between them comes from the Routing API and the
   marker walks the snapped polyline. The operating-zone polygon is the
   real Amsterdam municipality boundary fetched via additionalData. */

import { infoCard } from '../../render/popup.js';
import { createPin } from '../../render/marker.js';
import { geocode, calculateRoute, fetchBoundary } from '../../map/services.js';
import { OVERLAY_LINK_WIDTH, OVERLAY_PATH_FAINT_WIDTH } from '../../map/config.js';
import { animateAlong } from '../../map/geo.js';

// Real Amsterdam-area endpoints — every coordinate below comes back from
// the Geocoding API at runtime, so nothing is hand-placed on the map.
const ROUTES = [
  { id: 'VN-07', driver: 'J. Hendriks', from: 'Westhavenweg, Amsterdam',       to: 'Dam Square, Amsterdam',     speed: 11, status: 'On route',    fuel: 78, load: '62%', startFraction: 0.15 },
  { id: 'VN-12', driver: 'S. Bakker',   from: 'Amsterdam Centraal',            to: 'Rijksmuseum, Amsterdam',    speed: 0,  status: 'At customer', fuel: 64, load: '40%', startFraction: 1.0 },
  { id: 'VN-21', driver: 'M. Visser',   from: 'Schiphol Airport',              to: 'Amstel station, Amsterdam', speed: 16, status: 'On route',    fuel: 91, load: '88%', startFraction: 0.45 },
  { id: 'VN-04', driver: 'L. Janssen',  from: 'Olympic Stadium, Amsterdam',    to: 'Vondelpark, Amsterdam',     speed: 0,  status: 'Idle',        fuel: 22, load: '12%', startFraction: 1.0 },
  { id: 'VN-15', driver: 'P. Mulder',   from: 'Westerpark, Amsterdam',         to: 'Sloterdijk, Amsterdam',     speed: 8,  status: 'Returning',   fuel: 47, load: '0%',  startFraction: 0.75 },
];

export default async function fleet(ctx, uc) {
  const accent = ctx.caseColor(uc);
  ctx.setView({ center: [4.9000, 52.3650], zoom: 11, animate: true });

  // Fleet ops needs live traffic context — colour the roads by congestion
  // and surface active incidents so dispatchers can see why a van's slow.
  ctx.enableTrafficFlow();
  ctx.enableTrafficIncidents();

  // 1. Geocode every endpoint and pull a snapped route per vehicle.
  //    Wrapped per-vehicle: one bad geocode or unroutable pair can't take
  //    down the whole scene.
  const resolved = await Promise.all(ROUTES.map(async v => {
    try {
      const [a, b] = await Promise.all([
        geocode({ query: v.from, countrySet: 'NL', limit: 1 }),
        geocode({ query: v.to,   countrySet: 'NL', limit: 1 }),
      ]);
      if (!a[0] || !b[0]) return null;
      const { geojson, summary } = await calculateRoute({
        origin: a[0].position, dest: b[0].position,
      });
      return { ...v, origin: a[0].position, dest: b[0].position, geojson, summary };
    } catch (err) {
      console.warn(`[fleet] skipping ${v.id} — ${err.message}`);
      return null;
    }
  }));
  if (ctx.cancelled) return;

  const vehicles = resolved.filter(Boolean);

  // 2. Operating-zone polygon — real Amsterdam municipality from Search API.
  const amsterdam = (await geocode({
    query: 'Amsterdam', countrySet: 'NL', entityType: 'Municipality', limit: 1,
  }).catch(() => []))[0];
  if (ctx.cancelled) return;

  if (amsterdam?.boundaryId) {
    try {
      const boundary = await fetchBoundary(amsterdam.boundaryId, { zoom: 11 });
      if (ctx.cancelled) return;
      ctx.addSource('geofence', { type: 'geojson', data: boundary });
      ctx.addLayer({
        id: 'geofence-fill', type: 'fill', source: 'geofence',
        paint: { 'fill-color': accent, 'fill-opacity': 0.04 },
      });
      ctx.addLayer({
        id: 'geofence-line', type: 'line', source: 'geofence',
        paint: { 'line-color': accent, 'line-width': OVERLAY_LINK_WIDTH, 'line-dasharray': [3, 2], 'line-opacity': 0.85 },
      });
    } catch { /* boundary unavailable — skip the polygon, keep the markers */ }
  }

  // 3. Draw all routes (faint) so the viewer sees where each vehicle is headed.
  vehicles.forEach((v, i) => {
    ctx.addSource(`fleet-route-${i}`, { type: 'geojson', data: v.geojson });
    ctx.addLayer({
      id: `fleet-route-${i}-line`, type: 'line', source: `fleet-route-${i}`,
      paint: { 'line-color': accent, 'line-width': OVERLAY_PATH_FAINT_WIDTH, 'line-opacity': 0.35 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  });

  // 4. Spawn each vehicle marker, animate the moving ones along their route.
  vehicles.forEach(v => {
    const pinColor = v.status === 'Idle' ? ctx.color('attention') : accent;
    const line = v.geojson.geometry.coordinates;
    const startLngLat = v.speed > 0
      ? line[Math.floor(v.startFraction * (line.length - 1))]
      : v.dest;

    const marker = ctx.addMarker({
      element: createPin(pinColor, 'truck'),
      anchor: 'bottom',
      popupHTML: infoCard({
        accent,
        eyebrow: 'Vehicle · live',
        title: `${v.id} — ${v.driver}`,
        rows: [
          ['Status', v.status],
          ['Speed', `${Math.round(v.speed * 3.6)} km/h`],
          ['Fuel', `${v.fuel}%`],
          ['Load', v.load],
          ['ETA', new Date(Date.now() + v.summary.travelTimeInSeconds * 1000)
            .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })],
        ],
        footer: `Telemetry · live feed`,
      }),
    }, startLngLat);

    if (v.speed > 0) {
      animateAlong({
        ctx, line, speedMps: v.speed, startFraction: v.startFraction, loop: true,
        onTick: ({ lngLat }) => marker.setLngLat(lngLat),
      });
    }
  });
}
