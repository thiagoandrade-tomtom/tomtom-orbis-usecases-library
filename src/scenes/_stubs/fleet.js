/* Track your fleet — dispatcher view.

   Vehicles are tagged by status (on-route / idle / delayed / outside-zone)
   and the pin colour encodes the state. The Amsterdam municipality
   polygon, fetched live via Admin Boundaries, is the geofence — drawn
   with a solid stroke, and the tint is painted *outside* it rather than
   inside, so the operating zone stays the brightest thing on the map and
   everything beyond it reads as out of scope. Vans that ended up outside
   the polygon are highlighted with the alert colour, mirroring how a real
   geofence monitor would flag a violation.

   Every coordinate is geocoded at runtime; nothing is hand-placed on
   the map. */

import { infoCard } from '../../render/popup.js';
import { createPin } from '../../render/marker.js';
import { geocode, calculateRoute, fetchBoundary } from '../../map/services.js';
import { OVERLAY_PATH_FAINT_WIDTH } from '../../map/config.js';
import { animateAlong } from '../../map/geo.js';
import { paramFor } from '../../state.js';
import { casingFor, dashFor, fmtDuration } from '../_shared.js';

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

/* ------------------------------------------------------------------
   Inverted geofence mask. Instead of tinting the operating zone we tint
   everything around it: one world-spanning polygon with the zone punched
   out as a hole. The dispatcher's eye lands on the undimmed area, which
   is the half of the map that actually matters.
------------------------------------------------------------------- */

/* Outer ring of the mask. Latitude stops at ±85° — past that Web
   Mercator runs off to infinity and the tessellator gives up. */
const WORLD_RING = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];

/* Shoelace sign. MapLibre's fill tessellator classifies rings by winding
   relative to the first one: same direction starts a new polygon,
   opposite direction becomes a hole. So the world ring and the zone
   rings have to wind against each other or the "hole" just paints over
   the zone and the whole map goes flat. */
function signedArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum;
}

const wound = (ring, positive) =>
  (signedArea(ring) > 0) === positive ? ring : [...ring].reverse();

/* Every exterior ring in the boundary payload. Admin Boundaries returns
   a Polygon for most municipalities and a MultiPolygon wherever the
   territory is split (islands, exclaves), wrapped as a Feature, a
   FeatureCollection or a bare geometry depending on the zoom bucket — so
   normalise all of it here. Inner rings are dropped on purpose: a lake
   inside Amsterdam is still inside the operating zone. */
function exteriorRings(payload) {
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const geoms =
    data?.type === 'FeatureCollection' ? (data.features || []).map(f => f?.geometry)
    : data?.geometry ? [data.geometry]
    : [data];

  const rings = [];
  for (const g of geoms) {
    if (g?.type === 'Polygon') rings.push(g.coordinates?.[0]);
    else if (g?.type === 'MultiPolygon') for (const part of g.coordinates || []) rings.push(part?.[0]);
  }
  return rings.filter(r => Array.isArray(r) && r.length > 3);
}

/* Mix a hex colour toward black. A translucent overlay can only *add*
   light, so on the near-black dark basemap a mid-blue scrim makes the
   area outside the zone glow instead of recede — the exact opposite of
   what the mask is for. Crushing the geofence colour almost to black
   keeps a trace of the hue (so the Configure swatch still drives the
   scrim) while reading unambiguously as dimming. */
function towardBlack(hex, t) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return '#000000';
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
    .map(c => Math.round(c * (1 - t)).toString(16).padStart(2, '0'));
  return `#${ch.join('')}`;
}

/* Zone rings → scrim covering everything outside them. Returns null when
   there's no usable ring, so the caller can skip the layer and still draw
   the perimeter. */
