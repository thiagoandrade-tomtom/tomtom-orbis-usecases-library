/* Track your fleet — dispatcher view.

   Vehicles are tagged by status (on-route / idle / delayed / outside-zone)
   and the pin colour encodes the state. The Amsterdam municipality
   polygon, fetched live via Admin Boundaries, is the geofence — drawn
   with a solid stroke and a tinted fill so the operating zone is
   immediately readable. Vans that ended up outside the polygon are
   highlighted with the alert colour, mirroring how a real geofence
   monitor would flag a violation.

   Every coordinate is geocoded at runtime; nothing is hand-placed on
   the map. */

import { infoCard } from '../../render/popup.js';
import { createPin } from '../../render/marker.js';
import { geocode, calculateRoute, fetchBoundary } from '../../map/services.js';
import { OVERLAY_PATH_FAINT_WIDTH } from '../../map/config.js';
import { animateAlong } from '../../map/geo.js';
import { paramFor } from '../../state.js';
import { cssVar, dashFor } from '../_shared.js';

const STATUS = {
  ON_ROUTE: 'on-route',
  IDLE:     'idle',
  DELAYED:  'delayed',
  OUTSIDE:  'outside-zone',
};

const STATUS_LABEL = {
  [STATUS.ON_ROUTE]: 'On route',
  [STATUS.IDLE]:     'Idle',
  [STATUS.DELAYED]:  'Delayed',
  [STATUS.OUTSIDE]:  'Outside zone',
};

const STATUS_TONE = {
  [STATUS.ON_ROUTE]: 'success',
  [STATUS.IDLE]:     'neutral',
  [STATUS.DELAYED]:  'warn',
  [STATUS.OUTSIDE]:  'danger',
};

/* Eight fictional vehicles spread across statuses. Endpoints are real
   addresses the TomTom Geocoding API resolves — five are inside
   Amsterdam municipality, two are idle at customers, one is delayed by
   a traffic incident, and one geocodes to Hoofddorp (outside Amsterdam)
   so the geofence violation visibly fires on first render. */
const VEHICLES = [
  // On-route — animating along their snapped polyline
  { id: 'VN-07', driver: 'J. Hendriks',   from: 'Westhavenweg, Amsterdam',       to: 'Dam Square, Amsterdam',       speed: 11, fuel: 78, load: '62%', status: STATUS.ON_ROUTE, startFraction: 0.15 },
  { id: 'VN-12', driver: 'S. Bakker',     from: 'Amsterdam Centraal',             to: 'Rijksmuseum, Amsterdam',      speed: 14, fuel: 64, load: '40%', status: STATUS.ON_ROUTE, startFraction: 0.45 },
  { id: 'VN-21', driver: 'M. Visser',     from: 'Sloterdijk, Amsterdam',          to: 'Amstel station, Amsterdam',   speed: 16, fuel: 91, load: '88%', status: STATUS.ON_ROUTE, startFraction: 0.65 },
  { id: 'VN-33', driver: 'A. de Boer',    from: 'Westerpark, Amsterdam',          to: 'Artis Zoo, Amsterdam',        speed:  9, fuel: 57, load: '25%', status: STATUS.ON_ROUTE, startFraction: 0.30 },
  { id: 'VN-44', driver: 'K. de Vries',   from: 'Olympic Stadium, Amsterdam',     to: 'Dam Square, Amsterdam',       speed: 12, fuel: 82, load: '70%', status: STATUS.ON_ROUTE, startFraction: 0.80 },
  // Idle — parked at customer, no motion
  { id: 'VN-04', driver: 'L. Janssen',    from: 'Vondelpark, Amsterdam',          to: 'Vondelpark, Amsterdam',       speed:  0, fuel: 22, load: '12%', status: STATUS.IDLE },
  { id: 'VN-18', driver: 'P. Mulder',     from: 'Museum District, Amsterdam',     to: 'Museum District, Amsterdam',  speed:  0, fuel: 45, load:  '0%', status: STATUS.IDLE },
  // Delayed — stopped mid-route because of a real-world incident
  { id: 'VN-15', driver: 'T. de Wit',     from: 'Schiphol Airport',               to: 'Amstel station, Amsterdam',   speed:  0, fuel: 35, load: '55%', status: STATUS.DELAYED, startFraction: 0.45, delayMin: 18, delayReason: 'Traffic incident on the A10' },
  // Outside zone — geocodes to Hoofddorp, well south-west of Amsterdam's polygon
  { id: 'VN-22', driver: 'R. van Dam',    from: 'Hoofddorp, NL',                  to: 'Hoofddorp, NL',               speed:  0, fuel: 88, load: '30%', status: STATUS.OUTSIDE },
];

