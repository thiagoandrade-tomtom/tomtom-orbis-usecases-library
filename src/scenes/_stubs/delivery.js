/* Live delivery dispatch — depot + multi-stop round trip, TSP-optimised.

   Routing API is called once with `computeBestOrder=true` and the depot
   pinned as both origin AND final destination, so TomTom solves the most
   efficient stop sequence and the van returns to base. The driver marker
   animates along the exact snapped polyline that's rendered, so the dot
   always tracks the road. */

import { infoCard } from '../../render/popup.js';
import { createPin, createNumberPin, createMovingMarker } from '../../render/marker.js';
import { calculateMultiStopRoute } from '../../map/services.js';
import { OVERLAY_LINK_WIDTH } from '../../map/config.js';
import { animateAlong } from '../../map/geo.js';
import { cssVar, lineParams, HALO } from '../_shared.js';

// Depot + stops are baked in by design: this scene demonstrates the Routing
// API (batch + TSP), not geocoding. Pre-resolving keeps the cold load
// deterministic and avoids cascading 429s on parallel Search calls.
const DEPOT = {
  name:     'Westhaven Distribution Centre',
  address:  'Westhavenweg, 1042 Amsterdam',
  position: [4.833147, 52.406885],
  fleet:    'Fleet 14 · 4 vans active',
  driver:   'J. Hendriks',
  van:      'Van #07 · NL-V-3491',
  dispatch: 'A. Smit · Ops desk',
};

const STOPS = [
  { position: [4.898071, 52.356337], address: 'Govert Flinckstraat 251, 1073 BX Amsterdam', order: '#A-1042', customer: 'M. Visser',   items: 2, weight: '3.4 kg', window: '09:00 – 11:00', service: '2 min', signature: 'Required', status: 'Out for delivery' },
  { position: [4.895798, 52.360431], address: 'Nieuwe Looiersstraat 75, 1017 VB Amsterdam', order: '#A-1043', customer: 'L. Janssen',  items: 1, weight: '0.8 kg', window: '09:00 – 12:00', service: '2 min', signature: 'Optional', status: 'Out for delivery' },
  { position: [4.930133, 52.370346], address: 'Czaar Peterstraat 130, 1018 PV Amsterdam',   order: '#A-1044', customer: 'S. Bakker',   items: 4, weight: '7.1 kg', window: '10:00 – 12:00', service: '4 min', signature: 'Required', status: 'Delayed +6 min' },
  { position: [4.926288, 52.359124], address: 'Linnaeusstraat 89, 1093 EK Amsterdam',       order: '#A-1045', customer: 'K. de Vries', items: 1, weight: '0.5 kg', window: '10:00 – 13:00', service: '2 min', signature: 'Optional', status: 'Scheduled' },
  { position: [4.894012, 52.353722], address: 'Sarphatipark 24, 1072 PB Amsterdam',         order: '#A-1046', customer: 'P. Mulder',   items: 3, weight: '5.2 kg', window: '11:00 – 13:00', service: '3 min', signature: 'Required', status: 'Scheduled' },
  { position: [4.871467, 52.367752], address: 'Bilderdijkstraat 144, 1053 LB Amsterdam',    order: '#A-1047', customer: 'A. de Boer',  items: 2, weight: '2.6 kg', window: '11:00 – 14:00', service: '2 min', signature: 'Optional', status: 'Scheduled' },
];

const fmtTime = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtKm   = (m) => `${(m / 1000).toFixed(1)} km`;
const fmtMin  = (s) => `${Math.round(s / 60)} min`;

