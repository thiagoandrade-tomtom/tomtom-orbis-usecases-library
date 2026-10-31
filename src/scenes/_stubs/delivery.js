/* Live delivery dispatch — depot + multi-stop round trip, TSP-optimised.

   Routing API is called once with `computeBestOrder=true` and the depot
   pinned as both origin AND final destination, so TomTom solves the most
   efficient stop sequence and the van returns to base. The driver marker
   animates along the exact snapped polyline that's rendered, so the dot
   always tracks the road.

   The van is electric: every call carries a consumption model, so each
   leg comes back with the energy it uses and the panel can say what the
   run costs in kWh, not just km and minutes.

   The side panel lists the run as order cards on one rail: depart the
   depot → drive → drop → … → back at the depot. A dispatcher drags a card
   by its handle to change the run; that's a draft until they confirm it,
   then the route is recalculated in that exact order
   (`computeBestOrder=false`) and the panel says what the change costs
   against TomTom's fastest route. */

import { infoCard } from '../../render/popup.js';
import { createPin, createNumberPin, createMovingMarker, readableFg, ICONS } from '../../render/marker.js';
import { calculateMultiStopRoute } from '../../map/services.js';
import { OVERLAY_LINK_WIDTH } from '../../map/config.js';
import { animateAlong, cumulative, pointAtDistance } from '../../map/geo.js';
import { paramFor } from '../../state.js';
import { casingFor, cssVar, lineParams, HALO, fmtDurationSec } from '../_shared.js';

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
  shift:    '09:40',   // departure — the delivery windows are read against it
};

/* An electric delivery van: usable battery, charge at the start of the
   shift and a city-van consumption curve (kWh/100 km at 50, 80, 110 km/h)
   plus the cab's auxiliary load. Illustrative figures for a mid-size van. */
const VAN = {
  usable:   75,
  startKWh: 66,
  curve:    '50,22.0:80,26.0:110,33.0',
  auxKW:    1.5,
};
const ROUTE_VEHICLE = {
  vehicleEngineType: 'electric',
  constantSpeedConsumptionInkWhPerHundredkm: VAN.curve,
  currentChargeInkWh: VAN.startKWh,
  maxChargeInkWh: VAN.usable,
  auxiliaryPowerInkW: VAN.auxKW,
};

const STOPS = [
  { position: [4.898071, 52.356337], address: 'Govert Flinckstraat 251, 1073 BX Amsterdam', order: '#A-1042', customer: 'M. Visser',   items: 2, weight: '3.4 kg', window: '09:00 – 11:00', service: '2 min', signature: 'Required', status: 'Out for delivery' },
  { position: [4.895798, 52.360431], address: 'Nieuwe Looiersstraat 75, 1017 VB Amsterdam', order: '#A-1043', customer: 'L. Janssen',  items: 1, weight: '0.8 kg', window: '09:00 – 12:00', service: '2 min', signature: 'Optional', status: 'Out for delivery' },
  { position: [4.930133, 52.370346], address: 'Czaar Peterstraat 130, 1018 PV Amsterdam',   order: '#A-1044', customer: 'S. Bakker',   items: 4, weight: '7.1 kg', window: '10:00 – 12:00', service: '4 min', signature: 'Required', status: 'Delayed +6 min' },
  { position: [4.926288, 52.359124], address: 'Linnaeusstraat 89, 1093 EK Amsterdam',       order: '#A-1045', customer: 'K. de Vries', items: 1, weight: '0.5 kg', window: '10:00 – 13:00', service: '2 min', signature: 'Optional', status: 'Scheduled' },
  { position: [4.894012, 52.353722], address: 'Sarphatipark 24, 1072 PB Amsterdam',         order: '#A-1046', customer: 'P. Mulder',   items: 3, weight: '5.2 kg', window: '11:00 – 13:00', service: '3 min', signature: 'Required', status: 'Scheduled' },
  { position: [4.871467, 52.367752], address: 'Bilderdijkstraat 144, 1053 LB Amsterdam',    order: '#A-1047', customer: 'A. de Boer',  items: 2, weight: '2.6 kg', window: '11:00 – 14:00', service: '2 min', signature: 'Optional', status: 'Scheduled' },
];

const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtKm   = (m) => `${(m / 1000).toFixed(1)} km`;
const fmtMin  = fmtDurationSec;
const fmtKWh  = (k) => `${(Number(k) || 0).toFixed(1)} kWh`;
const pct     = (kwh) => Math.round((kwh / VAN.usable) * 100);
const kwhOf   = (summary) => summary?.batteryConsumptionInkWh || 0;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Today at a "HH:MM" clock time, in ms. */
const todayAt = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
const windowOf = (s) => {
  const [, a, b] = /(\d\d:\d\d)\D+(\d\d:\d\d)/.exec(s.window) || [];
  return a ? [todayAt(a), todayAt(b)] : [-Infinity, Infinity];
};
const serviceSec = (s) => (parseInt(s.service, 10) || 0) * 60;
const shortAddress = (s) => s.address.split(',')[0];

/* The dispatcher's own run, as order ids — module state so it survives the
   scene replays a theme or basemap swap runs. null = TomTom's best order. */
let keptOrder = null;

/* The map pins' own Lucide glyphs, so the panel's depot and van nodes are
   the same icons as on the map. */
const lucide = (icon, size = 12) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon.lucide}</svg>`;

/* The driver's avatar — a quiet two-tone silhouette in the online green,
   standing in for a photo. Sized by its container. */
const AVATAR = `<svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
  <circle cx="24" cy="24" r="24" style="fill: var(--dsp-avatar-bg, #E3F4EA)"/>
  <circle cx="24" cy="19" r="7.5" fill="#00A65E"/>
  <path d="M9.5 42c1.6-8 7.4-12.5 14.5-12.5S36.9 34 38.5 42a24 24 0 0 1-29 0Z" fill="#00A65E"/>