const fmtClock = (offsetSec) =>
  new Date(Date.now() + (offsetSec || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Retry a TomTom call up to N times on 429 (rate limit) with linear
   backoff. Eight vans × 2 geocodes + 1 boundary + routes routinely
   bumps the default 5 TPS ceiling on a free key, so we soft-handle it
   here instead of dropping the vehicle. */
async function withRetry(fn, attempts = 4, baseDelay = 500) {
  let err;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      err = e;
      if (!/\b429\b|TooManyRequests/.test(e.message || '')) throw e;
      await sleep(baseDelay * (i + 1));
    }
  }
  throw err;
}

export default async function fleet(ctx, uc) {
  const accent          = ctx.caseColor(uc);
  const geofenceColor   = paramFor(uc, 'geofenceColor') || accent;
  const onRouteColor    = paramFor(uc, 'onRouteColor')  || ctx.color('positive');
  const idleColor       = paramFor(uc, 'idleColor')     || ctx.color('general');
  const alertColor      = paramFor(uc, 'alertColor')    || ctx.color('negative');
  const geofenceDash    = dashFor(paramFor(uc, 'geofenceStyle') || 'solid');
  const STROKE_COLOR    = cssVar('--s0', '#0C0C12');

  const colorFor = (status) => {
    switch (status) {
      case STATUS.ON_ROUTE: return onRouteColor;
      case STATUS.IDLE:     return idleColor;
      case STATUS.DELAYED:  return alertColor;
      case STATUS.OUTSIDE:  return alertColor;
      default:              return idleColor;
    }
  };

  ctx.setView({ center: [4.9000, 52.3650], zoom: 10.4, animate: true });

  // Dispatcher needs real road conditions to read delays in context.
  ctx.enableTrafficFlow();
  ctx.enableTrafficIncidents();

  // 1. Geocode every unique address once, then snap-route per vehicle —
  //    sequentially so 8 vans × 2 geocodes + traffic + boundary don't
  //    burst past TomTom's default 5 TPS rate limit. Cached lookups
  //    return instantly so idle vans (from === to) only pay once.
  const geocodeCache = new Map();
  const geocodeCached = async (query) => {
    if (geocodeCache.has(query)) return geocodeCache.get(query);
    const hits = await withRetry(() => geocode({ query, countrySet: 'NL', limit: 1 }));
    const hit = hits[0] || null;
    geocodeCache.set(query, hit);
    return hit;
  };

  const vehicles = [];
  for (const v of VEHICLES) {
    if (ctx.cancelled) return;
    try {
      const a = await geocodeCached(v.from);
      const b = v.from === v.to ? a : await geocodeCached(v.to);
      if (!a || !b) continue;
      if (v.from === v.to) {
        vehicles.push({ ...v, origin: a.position, dest: a.position, geojson: null, summary: { lengthInMeters: 0, travelTimeInSeconds: 0 } });
        continue;
      }
      const { geojson, summary } = await withRetry(() => calculateRoute({
        origin: a.position, dest: b.position,
      }));
      vehicles.push({ ...v, origin: a.position, dest: b.position, geojson, summary });
    } catch (err) {
      console.warn(`[fleet] skipping ${v.id} — ${err.message}`);
    }
  }
  if (ctx.cancelled) return;

  // 2. Operating-zone geofence — real Amsterdam municipality polygon.
  //    Solid stroke + tinted fill so the perimeter reads at a glance.
  const amsterdam = (await withRetry(() => geocode({
    query: 'Amsterdam', countrySet: 'NL', entityType: 'Municipality', limit: 1,
  })).catch(() => []))[0];
  if (ctx.cancelled) return;

  if (amsterdam?.boundaryId) {
    try {
      const boundary = await withRetry(() => fetchBoundary(amsterdam.boundaryId, { zoom: 11 }));
      if (ctx.cancelled) return;
      ctx.addSource('geofence', { type: 'geojson', data: boundary });
      // Casing — UI surface colour stroke at low opacity gives the
      // perimeter a soft halo so it reads against any basemap.
      ctx.addLayer({
        id: 'geofence-casing', type: 'line', source: 'geofence',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': STROKE_COLOR, 'line-width': 8, 'line-opacity': 0.6 },
      });
      ctx.addLayer({
        id: 'geofence-fill', type: 'fill', source: 'geofence',
        paint: { 'fill-color': geofenceColor, 'fill-opacity': 0.10 },
      });
      const fenceLinePaint = {
        'line-color': geofenceColor,
        'line-width': 3,
        'line-opacity': 0.95,
      };
      if (geofenceDash) fenceLinePaint['line-dasharray'] = geofenceDash;
      ctx.addLayer({
        id: 'geofence-line', type: 'line', source: 'geofence',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: fenceLinePaint,
      });
    } catch { /* boundary unavailable — skip the polygon, keep the markers */ }
  }

  // 3. Render the faint snapped route under each moving vehicle, so
  //    the viewer sees where it's headed. Idle vans and outside-zone
  //    vans don't show a future track (the dispatcher already knows).
  vehicles.forEach((v, i) => {
    if (!v.geojson) return;
    if (v.status !== STATUS.ON_ROUTE && v.status !== STATUS.DELAYED) return;
    ctx.addSource(`fleet-route-${i}`, { type: 'geojson', data: v.geojson });
    ctx.addLayer({
      id: `fleet-route-${i}-line`, type: 'line', source: `fleet-route-${i}`,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colorFor(v.status), 'line-width': OVERLAY_PATH_FAINT_WIDTH, 'line-opacity': 0.35 },
    });
  });

  // 4. Spawn each vehicle marker with a status-coloured pin + rich popup.
  vehicles.forEach(v => {
    const pinColor = colorFor(v.status);
    const line     = v.geojson?.geometry?.coordinates;
    const startLngLat = (v.speed > 0 && line)
      ? line[Math.floor(v.startFraction * (line.length - 1))]
      : (line ? line[Math.floor((v.startFraction || 1) * (line.length - 1))] : v.origin);

    const pills = [
      { text: STATUS_LABEL[v.status], tone: STATUS_TONE[v.status] },
    ];
    if (v.status === STATUS.DELAYED && v.delayMin) {
      pills.push({ text: `+${v.delayMin} min`, tone: 'warn' });
    }

    const rows = [
      ['Driver',   v.driver],
      ['Speed',    v.speed > 0 ? `${Math.round(v.speed * 3.6)} km/h` : 'Stopped'],
      ['Fuel',     `${v.fuel}%`],
      ['Load',     v.load],
    ];
    if (v.status === STATUS.ON_ROUTE && v.summary?.travelTimeInSeconds) {
      rows.push(['ETA', fmtClock(v.summary.travelTimeInSeconds)]);
    }
    if (v.status === STATUS.DELAYED) {
      rows.push(['Delay reason', v.delayReason || 'Unknown']);
    }
    if (v.status === STATUS.OUTSIDE) {
      rows.push(['Last seen', v.from]);
      rows.push(['Violation', 'Outside Amsterdam municipality polygon']);
    }

    const marker = ctx.addMarker({
      element: createPin(pinColor, 'truck'),
      anchor: 'bottom',
      popupHTML: infoCard({
        accent: pinColor,
        eyebrow: `Vehicle ${v.id}`,
        title: v.driver,
        pills,
        rows,
        footer: 'Live telemetry · TomTom Routing + Geofencing',
      }),
    }, startLngLat);

    if (v.status === STATUS.ON_ROUTE && line) {
      animateAlong({
        ctx, line, speedMps: v.speed, startFraction: v.startFraction, loop: true,
        onTick: ({ lngLat }) => marker.setLngLat(lngLat),
      });
    }
  });

  // 5. Fleet summary popup — aggregated counts by status, pinned at the
  //    geofence's centre so the dispatcher reads health in one glance.
  const counts = {
    [STATUS.ON_ROUTE]: 0,
    [STATUS.IDLE]:     0,
    [STATUS.DELAYED]:  0,
    [STATUS.OUTSIDE]:  0,
  };
  for (const v of vehicles) counts[v.status]++;
  const total = vehicles.length;

  ctx.addPopup(
    { offset: 14, anchor: 'top-right', closeButton: true, closeOnClick: false },
    [5.02, 52.41],
    infoCard({
      accent: geofenceColor,
      eyebrow: 'Fleet status',
      title: `${total} vehicles`,
      subtitle: 'Operating zone · Amsterdam municipality',
      pills: [
        { text: `${counts[STATUS.ON_ROUTE]} on route`,    tone: 'success' },
        { text: `${counts[STATUS.IDLE]} idle`,             tone: 'neutral' },
        { text: `${counts[STATUS.DELAYED]} delayed`,       tone: 'warn'    },
        { text: `${counts[STATUS.OUTSIDE]} outside zone`,  tone: 'danger'  },
      ],
      footer: 'Geofence · TomTom Admin Boundaries',
    })
  );
}