export default async function delivery(ctx, uc) {
  const { color: accent, width: lineWidth, dashArray } = lineParams(uc, { defaultColor: ctx.caseColor(uc) });
  const STROKE_COLOR = cssVar('--s0', '#0C0C12');
  const depotColor  = ctx.color('general');      // Neutral grey — infrastructure
  const driverColor = ctx.color('attention');    // Saffron — moving vehicle, high-vis

  const depot = DEPOT;
  const stops = STOPS;

  // Fit the depot + all stops in view rather than fixing a zoom, so the
  // framing adapts if the address list shifts.
  const lons = [depot.position[0], ...stops.map(s => s.position[0])];
  const lats = [depot.position[1], ...stops.map(s => s.position[1])];
  ctx.fitBounds(
    [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
    { padding: 80, maxZoom: 12 },
  );
  ctx.enableTrafficFlow();
  ctx.enableTrafficIncidents();

  // Round-trip TSP — depot pinned at both ends, stops reordered between.
  // Fallback chain: best-order → input-order → straight-line spokes so the
  // scene always renders something useful.
  const points = [depot.position, ...stops.map(s => s.position), depot.position];
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

  let order, summary, geojson, legs;
  if (routed) {
    ({ geojson, legs, summary } = routed);
    // Derive the visit order from the leg endpoints, NOT from
    // optimizedWaypoints. Observed live against the Routing API: the
    // (providedIndex, optimizedIndex) pairs returned alongside the
    // legs can disagree with the actual sequence the legs trace —
    // dispatcher would read e.g. Stop 1 → Stop 5 → Stop 2 because the
    // label assignment was inferred from a stale map while the polyline
    // followed a different order. The legs ARE the polyline, so we
    // match each non-return leg's terminal point back to its stop and
    // build `order` from that. The return leg (last) is skipped — it
    // ends at the depot, not a stop.
    const matchStop = (endpoint) => {
      let bestIdx = -1, bestDist = Infinity;
      for (let i = 0; i < stops.length; i++) {
        const dx = stops[i].position[0] - endpoint[0];
        const dy = stops[i].position[1] - endpoint[1];
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) { bestDist = d2; bestIdx = i; }
      }
      return bestIdx;
    };
    const seen = new Set();
    const derived = [];
    for (let i = 0; i < legs.length - 1; i++) {
      const pts = legs[i].points;
      const endpoint = pts[pts.length - 1];
      const idx = matchStop(endpoint);
      if (idx >= 0 && !seen.has(idx)) {
        derived.push(stops[idx]);
        seen.add(idx);
      }
    }
    order = derived.length === stops.length ? derived : stops;

    // Split into two features so the return-to-depot leg can sit at lower
    // opacity — the active delivery legs are what the dispatcher tracks;
    // the return is just the wrap-up.
    const deliveryCoords = legs.slice(0, order.length).flatMap((l, i) =>
      i === 0 ? l.points : l.points.slice(1),
    );
    const returnCoords = legs[order.length]?.points || [];

    ctx.addSource('delivery-route', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { kind: 'delivery' }, geometry: { type: 'LineString', coordinates: deliveryCoords } },
          ...(returnCoords.length
            ? [{ type: 'Feature', properties: { kind: 'return' }, geometry: { type: 'LineString', coordinates: returnCoords } }]
            : []),
        ],
      },
    });

    // Casing stays solid so the return leg still reads as a real route on
    // the map; only the colour fill fades, so the dispatcher's eye locks
    // onto the active delivery legs.
    ctx.addLayer({
      id: 'delivery-route-casing', type: 'line', source: 'delivery-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': STROKE_COLOR,
        'line-width': lineWidth + HALO,
        'line-opacity': 0.80,
      },
    });
    const dLinePaint = {
      'line-color': accent,
      'line-width': lineWidth,
      'line-opacity': ['match', ['get', 'kind'], 'return', 0.60, 1],
    };
    if (dashArray) dLinePaint['line-dasharray'] = dashArray;
    ctx.addLayer({
      id: 'delivery-route-line', type: 'line', source: 'delivery-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: dLinePaint,
    });
  } else {
    order = stops;
    summary = { lengthInMeters: 0, travelTimeInSeconds: 0 };
    legs = stops.map(() => ({ summary: { lengthInMeters: 0, travelTimeInSeconds: 0 } }));
    stops.forEach((s, i) => {
      ctx.addSource(`delivery-spoke-${i}`, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [depot.position, s.position] } },
      });
      ctx.addLayer({
        id: `delivery-spoke-${i}-line`, type: 'line', source: `delivery-spoke-${i}`,
        paint: { 'line-color': accent, 'line-width': OVERLAY_LINK_WIDTH, 'line-opacity': 0.55, 'line-dasharray': [3, 2] },
      });
    });
  }

  // Per-leg cumulative ETAs. legs[0] = depot → stop1, legs[N] = lastStop → depot.
  const departureAt = new Date();
  let cumSeconds = 0;
  let prevLabel = 'Depot';
  const stopMarkers = [];
  order.forEach((s, i) => {
    const leg = legs[i];
    const legSeconds = leg?.summary?.travelTimeInSeconds || 0;
    const legMeters  = leg?.summary?.lengthInMeters     || 0;
    cumSeconds += legSeconds;
    const arrival = new Date(departureAt.getTime() + cumSeconds * 1000);

    const m = ctx.addMarker({
      element: createNumberPin(accent, i + 1),
      anchor: 'bottom',
      popupHTML: infoCard({
        accent,
        eyebrow: `Stop ${i + 1} of ${order.length} · ${s.order}`,
        title: s.customer,
        subtitle: s.address,
        rows: [
          ['ETA',           fmtTime(arrival)],
          ['Window',        s.window],
          ['From',          `${prevLabel} · ${fmtKm(legMeters)} · ${fmtMin(legSeconds)}`],
          ['Parcel',        `${s.items} item${s.items > 1 ? 's' : ''} · ${s.weight}`],
          ['Service time',  s.service],
          ['Signature',     s.signature],
        ],
        footer: `Status: ${s.status}`,
      }),
    }, s.position);

    stopMarkers.push(m);
    prevLabel = `Stop ${i + 1}`;
  });

  // Re-append each stop marker's DOM node in REVERSE so Stop 1 ends up
  // the last child among stop pins → renders on top when nearby pins
  // overlap. We only shuffle stops; depot and driver are appended later
  // (they remain naturally on top of the whole stack), and popups still
  // float above everything via MapLibre's own append-on-open behaviour.
  for (let k = stopMarkers.length - 1; k >= 0; k--) {
    const el = stopMarkers[k].getElement();
    el.parentElement?.appendChild(el);
  }

  // Final leg back to depot.
  const returnLeg = legs[order.length];
  const returnSeconds = returnLeg?.summary?.travelTimeInSeconds || 0;
  const returnMeters  = returnLeg?.summary?.lengthInMeters     || 0;
  cumSeconds += returnSeconds;
  const returnAt = new Date(departureAt.getTime() + cumSeconds * 1000);

  // Depot pin — building icon in neutral grey to distinguish from the van.
  ctx.addMarker({
    element: createPin(depotColor, 'building'),
    anchor: 'bottom',
    popupHTML: infoCard({
      accent: depotColor,
      eyebrow: 'Depot · Round trip',
      title: depot.name,
      subtitle: depot.address,
      rows: [
        ['Dispatcher',     depot.dispatch],
        ['Driver',         depot.driver],
        ['Vehicle',        depot.van],
        ['Active stops',   `${order.length} of ${stops.length}`],
        ['Departed',       fmtTime(departureAt)],
        ['Total distance', fmtKm(summary.lengthInMeters)],
        ['Total drive',    fmtMin(summary.travelTimeInSeconds)],
        ['Return ETA',     `${fmtTime(returnAt)} · ${fmtKm(returnMeters)} from last stop`],
      ],
      footer: depot.fleet + ' · TSP-optimised',
    }),
  }, depot.position);

  // Animated driver — distinct icon (truck) and colour (saffron) so it
  // reads against the stop pins and route line. Loops the depot → stops →
  // depot polyline.
  if (geojson) {
    const line = geojson.geometry.coordinates;
    const driver = ctx.addMarker({
      element: createMovingMarker(driverColor, 'pkg', { stroke: STROKE_COLOR }),
      anchor: 'center',
      popupHTML: infoCard({
        accent: driverColor,
        eyebrow: 'Active vehicle',
        title: depot.driver,
        subtitle: depot.van,
        rows: [
          ['Heading to',  `Stop 1 · ${order[0].customer}`],
          ['Stops left',  String(order.length)],
          ['Return ETA',  fmtTime(returnAt)],
        ],
        footer: 'Telematics · live position',
      }),
    }, line[0]);
    animateAlong({
      ctx, line, speedMps: 14, startFraction: 0.05, loop: true,
      onTick: ({ lngLat }) => driver.setLngLat(lngLat),
    });
  }
}