function invertedMask(holes) {
  if (!holes.length) return null;
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [wound(WORLD_RING, true), ...holes.map(r => wound(r, false))],
    },
  };
}

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
  const STROKE_COLOR    = casingFor(accent);

  /* Scrim outside the zone. The light basemap takes the geofence colour
     straight — a cool veil at low opacity is enough to push everything
     beyond the zone back. The dark basemap needs the crushed variant at
     much higher opacity to dim rather than glow. */
  const isDark      = document.documentElement.getAttribute('data-theme') === 'dark';
  const maskColor   = isDark ? towardBlack(geofenceColor, 0.82) : geofenceColor;
  const maskOpacity = isDark ? 0.60 : 0.22;

  const colorFor = (status) => {
    switch (status) {
      case STATUS.ON_ROUTE: return onRouteColor;
      case STATUS.IDLE:     return idleColor;
      case STATUS.DELAYED:  return alertColor;
      case STATUS.OUTSIDE:  return alertColor;
      default:              return idleColor;
    }
  };

  /* Anchor the camera over Amsterdam while the boundary and the geocodes
     resolve. One fitBounds fires at the end over the union of the zone
     and every van, so nothing gets framed out. */
  ctx.setView({ center: [4.9000, 52.3550], zoom: 10.0, animate: false });

  // Dispatcher needs real road conditions to read delays in context.
  ctx.enableTrafficFlow();
  ctx.enableTrafficIncidents();

  /* Everything that has to stay on screen accumulates here as
     [west, south, east, north]. The zone is the largest contributor by
     far — framing on the vans alone used to cut the polygon in half. */
  const frame = [Infinity, Infinity, -Infinity, -Infinity];
  const growFrame = (p) => {
    if (!p) return;
    if (p[0] < frame[0]) frame[0] = p[0];
    if (p[1] < frame[1]) frame[1] = p[1];
    if (p[0] > frame[2]) frame[2] = p[0];
    if (p[1] > frame[3]) frame[3] = p[1];
  };

  // 1. Operating-zone geofence — real Amsterdam municipality polygon.
  //    Solid stroke + an inverted tint outside it, so the zone reads as
  //    the lit area and the perimeter still reads at a glance. Fetched
  //    before the vans so the zone paints early and its extents are
  //    known in time to drive the framing below.
  const amsterdam = (await withRetry(() => geocode({
    query: 'Amsterdam', countrySet: 'NL', entityType: 'Municipality', limit: 1,
  })).catch(() => []))[0];
  if (ctx.cancelled) return;

  if (amsterdam?.boundaryId) {
    try {
      const boundary = await withRetry(() => fetchBoundary(amsterdam.boundaryId, { zoom: 11 }));
      if (ctx.cancelled) return;
      ctx.addSource('geofence', { type: 'geojson', data: boundary });
      const rings = exteriorRings(boundary);
      for (const ring of rings) for (const p of ring) growFrame(p);
      // Scrim over everything the fleet isn't supposed to be in. Painted
      // first so the perimeter stroke and the van routes sit on top.
      const mask = invertedMask(rings);
      if (mask) {
        ctx.addSource('geofence-mask', { type: 'geojson', data: mask });
        ctx.addLayer({
          id: 'geofence-mask-fill', type: 'fill', source: 'geofence-mask',
          paint: { 'fill-color': maskColor, 'fill-opacity': maskOpacity },
        });
      }
      // Casing — UI surface colour stroke at low opacity gives the
      // perimeter a soft halo so it reads against any basemap.
      ctx.addLayer({
        id: 'geofence-casing', type: 'line', source: 'geofence',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': STROKE_COLOR, 'line-width': 8, 'line-opacity': 0.6 },
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

  // 2. Geocode every unique address once, then snap-route per vehicle —
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

  /* 3. Frame the zone and the whole fleet in one move. ctx.fitBounds pads
        by the live UI insets, so on desktop the content centres in the
        strip beside the detail panel rather than behind it. maxZoom keeps
        a single-van fleet from looking absurdly close. */
  for (const v of vehicles) { growFrame(v.origin); growFrame(v.dest); }
  if (isFinite(frame[0])) {
    const bounds = [[frame[0], frame[1]], [frame[2], frame[3]]];
    ctx.fitBounds(bounds, { duration: 700, maxZoom: 13 });
    ctx.markHomeBounds(bounds, { maxZoom: 13 });
  }

  // 4. Render the faint snapped route under each moving vehicle, so
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
      pills.push({ text: `+${fmtDuration(v.delayMin)}`, tone: 'warn' });
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

  ctx.setLegend({
    title: `Fleet status · ${total} vehicles`,
    items: [
      { color: onRouteColor, shape: 'dot', label: `${counts[STATUS.ON_ROUTE]} on route` },
      { color: idleColor,    shape: 'dot', label: `${counts[STATUS.IDLE]} idle` },
      { color: alertColor,   shape: 'dot', label: `${counts[STATUS.DELAYED]} delayed` },
      { html: `<span class="map-legend-swatch dot" style="color:${alertColor};outline:1.5px dashed ${alertColor};outline-offset:1px;"></span>`, label: `${counts[STATUS.OUTSIDE]} outside zone` },
    ],
  });
}
