/* Realtime Delivery — hub + multi-stop route, snapped driver movement.

   Hub and customer stops are geocoded; one Routing API call resolves the
   full snapped polyline (optionally re-ordered via computeBestOrder=true)
   so each leg follows the actual road. The driver marker animates along
   the consolidated geometry. */

import { infoCard } from '../../render/popup.js';
import { createPin, createNumberPin } from '../../render/marker.js';
import { geocode, calculateMultiStopRoute } from '../../map/services.js';
import { OVERLAY_ROUTE_CASING_WIDTH, OVERLAY_ROUTE_LINE_WIDTH, OVERLAY_LINK_WIDTH } from '../../map/config.js';
import { animateAlong } from '../../map/geo.js';

const HUB_QUERY = 'Westhavenweg, Amsterdam';

const STOPS = [
  { query: 'Vondelpark, Amsterdam',         order: '#A-1042', customer: 'M. Visser',   items: 2, status: 'Out for delivery' },
  { query: 'Dam Square, Amsterdam',         order: '#A-1043', customer: 'L. Janssen',  items: 1, status: 'Out for delivery' },
  { query: 'Artis Zoo, Amsterdam',          order: '#A-1044', customer: 'S. Bakker',   items: 4, status: 'Delayed +6 min' },
  { query: 'Amstel station, Amsterdam',     order: '#A-1045', customer: 'K. de Vries', items: 1, status: 'Scheduled' },
  { query: 'Rijksmuseum, Amsterdam',        order: '#A-1046', customer: 'P. Mulder',   items: 3, status: 'Scheduled' },
  { query: 'Westerpark, Amsterdam',         order: '#A-1047', customer: 'A. de Boer',  items: 2, status: 'Scheduled' },
];

export default async function delivery(ctx, uc) {
  const accent = ctx.caseColor(uc);
  const driverColor = ctx.color('attention');

  const safeGeocode = q =>
    geocode({ query: q, countrySet: 'NL', limit: 1 }).catch(() => []);
  const [hubHits, ...stopHitsList] = await Promise.all([
    safeGeocode(HUB_QUERY),
    ...STOPS.map(s => safeGeocode(s.query)),
  ]);
  if (ctx.cancelled) return;

  const hub = hubHits[0];
  const stops = STOPS.map((s, i) => {
    const hit = stopHitsList[i][0];
    return hit ? { ...s, position: hit.position, address: hit.address } : null;
  }).filter(Boolean);
  if (!hub || stops.length === 0) return;

  ctx.setView({ center: hub.position, zoom: 11, animate: true });

  // Live road conditions for dispatch awareness.
  ctx.enableTrafficFlow();
  ctx.enableTrafficIncidents();

  // Routing — try with TSP optimisation, fall back to input order if the
  // optimiser isn't available on this key, and finally fall back to
  // straight-line spokes if routing itself fails. The scene must always
  // render *something* useful.
  const points = [hub.position, ...stops.map(s => s.position)];
  let routed = null;
  for (const computeBestOrder of [true, false]) {
    try {
      routed = await calculateMultiStopRoute({ points, computeBestOrder });
      break;
    } catch (err) {
      console.warn(`[delivery] routing failed (computeBestOrder=${computeBestOrder}): ${err.message}`);
    }
  }
  if (ctx.cancelled) return;

  let order, summary, geojson, legs, optimizedWaypoints;
  if (routed) {
    ({ geojson, legs, summary, optimizedWaypoints } = routed);
    ctx.addSource('delivery-route', { type: 'geojson', data: geojson });
    ctx.addLayer({
      id: 'delivery-route-casing', type: 'line', source: 'delivery-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': accent, 'line-width': OVERLAY_ROUTE_CASING_WIDTH, 'line-opacity': 0.18 },
    });
    ctx.addLayer({
      id: 'delivery-route-line', type: 'line', source: 'delivery-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': accent, 'line-width': OVERLAY_ROUTE_LINE_WIDTH },
    });
    order = optimizedWaypoints
      ? optimizedWaypoints.map(w => w.optimizedIndex).map(i => stops[i])
      : stops;
  } else {
    // Degraded mode — straight lines from the hub to each stop.
    order = stops;
    summary = { lengthInMeters: 0, travelTimeInSeconds: 0 };
    legs = stops.map(() => ({ summary: { lengthInMeters: 0, travelTimeInSeconds: 0 } }));
    stops.forEach((s, i) => {
      ctx.addSource(`delivery-spoke-${i}`, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [hub.position, s.position] } },
      });
      ctx.addLayer({
        id: `delivery-spoke-${i}-line`, type: 'line', source: `delivery-spoke-${i}`,
        paint: { 'line-color': accent, 'line-width': OVERLAY_LINK_WIDTH, 'line-opacity': 0.55, 'line-dasharray': [3, 2] },
      });
    });
  }

  // Per-leg ETA cumulative (legs[0] = hub→first stop, etc.)
  let cumSeconds = 0;
  order.forEach((s, i) => {
    const leg = legs[i];
    cumSeconds += leg?.summary?.travelTimeInSeconds || 0;
    const eta = new Date(Date.now() + cumSeconds * 1000)
      .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    ctx.addMarker({
      element: createNumberPin(accent, i + 1),
      anchor: 'bottom',
      popupHTML: infoCard({
        accent,
        eyebrow: `Stop ${i + 1} of ${order.length}`,
        title: s.customer,
        rows: [
          ['Order', s.order],
          ['Address', s.address || s.query],
          ['Items', String(s.items)],
          ['ETA', eta],
        ],
        footer: `Status: ${s.status}`,
      }),
    }, s.position);
  });

  // Hub pin.
  ctx.addMarker({
    element: createPin(driverColor, 'truck'),
    anchor: 'bottom',
    popupHTML: infoCard({
      accent: driverColor,
      eyebrow: 'Dispatch Hub',
      title: hub.name || HUB_QUERY,
      rows: [
        ['Driver', 'J. Hendriks · Van #07'],
        ['Active stops', String(order.length)],
        ['Total distance', `${(summary.lengthInMeters / 1000).toFixed(1)} km`],
        ['Total drive', `${Math.round(summary.travelTimeInSeconds / 60)} min`],
      ],
      footer: 'Live dispatch · route optimised',
    }),
  }, hub.position);

  // Animated driver — only when we have a snapped polyline to follow.
  if (geojson) {
    const line = geojson.geometry.coordinates;
    const driver = ctx.addMarker({
      element: createPin(driverColor, 'truck'),
      anchor: 'bottom',
    }, line[0]);
    animateAlong({
      ctx, line, speedMps: 14, startFraction: 0.05, loop: true,
      onTick: ({ lngLat }) => driver.setLngLat(lngLat),
    });
  }
}