</svg>`;

/* Small inline glyphs for the panel, drawn with currentColor. */
const ICON = {
  depot: lucide(ICONS.building),
  van:   lucide(ICONS.pkg, 14),
  grip:  '<svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="11" r="1.2"/><circle cx="7" cy="11" r="1.2"/></g></svg>',
  spark: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M6 1.5 7.1 4.9 10.5 6 7.1 7.1 6 10.5 4.9 7.1 1.5 6l3.4-1.1L6 1.5ZM11 9l.5 1.5L13 11l-1.5.5L11 13l-.5-1.5L9 11l1.5-.5L11 9Z" fill="currentColor"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="m2.5 7.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/* The "TomTom is working" dots: small dots that glide along the route
   while a new run is routing. Spaced and paced in screen pixels, so they
   read the same at any zoom. */
const FLOW_GAP_PX   = 16;
const FLOW_SPEED_PX = 56;   // dots, per second
const FLOW_WAVE_PX  = 320;  // a soft band of light, this long on screen…
const FLOW_WAVE_SPEED_PX = 180;  // …sweeping ahead of the dots
const FLOW_FADE_MS  = 260;  // in and out
const FLOW_MAX      = 1500; // dots, whatever the zoom
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Match each non-return leg's terminal point back to its stop — the visit
   order TomTom chose. NOT from optimizedWaypoints: observed live against
   the Routing API, the (providedIndex, optimizedIndex) pairs can disagree
   with the sequence the legs actually trace, so the labels would follow a
   different order than the polyline. The legs ARE the polyline. */
function orderFromLegs(legs, stops) {
  const nearest = ([x, y]) => {
    let best = -1, bestD = Infinity;
    stops.forEach((s, i) => {
      const d = (s.position[0] - x) ** 2 + (s.position[1] - y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };
  const seen = new Set();
  const order = [];
  for (const leg of legs.slice(0, -1)) {
    const i = nearest(leg.points[leg.points.length - 1]);
    if (i >= 0 && !seen.has(i)) { seen.add(i); order.push(stops[i]); }
  }
  return order.length === stops.length ? order : null;
}

export default async function delivery(ctx, uc) {
  const { color: accent, width: lineWidth, dashArray } = lineParams(uc, { defaultColor: ctx.caseColor(uc) });
  const STROKE_COLOR = casingFor(accent);
  const depotColor  = ctx.color('general');      // Neutral grey — infrastructure
  // Green — driver online, position live. A status, so TomTom's success
  // token, the same in both themes — not the case palette's `positive`,
  // which swaps fern for lime on dark. White icon on it.
  const driverColor = cssVar('--success', '#00A65E');
  const onDriver = '#FFFFFF';
  const nodeFg = readableFg(accent);

  const depot = DEPOT;
  const stops = STOPS;
  const byId = new Map(stops.map(s => [s.order, s]));
  const departAt = todayAt(depot.shift);

  // Fit the depot + all stops in view rather than fixing a zoom, so the
  // framing adapts if the address list shifts. No explicit padding — a
  // flat inset would centre the run behind the detail panel; fitBounds
  // defaults to the panel-aware insets instead.
  const lons = [depot.position[0], ...stops.map(s => s.position[0])];
  const lats = [depot.position[1], ...stops.map(s => s.position[1])];
  const runBounds = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
  ctx.fitBounds(runBounds, { maxZoom: 12 });
  // Layers only — the run is always routed on live traffic.
  if (paramFor(uc, 'trafficFlow') !== false) ctx.enableTrafficFlow();
  if (paramFor(uc, 'trafficIncidents') !== false) ctx.enableTrafficIncidents();

  /* One route for a run: TomTom's best order (sequence = null), or the
     dispatcher's sequence as given. Depot pinned at both ends. */
  const route = async (sequence) => {
    const visit = sequence || stops;
    const points = [depot.position, ...visit.map(s => s.position), depot.position];
    const r = await calculateMultiStopRoute({ points, computeBestOrder: !sequence, vehicle: ROUTE_VEHICLE });
    const order = sequence || orderFromLegs(r.legs, stops);
    if (!order) throw new Error('Could not read the visit order from the legs');
    return { order, legs: r.legs, summary: r.summary };
  };

  // Best order — the yardstick for any reordering — alongside the order the
  // drops came in, so the panel can say what TomTom's optimisation saved.
  // If both fail, straight spokes so the scene still shows the run.
  const settle = (p, what) => p.catch(err => { console.warn(`[delivery] ${what} routing failed: ${err.message}`); return null; });
  const kept = keptOrder?.map(id => byId.get(id));
  const wantKept = kept?.length === stops.length && kept.every(Boolean);
  let [best, received, plan] = await Promise.all([
    settle(route(null), 'best-order'),
    settle(route(stops), 'received-order'),
    wantKept ? settle(route(kept), 'kept-order') : null,
  ]);
  if (ctx.cancelled) return;
  if (!plan) keptOrder = null;
  plan ||= best || received;

  /* What one run saves over another — km, minutes and kWh, rounded first
     so a sign always matches the number shown. */
  const savingOf = (from, to, vs) => from && to && {
    vs,
    dm: Math.round((from.summary.lengthInMeters - to.summary.lengthInMeters) / 100) * 100,
    ds: Math.round((from.summary.travelTimeInSeconds - to.summary.travelTimeInSeconds) / 60) * 60,
    dk: Math.round((kwhOf(from.summary) - kwhOf(to.summary)) * 10) / 10,
  };
  let saving = savingOf(received, best, 'the order received');

  // Route line — one source; each plan swaps its data. Split into two
  // features so the return-to-depot leg can sit at lower opacity: the
  // active delivery legs are what the dispatcher tracks; the return is
  // just the wrap-up.
  ctx.addSource('delivery-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // Each leg keeps to the right of its own direction, half a line over, so
  // where the run passes a street out and back the two read as lanes side
  // by side instead of one line drawn twice. Arrows and the routing dots
  // ride the same lane.
  const LANE_PX = (lineWidth + HALO) / 2;
  // Casing stays solid so the return leg still reads as a real route on
  // the map; only the colour fill fades.
  ctx.addLayer({
    id: 'delivery-route-casing', type: 'line', source: 'delivery-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': STROKE_COLOR,
      'line-width': lineWidth + HALO,
      'line-opacity': 0.80,
      'line-offset': LANE_PX,
    },
  });
  const dLinePaint = {
    'line-color': accent,
    'line-width': lineWidth,
    'line-opacity': ['match', ['get', 'kind'], 'return', 0.60, 1],
    'line-offset': LANE_PX,
  };
  if (dashArray) dLinePaint['line-dasharray'] = dashArray;
  ctx.addLayer({
    id: 'delivery-route-line', type: 'line', source: 'delivery-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: dLinePaint,
  });
  /* Direction of travel — chevrons along the line, so the legs out and the
     leg back read apart where they share a street (arrows both ways there,
     which is the truth). Placed by MapLibre, so they hold still on zoom.
     An SDF, so its colour is set on the layer; removed on teardown — the
     ctx does not track images. */
  const CHEVRON = 'delivery-chevron';
  if (!ctx.ml.hasImage(CHEVRON)) {
    const px = 2, w = 16 * px, h = 16 * px;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.strokeStyle = '#000'; g.lineWidth = 2.6 * px; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(5.5 * px, 3.5 * px); g.lineTo(10.5 * px, 8 * px); g.lineTo(5.5 * px, 12.5 * px); g.stroke();
    ctx.ml.addImage(CHEVRON, g.getImageData(0, 0, w, h), { pixelRatio: px, sdf: true });
  }
  ctx.onTeardown(() => { try { ctx.ml.hasImage(CHEVRON) && ctx.ml.removeImage(CHEVRON); } catch {} });
  const ARROW_OPACITY = ['match', ['get', 'kind'], 'return', 0.55, 0.95];
  const ARROW_SIZE = Math.max(0.35, lineWidth / 18);   // ≈ 7 px on the default 8 px line
  ctx.addLayer({
    id: 'delivery-route-arrows', type: 'symbol', source: 'delivery-route',
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 48,
      'icon-image': CHEVRON,
      'icon-size': ARROW_SIZE,
      // Onto the leg's lane: the chevron points along the line, so its +y
      // is the right of travel. Offsets are in icon units — scaled by size.
      'icon-offset': [0, LANE_PX / ARROW_SIZE],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-keep-upright': false,
    },
    paint: { 'icon-color': nodeFg, 'icon-opacity': ARROW_OPACITY },
  });

  // Empty until TomTom is routing a new run, then dots glide along the line.
  ctx.addSource('delivery-route-flow', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  ctx.addLayer({
    id: 'delivery-route-flow', type: 'circle', source: 'delivery-route-flow',
    paint: {
      // Each dot swells a little as the band of light passes it.
      'circle-radius': ['*', Math.max(1.4, lineWidth / 5), ['+', 0.75, ['*', 0.35, ['get', 'o']]]],
      'circle-color': nodeFg,
      'circle-opacity': ['*', ['get', 'a'], ['+', 0.35, ['*', 0.65, ['get', 'o']]]],
      'circle-pitch-alignment': 'map',
    },
  });
  let flowLine = null;   // { line, cum } — the run on the map now
  let flowing = 0;       // the running animation's id; 0 = stopped
  let flowEnd = 0;       // when the fade-out began; 0 = running
  const startFlow = () => {
    if (!flowLine) return;
    if (flowing && flowEnd) { flowEnd = 0; return; }   // caught mid-fade: carry on
    if (flowing) return;
    // The dots tell the direction while they run; the arrows step aside.
    ctx.ml.setPaintProperty('delivery-route-arrows', 'icon-opacity', 0);
    const id = flowing = performance.now();
    flowEnd = 0;
    const begun = performance.now();
    let shift = 0, last = begun;
    const tick = (now) => {
      if (ctx.cancelled || flowing !== id) return;
      const dt = (now - last) / 1000;
      last = now;
      if (!reducedMotion()) shift += dt;
      const a = flowEnd
        ? Math.max(0, 1 - (now - flowEnd) / FLOW_FADE_MS)
        : Math.min(1, (now - begun) / FLOW_FADE_MS);
      if (flowEnd && a === 0) {
        flowing = 0;
        ctx.ml.getSource('delivery-route-flow')?.setData({ type: 'FeatureCollection', features: [] });
        return;
      }
      // The run on the map now — a new route that lands mid-fade takes the dots.
      const { line, cum } = flowLine;
      const total = cum.at(-1);
      // Metres per screen pixel here, so spacing and pace hold at any zoom.
      const lat = ctx.ml.getCenter().lat;
      const mpp = 40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * 2 ** ctx.ml.getZoom());   // 512 px tiles
      const gap = Math.max(FLOW_GAP_PX * mpp, total / FLOW_MAX);
      const features = [];
      for (let d = (shift * FLOW_SPEED_PX * mpp) % gap; d < total; d += gap) {
        // The band of light, from where the dot is on screen — continuous in
        // space and time, so it never skips as the dots wrap.
        const phase = (d / mpp - shift * FLOW_WAVE_SPEED_PX) / FLOW_WAVE_PX;
        const o = 0.5 + 0.5 * Math.cos(phase * 2 * Math.PI);
        const { lngLat: [x, y], bearing } = pointAtDistance(line, cum, d);
        // Onto the lane — LANE_PX to the right of travel.
        const right = (bearing + 90) * Math.PI / 180, off = LANE_PX * mpp;
        const pt = [x + off * Math.sin(right) / (111320 * Math.cos(y * Math.PI / 180)), y + off * Math.cos(right) / 111320];
        features.push({ type: 'Feature', properties: { o: o * o, a }, geometry: { type: 'Point', coordinates: pt } });
      }
      ctx.ml.getSource('delivery-route-flow')?.setData({ type: 'FeatureCollection', features });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  // Fade out rather than vanish, on whichever route is drawn by then.
  const stopFlow = () => {
    if (flowing && !flowEnd) flowEnd = performance.now();
    ctx.ml.setPaintProperty('delivery-route-arrows', 'icon-opacity', ARROW_OPACITY);
  };

  if (!plan) {
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
    ctx.showError("Couldn't route the delivery run", { detail: 'Showing the drops as straight lines from the depot.' });
  }

  /* The run against the clock: each leg's drive (live traffic), a wait when
     the van is early for a window, then the service time at the door. */
  const timeline = (p) => {
    let t = departAt;
    const rows = p.order.map((s, i) => {
      const leg = p.legs[i]?.summary || {};
      const arrive = t + (leg.travelTimeInSeconds || 0) * 1000;
      const [open, close] = windowOf(s);
      t = Math.max(arrive, open) + serviceSec(s) * 1000;
      return { s, leg, arrive, wait: Math.max(0, open - arrive), late: Math.max(0, arrive - close) };
    });
    const ret = p.legs[p.order.length]?.summary || {};
    return { rows, ret, backAt: t + (ret.travelTimeInSeconds || 0) * 1000 };
  };

  // Depot pin — building icon in neutral grey to distinguish from the van.
  const depotMarker = ctx.addMarker({
    element: createPin(depotColor, 'building'),
    anchor: 'bottom',
    popupHTML: infoCard({ accent: depotColor, eyebrow: 'Depot · Round trip', title: depot.name, subtitle: depot.address, rows: [['Driver', depot.driver], ['Vehicle', depot.van]], footer: depot.fleet }),
  }, depot.position);

  let stopMarkers = new Map();   // order id → marker
  let driver = null;
  let stopDriver = null;
  let selected = null;           // order id
  /* Where the van is in the run: the leg it's driving (0 = depot → stop 1,
     n = back to the depot) and how far that leg's end still is. */
  let driverLeg = 0;
  let toGo = 0;
  let legEnds = [];              // distance along the line at each leg's end
  let panelStale = false;        // a leg changed mid-drag — re-render on drop
  let draft = null;              // order ids the dispatcher moved, not yet routed
  let sort = null;               // the card being dragged
  let deltaFresh = false;        // a new run just landed — pulse the tiles it changed
  let busy = false;
  let flight = 0;

  const drawPlan = () => {
    const { rows, ret, backAt } = timeline(plan);
    const legs = plan.legs;
    const n = plan.order.length;

    ctx.ml.getSource('delivery-route')?.setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'delivery' }, geometry: { type: 'LineString', coordinates: legs.slice(0, n).flatMap((l, i) => i === 0 ? l.points : l.points.slice(1)) } },
        ...(legs[n]?.points?.length
          ? [{ type: 'Feature', properties: { kind: 'return' }, geometry: { type: 'LineString', coordinates: legs[n].points } }]
          : []),
      ],
    });

    stopMarkers.forEach(m => m.remove());
    stopMarkers = new Map();
    rows.forEach(({ s, leg, arrive, wait, late }, i) => {
      const m = ctx.addMarker({
        element: createNumberPin(accent, i + 1),
        anchor: 'bottom',
        popupHTML: infoCard({
          accent,
          eyebrow: `Stop ${i + 1} of ${n} · ${s.order}`,
          title: s.customer,
          subtitle: s.address,
          rows: [
            ['ETA',           fmtTime(arrive)],
            ['Window',        s.window],
            ['From',          `${i ? `Stop ${i}` : 'Depot'} · ${fmtKm(leg.lengthInMeters || 0)} · ${fmtMin(leg.travelTimeInSeconds || 0)}`],
            ['Energy',        fmtKWh(kwhOf(leg))],
            ['Parcel',        `${s.items} item${s.items > 1 ? 's' : ''} · ${s.weight}`],
            ['Service time',  s.service],
            ['Signature',     s.signature],
          ],
          footer: late ? `Late · ${fmtMin(late / 1000)} past the window` : wait ? `Early · waits ${fmtMin(wait / 1000)} for the window` : `Status: ${s.status}`,
        }),
      }, s.position);
      m.getElement().addEventListener('click', () => { selected = s.order; renderPanel(); });
      stopMarkers.set(s.order, m);
    });
    // Re-append each stop marker's DOM node in REVERSE so Stop 1 ends up
    // the last child among stop pins → renders on top when nearby pins
    // overlap. Depot and driver are re-appended after, so they stay on top
    // of the whole stack.
    [...stopMarkers.values()].reverse().forEach(m => { const el = m.getElement(); el.parentElement?.appendChild(el); });

    depotMarker.getPopup()?.setHTML(infoCard({
      accent: depotColor,
      eyebrow: 'Depot · Round trip',
      title: depot.name,
      subtitle: depot.address,
      rows: [
        ['Dispatcher',     depot.dispatch],
        ['Driver',         depot.driver],
        ['Vehicle',        depot.van],
        ['Drops',          String(n)],
        ['Departs',        fmtTime(departAt)],
        ['Total distance', fmtKm(plan.summary.lengthInMeters)],
        ['Total drive',    fmtMin(plan.summary.travelTimeInSeconds)],
        ['Energy',         `${fmtKWh(kwhOf(plan.summary))} · back with ${pct(VAN.startKWh - kwhOf(plan.summary))}%`],
        ['Back at depot',  `${fmtTime(backAt)} · ${fmtKm(ret.lengthInMeters || 0)} from last stop`],
      ],
      footer: depot.fleet + (keptOrder ? ' · Dispatcher order' : ' · TSP-optimised'),
    }));
    const depotEl = depotMarker.getElement();
    depotEl.parentElement?.appendChild(depotEl);

    // Animated driver — distinct icon (truck) and colour (green, online) so it
    // reads against the stop pins and route line. Loops the depot → stops
    // → depot polyline; a new run restarts it from the depot.
    const line = legs.flatMap((l, i) => i === 0 ? l.points : l.points.slice(1));
    flowLine = { line, cum: cumulative(line) };
    stopDriver?.();
    driver?.remove();
    // The pulse says the position is live; the green, that the driver is online.
    const driverEl = createMovingMarker(driverColor, 'pkg');
    driverEl.classList.add('dsp-driver');
    driverEl.style.setProperty('--dsp-live', driverColor);
    driverEl.style.color = onDriver;
    driver = ctx.addMarker({
      element: driverEl,
      anchor: 'center',
      popupHTML: driverCard(),
    }, line[0]);
    let acc = 0;
    legEnds = legs.map(l => (acc += cumulative(l.points).at(-1)));
    driverLeg = -1;
    stopDriver = animateAlong({
      ctx, line, speedMps: 14, startFraction: 0.05, loop: true,
      onTick: ({ lngLat, distance }) => { driver.setLngLat(lngLat); trackDriver(distance); },
    });
  };

  const driverCard = () => {
    const n = plan.order.length;
    const next = plan.order[driverLeg];
    const battery = VAN.startKWh - usedSoFar();
    return infoCard({
      accent: driverColor,
      avatar: AVATAR,
      eyebrow: 'Driver · online',
      title: depot.driver,
      subtitle: `${depot.van} · electric`,
      rows: [
        ['Heading to', next ? `Stop ${driverLeg + 1} · ${next.customer}` : 'Depot'],
        ['To go',      fmtKm(toGo)],
        ['Delivered',  `${Math.max(0, Math.min(driverLeg, n))} of ${n}`],
        ['Battery',    `${pct(battery)}% · ${fmtKWh(battery)}`],
        ['Back at depot', fmtTime(timeline(plan).backAt)],
      ],
      footer: 'Telematics · live position',
    });
  };
  /* Energy used so far — every leg behind the van, and the share of this
     one it has driven. */
  const usedSoFar = () => {
    if (!plan || driverLeg < 0) return 0;
    const legs = plan.legs;
    const done = legs.slice(0, driverLeg).reduce((k, l) => k + kwhOf(l.summary), 0);
    const len = legEnds[driverLeg] - (legEnds[driverLeg - 1] || 0);
    return done + kwhOf(legs[driverLeg]?.summary) * (len ? 1 - toGo / len : 0);
  };

  /* Each tick: which leg the van is on. A new leg re-renders the panel (a
     drop delivered); within a leg only the distance to go changes. */
  let shownToGo = '';
  const trackDriver = (d) => {
    let leg = legEnds.findIndex(e => d < e);
    if (leg < 0) leg = legEnds.length - 1;
    toGo = Math.max(0, legEnds[leg] - d);
    const label = fmtKm(toGo);
    if (leg !== driverLeg) {
      driverLeg = leg;
      shownToGo = label;
      driver?.getPopup()?.setHTML(driverCard());
      if (sort) panelStale = true; else renderPanel();
    } else if (label !== shownToGo) {
      shownToGo = label;
      const el = document.querySelector('#map-side .dsp-togo');
      if (el) el.textContent = `${label} to go`;
      if (driver?.getPopup()?.isOpen()) driver.getPopup().setHTML(driverCard());
    }
  };

  /* ── Side panel ─────────────────────────────────────────── */
  const node = (inner, cls = '') => `<span class="dsp-node${cls}">${inner}</span>`;
  /* A drive between two nodes. The one the van is on wears the van and
     the distance still to go, and takes you to the van; the ones behind
     it are done. */
  const legRow = (leg, label, i, n) => {
    if (i === driverLeg) {
      return `<li class="dsp-step dsp-leg is-driving">${node(ICON.van, ' dsp-node-van')}
        <button type="button" class="dsp-leg-text dsp-leg-btn" data-act="driver" title="Show the van on the map"><b>${i < n ? `En route to stop ${i + 1}` : 'Returning to depot'}</b> · <span class="dsp-togo">${fmtKm(toGo)} to go</span></button></li>`;
    }
    return `<li class="dsp-step dsp-leg${i < driverLeg ? ' is-done' : ''}">${node('', ' dsp-node-leg')}
      <span class="dsp-leg-text">${label} ${fmtKm(leg.lengthInMeters || 0)} · ${fmtMin(leg.travelTimeInSeconds || 0)} · ${fmtKWh(kwhOf(leg))}${leg.trafficDelayInSeconds >= 60 ? ` · <span class="trip-delay">incl. ${fmtMin(leg.trafficDelayInSeconds)} traffic</span>` : ''}</span></li>`;
  };

  const fitBadge = ({ wait, late }) => late
    ? `<span class="dsp-fit is-late">Late ${fmtMin(late / 1000)}</span>`
    : wait >= 60000
      ? `<span class="dsp-fit is-wait">Waits ${fmtMin(wait / 1000)}</span>`
      : '<span class="dsp-fit is-ok">On time</span>';

  /* Two lines per drop — what a reorder changes: who, when, and whether
     that still fits the window. Order number, parcels and signature stay
     in the pin's card. The handle on the right drags the card; with the
     keyboard, ↑ ↓ on the handle move it. In a draft, every card from the
     first moved one on has no ETA yet — it waits for the new route. */
  const cardHtml = (s, i, n, r) => {
    const on = s.order === selected ? ' is-active' : '';
    const done = !draft && i < driverLeg;
    const wasAt = draft ? currentIds().indexOf(s.order) : i;
    const moved = wasAt !== i;
    const eta = r ? fmtTime(r.arrive) : '–:–';
    const badge = done ? '<span class="dsp-fit is-done">Delivered</span>'
      : moved ? `<span class="dsp-fit is-draft">Was stop ${wasAt + 1}</span>`
      : r ? fitBadge(r) : '<span class="dsp-fit is-draft">Not routed</span>';
    return `<li class="dsp-step dsp-stop${on}${r?.late ? ' is-late' : ''}${done ? ' is-done' : ''}${moved ? ' is-draft' : ''}" data-id="${esc(s.order)}">
      ${node(String(i + 1), ' dsp-node-stop')}
      <div class="dsp-card">
        <button type="button" class="dsp-row" data-act="select" title="${esc(s.order)} · show on the map">
          <span class="dsp-name">${esc(s.customer)}</span>
          <span class="dsp-eta-time${r ? '' : ' is-stale'}" title="Arrival">${eta}</span>
          <span class="dsp-sub"><span class="dsp-window" title="Delivery window">${esc(s.window.replace(/\s/g, ''))}</span> · ${esc(shortAddress(s))}</span>
          ${badge}
        </button>
        <button type="button" class="dsp-grip" data-grip aria-label="Reorder ${esc(s.customer)} — drag, or use the arrow keys" title="Drag to reorder"${!plan || busy ? ' disabled' : ''}>${ICON.grip}</button>
      </div>
    </li>`;
  };

  /* The optimisation, in the dispatcher's terms: TomTom's fastest route
     and what it saves, or the dispatcher's run, what it costs, and a way
     back. kWh too — the van is electric. */
  const joinParts = (parts) => parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  const savingText = () => {
    const parts = [];
    if (saving?.dm > 0) parts.push(`${fmtKm(saving.dm)} shorter`);
    if (saving?.ds > 0) parts.push(`${fmtMin(saving.ds)} faster`);
    if (saving?.dk > 0) parts.push(`${fmtKWh(saving.dk)} less energy`);
    return parts.length ? `${joinParts(parts)} than ${saving.vs}` : 'Already the best visit order for this run';
  };
  const compareHtml = () => {
    // A moved card is only a draft: the banner asks before TomTom routes it.
    if (draft) {
      const moved = draft.filter((id, i) => currentIds()[i] !== id).length;
      return `<div class="dsp-compare is-draft">
        <span class="dsp-compare-text"><b>New visit order</b><span class="dsp-compare-sub">${moved} drops moved · route it to see ETAs and energy</span></span>
        <span class="dsp-compare-actions">
          <button type="button" class="dsp-btn" data-act="cancel"${busy ? ' disabled' : ''}>Cancel</button>
          <button type="button" class="dsp-btn dsp-btn-opt" data-act="confirm"${busy ? ' disabled' : ''}>Calculate route</button>
        </span>
      </div>`;
    }
    if (!plan || !best) return '';
    if (!keptOrder) {
      return `<div class="dsp-compare is-best">
        <span class="dsp-opt-icon">${ICON.spark}</span>
        <span class="dsp-compare-text"><span class="dsp-compare-title"><b>Fastest delivery route</b><span class="dsp-tag">Optimized by TomTom</span></span>
          <span class="dsp-compare-sub">${savingText()}</span></span>
      </div>`;
    }
    const { dm, ds, dk } = savingOf(plan, best, '');
    const sign = (v, f) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${f(Math.abs(v))}`;
    // Drops this order makes late that the fastest route gets there in time.
    const lateOf = (r) => timeline(r).rows.filter(x => x.late).length;
    const extraLate = lateOf(plan) - lateOf(best);
    return `<div class="dsp-compare is-custom${ds > 0 || dk > 0 || extraLate > 0 ? ' is-worse' : ''}">
      <span class="dsp-compare-text"><b>Your order</b><span class="dsp-compare-sub">${sign(dm, fmtKm)} · ${sign(ds, fmtMin)} · ${sign(dk, fmtKWh)} against the fastest route${extraLate > 0 ? ` · <span class="dsp-compare-late">${extraLate} drop${extraLate > 1 ? 's' : ''} late</span>` : ''}</span></span>
      <span class="dsp-compare-actions"><button type="button" class="dsp-btn dsp-btn-opt" data-act="best" title="Let TomTom find the fastest visit order"${busy ? ' disabled' : ''}>${ICON.spark}Optimize route</button></span>
    </div>`;
  };

  const renderPanel = () => {
    const host = document.getElementById('map-side');
    const scroll = host?.scrollTop;
    const p = plan || { order: stops, legs: [], summary: { lengthInMeters: 0, travelTimeInSeconds: 0 } };
    const { rows, ret, backAt } = timeline(p);
    const n = rows.length;
    const late = rows.filter(r => r.late).length;
    const used = kwhOf(p.summary);
    // The dispatcher's own run, measured against the fastest one: each tile
    // carries its difference, red where the order costs, green where it saves.
    const delta = plan && best && keptOrder && !draft ? savingOf(plan, best, '') : null;
    const pulse = deltaFresh;
    deltaFresh = false;
    const statTile = (label, value, d, f) => {
      const tone = d > 0 ? ' is-worse' : d < 0 ? ' is-better' : '';
      return `<div class="trip-stat${tone}${tone && pulse ? ' is-new' : ''}"><span class="trip-stat-label">${label}</span><span class="trip-stat-value">${value}</span>${
        tone ? `<span class="dsp-stat-delta">${d > 0 ? '+' : '−'}${f(Math.abs(d))}</span>` : ''}</div>`;
    };
    // In a draft, ETAs hold only up to the first moved card.
    const order = draft ? draft.map(id => byId.get(id)) : p.order;
    const firstMoved = draft ? draft.findIndex((id, i) => currentIds()[i] !== id) : n;
    const cards = order.map((s, i) => {
      const r = i < firstMoved && plan ? rows[i] : null;
      return (plan && !draft ? legRow(rows[i].leg, 'Drive', i, n) : '') + cardHtml(s, i, n, r);
    }).join('');
    ctx.setSidePanel(`<div class="trip-card dsp-panel${busy ? ' is-busy' : ''}${draft ? ' is-draft' : ''}" style="--dsp-accent: ${accent}; --dsp-on-accent: ${nodeFg}; --dsp-depot: ${depotColor}; --dsp-on-depot: ${readableFg(depotColor)}; --dsp-live: ${driverColor}; --dsp-on-live: ${onDriver}">
      <div class="trip-head">
        <div class="dsp-head-row">
          <button type="button" class="dsp-driver-chip" data-act="driver" title="Show the van on the map">
            <span class="dsp-avatar">${AVATAR}</span>
            <span class="trip-eyebrow">${esc(depot.driver)} · ${esc(depot.van.split(' · ')[0])}</span>
          </button>
          <span class="dsp-live" title="Driver online · position streams live">Online · live</span>
        </div>
        <button type="button" class="trip-title" data-act="all" title="Show the whole run">${n} drops from Westhaven</button>
      </div>
      <div class="trip-stats">
        ${statTile('Distance', plan ? fmtKm(p.summary.lengthInMeters) : '—', delta?.dm, fmtKm)}
        ${statTile('Drive', plan ? fmtMin(p.summary.travelTimeInSeconds) : '—', delta?.ds, fmtMin)}
        ${statTile('Energy', plan && used ? fmtKWh(used) : '—', delta?.dk, fmtKWh)}
      </div>
      ${compareHtml()}
      <ol class="dsp-steps">
        <li class="dsp-step dsp-end${plan && !draft ? ' is-done' : ''}">${node(ICON.depot, ' dsp-node-end')}
          <span class="dsp-end-text"><span class="dsp-name">Depart depot · ${fmtTime(departAt)}</span>
            <span class="dsp-sub">Battery ${pct(VAN.startKWh)}% · ${fmtKWh(VAN.startKWh)}</span></span></li>
        ${cards}
        ${plan && !draft ? legRow(ret, 'Return', n, n) : ''}
        <li class="dsp-step dsp-end">${node(ICON.depot, ' dsp-node-end')}
          <span class="dsp-end-text"><span class="dsp-name">Back at depot${plan && !draft ? ` · ${fmtTime(backAt)}` : ''}</span>
            <span class="dsp-sub">${draft ? 'Route the new order to see the return' : `${used ? `Battery ${pct(VAN.startKWh - used)}% left · ` : ''}${late ? `${late} drop${late > 1 ? 's' : ''} outside the window` : 'every drop inside its window'}`}</span></span></li>
      </ol>
      <div class="trip-note">Departs ${fmtTime(departAt)} · drive times on live traffic · energy from an electric-van consumption model · ETAs add each drop's service time and any wait for its window · TomTom Routing API${keptOrder ? ', in your order' : ' with computeBestOrder'}</div>
    </div>`);
    if (host && scroll != null) host.scrollTop = scroll;
  };

  /* Where each card sits in the list now, so a new run can slide them into
     place. Relative to the list, so the banner changing height above it
     doesn't count as a move. */
  const cardTops = () => {
    const list = host?.querySelector('.dsp-steps');
    const top = list?.getBoundingClientRect().top ?? 0;
    return new Map([...(list?.querySelectorAll('.dsp-stop') || [])]
      .map(li => [li.dataset.id, li.getBoundingClientRect().top - top]));
  };
  const slideCards = (before, { flash = true, duration = 520 } = {}) => {
    if (!before || reducedMotion()) return;
    const now = cardTops();
    host?.querySelectorAll('.dsp-stop').forEach(li => {
      const dy = (before.get(li.dataset.id) ?? 0) - now.get(li.dataset.id);
      if (Math.abs(dy) < 1) return;
      if (flash) li.classList.add('is-moved');
      li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
        { duration, easing: 'cubic-bezier(.2, .7, .2, 1)' });
    });
  };

  /* While a draft waits, the route on the map is the old one — fade it. */
  const setRouteStale = (stale) => {
    if (!ctx.ml.getLayer('delivery-route-line')) return;
    ctx.ml.setPaintProperty('delivery-route-line', 'line-opacity', stale ? 0.3 : ['match', ['get', 'kind'], 'return', 0.60, 1]);
    ctx.ml.setPaintProperty('delivery-route-casing', 'line-opacity', stale ? 0.3 : 0.80);
    ctx.ml.setPaintProperty('delivery-route-arrows', 'icon-opacity', stale ? 0.25 : ARROW_OPACITY);
  };
  /* The banner holds the confirm — if a drop left it scrolled away, bring
     it back into view. */
  const revealBanner = () => {
    const b = host?.querySelector('.dsp-compare.is-draft');
    if (!b) return;
    const hb = host.getBoundingClientRect(), r = b.getBoundingClientRect();
    if (r.top < hb.top || r.bottom > hb.bottom) b.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  const setDraft = (ids) => {
    draft = ids && ids.join() !== currentIds().join() ? ids : null;
    setRouteStale(!!draft);
    renderPanel();
  };

  /* Route a new order — the dispatcher's (ids), or TomTom's fastest
     (null). Keeps the old run on screen, the line flowing, until the new
     one lands; a newer request wins over a slower older one. */
  let gen = 0;
  const reroute = async (ids) => {
    const sequence = ids && ids.map(id => byId.get(id));
    const token = ++gen;
    let before = null;
    busy = true;
    renderPanel();
    startFlow();
    ctx.beginLoading(sequence ? `Routing ${sequence.length} drops in your order…` : 'TomTom is finding the fastest route…');
    try {
      // An optimisation always asks TomTom again (traffic moves on); it
      // holds the flow for a beat so the change reads as work done.
      const [next] = await Promise.all([route(sequence), sequence ? null : wait(900)]);
      if (ctx.cancelled || token !== gen) return;
      before = cardTops();
      saving = sequence ? null : savingOf(plan, next, 'your order');
      if (!sequence) best = next;
      plan = next;
      keptOrder = ids;
      deltaFresh = true;
      draft = null;
      setRouteStale(false);
      ctx.endLoading();
      drawPlan();
    } catch (err) {
      if (ctx.cancelled || token !== gen) return;
      console.warn(`[delivery] re-route failed: ${err.message}`);
      ctx.endLoading();
      ctx.showError(sequence ? "Couldn't route that order" : "Couldn't find the fastest route", { detail: 'The run stays as it was.', retry: () => reroute(ids) });
    } finally {
      if (!ctx.cancelled && token === gen) {
        busy = false;
        stopFlow();
        renderPanel();
        slideCards(before);
      }
    }
  };
  const currentIds = () => plan ? plan.order.map(s => s.order) : stops.map(s => s.order);
  const shownIds = () => draft || currentIds();

  /* Fly to a stop and open its card where the flight lands. */
  const select = (id) => {
    selected = id;
    renderPanel();
    const m = stopMarkers.get(id);
    if (!m) return;
    stopMarkers.forEach(o => { if (o !== m && o.getPopup()?.isOpen()) o.togglePopup(); });
    driver?.getPopup()?.isOpen() && driver.togglePopup();
    ctx.setView({ center: byId.get(id).position, zoom: 15 });
    const token = ++flight;
    ctx.ml.once('moveend', () => {
      if (ctx.cancelled || token !== flight) return;
      if (!m.getPopup()?.isOpen()) m.togglePopup();
    });
  };
  /* Fly to the van where it is now and open its card. */
  const showDriver = () => {
    if (!driver) return;
    selected = null;
    renderPanel();
    stopMarkers.forEach(o => { if (o.getPopup()?.isOpen()) o.togglePopup(); });
    ctx.setView({ center: driver.getLngLat().toArray(), zoom: 15 });
    const token = ++flight;
    ctx.ml.once('moveend', () => {
      if (ctx.cancelled || token !== flight || !driver) return;
      driver.getPopup()?.setHTML(driverCard());
      if (!driver.getPopup()?.isOpen()) driver.togglePopup();
    });
  };
  const showAll = () => {
    selected = null;
    flight++;
    stopMarkers.forEach(o => { if (o.getPopup()?.isOpen()) o.togglePopup(); });
    ctx.fitBounds(runBounds, { maxZoom: 12, duration: 1200 });
    renderPanel();
  };

  const host = document.getElementById('map-side');
  const onClick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const id = b.closest('[data-id]')?.dataset.id;
    const act = b.dataset.act;
    if (act === 'all') showAll();
    else if (act === 'driver') showDriver();
    else if (act === 'best') { draft = null; setRouteStale(false); reroute(null); }
    else if (act === 'confirm') reroute(draft);
    else if (act === 'cancel') { const before = cardTops(); setDraft(null); slideCards(before, { flash: false }); }
    else if (act === 'select') select(id);
  };

  /* Keyboard reorder — ↑ ↓ on a card's handle move it one place. */
  const onKeyDown = (e) => {
    const grip = e.target.closest?.('[data-grip]');
    if (!grip || busy || !plan || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const id = grip.closest('[data-id]').dataset.id;
    const ids = shownIds().slice();
    const i = ids.indexOf(id);
    const j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const before = cardTops();
    setDraft(ids);
    slideCards(before, { flash: false, duration: 180 });
    revealBanner();
    host?.querySelector(`[data-id="${CSS.escape(id)}"] [data-grip]`)?.focus();
  };

  /* Pointer drag on the handle — mouse, pen and touch alike. The card
     follows the pointer; the others make room as it passes their middle.
     Dropping turns the new order into a draft to confirm. */
  const placeCards = (list, cards) => {
    const legs = [...list.querySelectorAll('.dsp-leg')];
    const end = list.lastElementChild;
    cards.forEach((c, i) => (legs[i] ? legs[i].after(c) : list.insertBefore(c, end)));
  };
  const onPointerDown = (e) => {
    const grip = e.target.closest?.('[data-grip]');
    if (!grip || grip.disabled || busy || !plan || e.button > 0) return;
    e.preventDefault();
    const li = grip.closest('.dsp-stop');
    grip.setPointerCapture(e.pointerId);
    sort = { li, list: li.parentElement, offset: e.clientY - li.getBoundingClientRect().top };
    li.classList.add('is-dragging');
  };
  const onPointerMove = (e) => {
    if (!sort) return;
    const { li, list } = sort;
    const cards = [...list.querySelectorAll('.dsp-stop')];
    const others = cards.filter(c => c !== li);
    const to = others.filter(c => { const r = c.getBoundingClientRect(); return r.top + r.height / 2 < e.clientY; }).length;
    if (to !== cards.indexOf(li)) {
      const before = new Map(others.map(c => [c, c.getBoundingClientRect().top]));
      others.splice(to, 0, li);
      placeCards(list, others);
      if (!reducedMotion()) before.forEach((y, c) => {
        const dy = y - c.getBoundingClientRect().top;
        if (Math.abs(dy) >= 1) c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
      });
    }
    li.style.transform = 'none';
    li.style.transform = `translateY(${e.clientY - sort.offset - li.getBoundingClientRect().top}px)`;
    // Near the panel's edges, scroll it so a card can travel the whole run.
    const hr = host.getBoundingClientRect();
    if (e.clientY < hr.top + 48) host.scrollTop -= 8;
    else if (e.clientY > hr.bottom - 48) host.scrollTop += 8;
  };
  const onPointerUp = () => {
    if (!sort) return;
    const { li, list } = sort;
    sort = null;
    li.style.transform = '';
    li.classList.remove('is-dragging');
    const ids = [...list.querySelectorAll('.dsp-stop')].map(c => c.dataset.id);
    panelStale = false;
    if (ids.join() === shownIds().join()) { renderPanel(); return; }
    setDraft(ids);
    revealBanner();
  };

  const listeners = { click: onClick, keydown: onKeyDown, pointerdown: onPointerDown, pointermove: onPointerMove, pointerup: onPointerUp, pointercancel: onPointerUp };
  Object.entries(listeners).forEach(([t, fn]) => host?.addEventListener(t, fn));
  ctx.onTeardown(() => Object.entries(listeners).forEach(([t, fn]) => host?.removeEventListener(t, fn)));

  if (plan) drawPlan();
  renderPanel();
  ctx.markHomeBounds(runBounds, { maxZoom: 12 });
}
