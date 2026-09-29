/* Long-distance EV trip — the route, its charging stops and a step list.

   One SDK call plans the whole trip: `calculateRoute` with an electric
   vehicle and charging preferences goes to TomTom's EV routing, which
   decides *where* to charge and *for how long* from the road network,
   live traffic and the car's energy budget. The SDK's RoutingModule draws
   the answer — route line, origin / destination, traffic on the route and
   one charging pin per stop — so nothing on the line is hand-drawn.

   Every leg of the answer ends at a charging stop or at the destination.
   A stop names the real charging park TomTom picked (uuid, operator,
   position, power), and its live availability is asked for that same
   uuid — the pin wears the result: green dot = a point free now, red =
   all busy, no dot = the park has no live feed. Same pins as "Find an EV
   charger" (render/ev-sprites.js).

   The side panel lists the trip as steps: depart → drive → charge → … →
   arrive. Every number in it comes from the response — leg length, drive
   time, energy used, battery on arrival, charge time, target charge.
   Clicking a step flies the map to it. */

import { RoutingModule } from '@tomtom-org/maps-sdk/map';
import { calculateRoute } from '@tomtom-org/maps-sdk/services';
import { infoCard } from '../../render/popup.js';
import { evStationCard, rowsFromAvailability } from '../../render/ev-card.js';
import { buildEvMarkerImages, evStateOf, spriteCanvas } from '../../render/ev-sprites.js';
import { geocode, chargingAvailability } from '../../map/services.js';
import { bindRouteTips } from '../../map/hover-tips.js';
import { classicEvRoutes } from '../../map/ev-route-classic.js';
import { API_BASE, API_KEY } from '../../map/config.js';
import { paramFor } from '../../state.js';
import { fmtDurationSec, lineParams } from '../_shared.js';

/* Car profiles — every figure is EV Database's (ev-database.org, the
   car page named in `src`): usable battery, peak DC power, the measured
   10 → 80% fast-charge time, real-world consumption in mild weather
   (city, and highway at a constant 110 km/h) and unladen EU weight. */
const CAR_PROFILES = {
  'tesla-m3-lr': { label: 'Tesla Model 3 Long Range AWD', usable: 75.0, dcPeak: 250, t10to80: 27, city: 107, highway: 163, weight: 1919, src: 'car/1591' },
  'tesla-my-lr': { label: 'Tesla Model Y Long Range AWD', usable: 75.0, dcPeak: 250, t10to80: 27, city: 115, highway: 176, weight: 2072, src: 'car/3104' },
  'vw-id4':      { label: 'VW ID.4 Pro',                  usable: 77.0, dcPeak: 175, t10to80: 28, city: 118, highway: 188, weight: 2144, src: 'car/2028' },
  'ioniq5':      { label: 'Hyundai Ioniq 5 Long Range',   usable: 74.0, dcPeak: 233, t10to80: 17, city: 129, highway: 208, weight: 2010, src: 'car/1662' },
  'bmw-i4':      { label: 'BMW i4 eDrive40',              usable: 80.7, dcPeak: 207, t10to80: 32, city: 109, highway: 166, weight: 2125, src: 'car/1252' },
  'mg4':         { label: 'MG4 Electric 64 kWh',          usable: 61.7, dcPeak: 142, t10to80: 25, city: 115, highway: 187, weight: 1726, src: 'car/1708' },
  'byd-dolphin': { label: 'BYD Dolphin 60.4 kWh',         usable: 60.5, dcPeak: 110, t10to80: 36, city: 116, highway: 192, weight: 1733, src: 'car/3297' },
  'byd-surf':    { label: 'BYD Dolphin Surf 43.2 kWh',    usable: 43.2, dcPeak: 85,  t10to80: 32, city: 108, highway: 180, weight: 1465, src: 'car/3195' },
  'zoe':         { label: 'Renault Zoe ZE50 R135',        usable: 52.0, dcPeak: 46,  t10to80: 56, city: 112, highway: 186, weight: 1577, src: 'car/1205' },
};
const DEFAULT_CAR = 'tesla-m3-lr';

/* Consumption in kWh / 100 km at 50, 110 and 130 km/h. 50 and 110 are
   the published city and highway figures; 130 km/h — the motorway limit
   on most of the continent — comes from the usual rolling + drag model,
   E(v) = r + a·v², fitted through those two points. */
function consumptionFor(car) {
  const e50 = car.city / 10, e110 = car.highway / 10;
  const a = (e110 - e50) / (110 ** 2 - 50 ** 2);
  const r = e50 - a * 50 ** 2;
  return [[50, e50], [110, e110], [130, r + a * 130 ** 2]]
    .map(([speedKMH, kwh]) => ({ speedKMH, consumptionUnitsPer100KM: Math.round(kwh * 10) / 10 }));
}

/* Charging curve — how much power the battery takes at each charge level.
   The shape is the usual one: peak power up to 20%, then a steady taper,
   P(soc) = peak · e^(−k·(soc − 20%)). `k` is solved so the 10 → 80% time
   equals the car's measured one, so a stop's charging time is anchored
   on a real figure, not on a guess.

   TomTom reads each batteryCurve point as "this power from this charge
   level up to the next point" (checked against its returned charging
   times), so the time is integrated the same way here. */
const CURVE_STEPS = Array.from({ length: 20 }, (_, i) => i * 5);   // 0, 5 … 95% — the API takes 20 points
function batteryCurveFor(car) {
  const powerAt = (soc, k) => car.dcPeak * (soc <= 20 ? 1 : Math.exp(-k * (soc - 20)));
  const minutes10to80 = (k) => {
    let t = 0;
    for (let soc = 10; soc < 80; soc += 0.1) {
      const step = CURVE_STEPS.filter(s => s <= soc).pop();
      t += (car.usable * 0.001) / powerAt(step, k) * 60;
    }
    return t;
  };
  let lo = 0, hi = 0.2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (minutes10to80(mid) > car.t10to80) hi = mid; else lo = mid;
  }
  const k = (lo + hi) / 2;
  return CURVE_STEPS.map(soc => ({
    stateOfChargeInkWh: Math.round(car.usable * soc) / 100,
    maxPowerInkW: Math.round(powerAt(soc, k) * 10) / 10,
  }));
}

/* The SDK's electric vehicle for one profile. Every car here charges DC
   over CCS; TomTom adds its default 60 s per stop to plug in and start.

   `reserveKWh` is the safety margin, and TomTom enforces it natively: the
   plan never arrives at a charger or at the destination with less. The
   router charges only as much as the next stretch needs on top of it —
   charging past ~80% is slow, so topping up to 100% would lengthen the
   trip — which is why a stop can be a few minutes. */
function vehicleFor(car, startKWh, reserveKWh) {
  return {
    engineType: 'electric',
    model: {
      dimensions: { weightKG: car.weight },
      engine: {
        charging: {
          maxChargeKWH: car.usable,
          batteryCurve: batteryCurveFor(car),
          chargingConnectors: [{ currentType: 'DC', plugTypes: ['Combo_to_IEC_62196_Type_2_Base'], maxPowerInkW: car.dcPeak }],
        },
        consumption: { speedsToConsumptionsKWH: consumptionFor(car) },
      },
    },
    state: { currentChargeInkWh: startKWh },
    preferences: { chargingPreferences: { minChargeAtDestinationInkWh: reserveKWh, minChargeAtChargingStopsInkWh: reserveKWh } },
  };
}

/* The selected charging pin stands ~56 px above its point. A card opening
   upward clears the pin plus a gap; one flipped below or to the side only
   has to clear the point. */
const PIN_H = 56, GAP = 12;
const PIN_POPUP_OFFSET = {
  'top': [0, GAP], 'top-left': [0, GAP], 'top-right': [0, GAP],
  'bottom': [0, -(PIN_H + GAP)], 'bottom-left': [0, -(PIN_H + GAP)], 'bottom-right': [0, -(PIN_H + GAP)],
  'left': [18, -PIN_H / 2], 'right': [-18, -PIN_H / 2], 'center': [0, -PIN_H / 2],
};

const STOP_ZOOM = 14.5;   // close enough to see the park's access road
const END_ZOOM  = 13;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtKm  = m => `${Math.round(m / 1000)} km`;
const fmtHr  = fmtDurationSec;
// A very short charge never reads as "0 min".
const fmtMin = s => fmtDurationSec(Math.max(60, Number(s) || 0));
const fmtKWh = k => `${Math.round(k)} kWh`;
const pct    = (kwh, max) => Math.round((kwh / max) * 100);

const fmtPlug = p => String(p || '')
  .replace(/^Combo_to_IEC_62196_Type_2_Base$/, 'CCS Combo 2')
  .replace(/^IEC_62196_Type_2.*/, 'Type 2')
  .replace(/^Chademo$/i, 'CHAdeMO')
  .replace(/_/g, ' ');

// nearbyServices types → words.
const SERVICE_LABEL = {
  restaurant: 'Restaurant', publicToilet: 'Toilets', shop: 'Shop', cafe: 'Café',
  hotel: 'Hotel', petrolStation: 'Fuel', parking: 'Parking', restArea: 'Rest area',
};
const serviceLabel = t => SERVICE_LABEL[t] || String(t).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());

/* One RoutingModule per map, reused across scene runs — each get() adds
   its own sources and layers, so a fresh one per run would pile them up. */
const routingModules = new WeakMap();
// The scene run that currently owns each map's module — a superseded run
// must not clear what a newer one has already drawn.
const routingOwner = new WeakMap();
// The SDK route line's own opacity, to restore after the battery view.
const sdkLineOpacity = new WeakMap();
function routingFor(map) {
  if (!routingModules.has(map)) {
    // A failed init is not cached — the next run tries again.
    routingModules.set(map, RoutingModule.get(map).catch((err) => { routingModules.delete(map); throw err; }));
  }
  return routingModules.get(map);
}

function bboxOf(coords) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

/* Small inline glyphs for the step list, drawn with currentColor. */
const ICON = {
  bolt: '<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="M8 1 2.5 8H7l-1 5 5.5-7H7l1-5Z" fill="currentColor"/></svg>',
  flag: '<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 13V1.5M3 2h7.5L9 4.75 10.5 7.5H3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>',
};

/* Battery level → how much of the route colour is left. A charge gauge
   in the line itself: full = the solid route colour, drained = a neutral
   grey inside the route's outline. One hue on purpose — the reds and
   ambers of traffic keep their meaning. Opaque, not translucent: over the
   SDK's dark outline a see-through blue barely changed. */
const hexRgb = (hex) => {
  const h = String(hex).replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) || 0);
};
const DRAINED = { dark: [86, 92, 104], light: [196, 201, 209] };
let drainedRgb = DRAINED.light;
const chargeColor = (rgb, pct) => {
  const t = Math.max(0, Math.min(100, pct)) / 100;
  return `rgb(${rgb.map((c, i) => Math.round(drainedRgb[i] + (c - drainedRgb[i]) * t)).join(', ')})`;
};
const chargeCss = (rgb, from, to) => `linear-gradient(to bottom, ${chargeColor(rgb, from)}, ${chargeColor(rgb, to)})`;

/* Planned trips, reused while the inputs are the same — so a colour or
   theme change redraws without planning the trip again. */
const TRIP_TTL_MS = 10 * 60 * 1000;
const tripCache = new Map();   // key → { t, promise }
function planTrip(key, plan) {
  const hit = tripCache.get(key);
  if (hit && Date.now() - hit.t < TRIP_TTL_MS) return hit.promise;
  const promise = plan().catch((err) => { tripCache.delete(key); throw err; });
  tripCache.set(key, { t: Date.now(), promise });
  return promise;
}

export default async function multistop(ctx, uc) {
  const { color: accent, width: lineWidth } = lineParams(uc, { defaultColor: ctx.caseColor(uc) });
  // The SDK's route line comes in three widths.
  const routeWidth = lineWidth <= 5 ? 's' : lineWidth >= 11 ? 'l' : 'm';
  const fromQ   = paramFor(uc, 'from');
  const toQ     = paramFor(uc, 'to');
  const car     = CAR_PROFILES[paramFor(uc, 'car')] || CAR_PROFILES[DEFAULT_CAR];
  // Start charge is a share of the usable battery — 100% = full.
  const startKWh = car.usable * Math.min(100, Number(paramFor(uc, 'startCharge') || 100)) / 100;
  // Never plan below this share of the battery — room for a jam or a detour.
  const reservePct = Number(paramFor(uc, 'reserve') || 20);
  const reserveKWh = Math.round(car.usable * reservePct) / 100;
  const byBattery = (paramFor(uc, 'routeStyle') || 'battery') === 'battery';
  const ml = ctx.ml;

  // 1. Geocode start + finish.
  const [fromHits, toHits] = await Promise.all([
    geocode({ query: fromQ, limit: 1 }).catch(() => []),
    geocode({ query: toQ,   limit: 1 }).catch(() => []),
  ]);
  if (ctx.cancelled) return;
  const origin = fromHits[0]?.position;
  const dest   = toHits[0]?.position;
  if (!origin || !dest) return;
  const fromName = fromHits[0]?.name || fromQ;
  const toName   = toHits[0]?.name || toQ;

  // Straight-line frame first, so both ends are on screen while TomTom plans.
  ctx.fitBounds(bboxOf([origin, dest]), { duration: 0 });

  /* Live traffic context. In the battery view a drained stretch is a
     faint trace, and the flow overlay's reds would show through it — so
     that view keeps the incidents only; the route shows its own traffic. */
  if (!byBattery) ctx.enableTrafficFlow();
  ctx.enableTrafficIncidents();

  // 2. Plan the trip — charging stops included.
  let routes = null, error = null;
  try {
    /* The SDK plans on Orbis routing. A key without it answers 401 / 403;
       the same request then goes to the classic endpoint, which such keys
       usually have (see map/ev-route-classic.js). */
    routes = await planTrip(JSON.stringify([origin, dest, car.label, startKWh, reserveKWh]), () => calculateRoute({
      locations: [origin, dest],
      costModel: { traffic: 'live' },
      vehicle: vehicleFor(car, startKWh, reserveKWh),
    }).catch((err) => {
      if (err?.status !== 401 && err?.status !== 403) throw err;
      console.info('[multistop] Orbis EV routing not enabled on this key — using the classic endpoint');
      return classicEvRoutes({
        apiBase: API_BASE, apiKey: API_KEY, origin, dest,
        consumption: consumptionFor(car), batteryCurve: batteryCurveFor(car),
        maxKWh: car.usable, dcPeak: car.dcPeak, weight: car.weight, startKWh, reserveKWh,
      }).then(r => Object.assign(r, { endpoint: 'classic' }));
    }));
  } catch (err) {
    error = err.message;
    console.warn('[multistop] EV routing failed:', err.message);
  }
  if (ctx.cancelled) return;
  const route = routes?.features?.[0];

  if (!route) {
    ctx.addPopup(
      { offset: 0, anchor: 'center', closeButton: true },
      origin,
      infoCard({
        accent, eyebrow: 'Routing failed', title: "TomTom couldn't plan this trip",
        rows: [
          ['From',   fromHits[0]?.address || fromQ],
          ['To',     toHits[0]?.address || toQ],
          ['Reason', String(error || 'no route').slice(0, 120)],
        ],
        footer: 'Try a closer destination, or a higher start charge.',
      })
    );
    return;
  }

  const coords = route.geometry.coordinates;
  const legs = route.properties.sections.leg || [];
  const sum = route.properties.summary;

  /* Charging stops, straight from each leg's chargingInformationAtEndOfLeg:
     the park's own point, and its uuid as the Charging Availability id. */
  const stops = legs.map((leg, i) => {
    const info = leg.summary.chargingInformationAtEndOfLeg;
    if (!info) return null;
    const p = info.properties || {};
    return { legIndex: i, leg, pos: info.geometry.coordinates, p, uuid: p.chargingParkUuid || p.chargingParkId, live: undefined };
  }).filter(Boolean);
  const stopByUuid = new Map(stops.map(s => [s.uuid, s]));

  // 3. Draw — the SDK's route, waypoints and charging pins.
  const dotColors = buildEvMarkerImages(ml);
  const haveEvIcons = Boolean(dotColors);
  const chargingIcon = stop => {
    const s = stopByUuid.get(stop?.properties?.chargingParkId || stop?.properties?.chargingParkUuid);
    return `ev-pin-${evStateOf(s?.live)}`;
  };
  const routingConfig = () => ({
    theme: { mainColor: accent, routeWidth },
    summaryBubbles: { visible: false },
    ...(haveEvIcons ? { chargingStops: { icon: { mapping: { basedOn: 'custom', fn: chargingIcon } } } } : {}),
  });

  routingOwner.set(ctx.map, ctx);
  const routing = await routingFor(ctx.map);
  if (ctx.cancelled) return;
  routing.applyConfig(routingConfig());
  await routing.showWaypoints([origin, dest]);
  await routing.showRoutes(routes);
  const clearMine = () => {
    if (routingOwner.get(ctx.map) !== ctx) return;
    try { routing.clearRoutes(); routing.clearWaypoints(); } catch {}
  };
  if (ctx.cancelled) { clearMine(); return; }
  ctx.onTeardown(clearMine);
  // Toll roads and traffic on the route explain themselves on hover.
  bindRouteTips(ctx, route);

  /* The step list wears the map's own icons: the SDK's start / finish
     waypoints (in the route colour) and TomTom's charging icon with the
     live status dot. Read straight from the style's images. */
  const iconUrls = new Map();
  // Only a found image is cached: the SDK can add a waypoint sprite a beat
  // after showWaypoints resolves, and the next render should pick it up.
  const spriteUrl = (id) => {
    if (!iconUrls.has(id)) {
      const url = id && spriteCanvas(ml, id)?.toDataURL();
      if (!url) return null;
      iconUrls.set(id, url);
    }
    return iconUrls.get(id);
  };
  const wpSource = ml.getStyle().layers.find(l => /-routeWaypointSymbol$/.test(l.id))?.source;
  const wpIcons = {};
  try {
    for (const f of (await ml.getSource(wpSource)?.getData())?.features || []) wpIcons[f.properties.indexType] = f.properties.iconID;
  } catch {}
  if (ctx.cancelled) return;
  const nodeImg = (id, fallback) => {
    const url = spriteUrl(id);
    return url ? `<span class="trip-node trip-node-img"><img src="${url}" alt=""></span>` : `<span class="trip-node">${fallback}</span>`;
  };

  /* The SDK labels its pins in black — unreadable on the dark basemap.
     Same label colours as the pins of "Find an EV charger". */
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  for (const l of ml.getStyle().layers) {
    if (!/-(routeChargingStopSymbol|routeWaypointLabel)$/.test(l.id)) continue;
    ml.setPaintProperty(l.id, 'text-color', dark ? '#FFFFFF' : '#1A1F2A');
    ml.setPaintProperty(l.id, 'text-halo-color', dark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)');
    ml.setPaintProperty(l.id, 'text-halo-width', 1.4);
  }

  /* Battery view — the charge along the trip, as how full the route
     colour is. TomTom returns the charge at departure, on arrival at each
     stop, after each charge and at the destination; between those the
     level is interpolated by distance.

     One line per leg, not one for the trip: MapLibre bakes a gradient into
     a texture of limited width, so over 500 km the jump at a charger
     smeared across kilometres. Per leg, each line starts exactly at the
     charged level. Butt caps, so translucent legs don't double up where
     they meet. */
  const legStartKWh = i => i === 0 ? startKWh
    : (legs[i - 1].summary.chargingInformationAtEndOfLeg?.properties?.targetChargeInkWh ?? legs[i - 1].summary.remainingChargeAtArrivalInkWh);
  const legPct = i => [pct(legStartKWh(i), car.usable), pct(legs[i].summary.remainingChargeAtArrivalInkWh, car.usable)];
  const rgb = hexRgb(accent);
  drainedRgb = document.documentElement.getAttribute('data-theme') === 'dark' ? DRAINED.dark : DRAINED.light;
  const layers = ml.getStyle().layers;
  const sdkLine = layers.find(l => /-routeLine$/.test(l.id))?.id;
  if (sdkLine) {
    // The gauge replaces the SDK's fill; its outline stays as the tube.
    if (!sdkLineOpacity.has(ctx.map)) sdkLineOpacity.set(ctx.map, ml.getPaintProperty(sdkLine, 'line-opacity') ?? 1);
    ml.setPaintProperty(sdkLine, 'line-opacity', byBattery ? 0 : sdkLineOpacity.get(ctx.map));
    ctx.onTeardown(() => { try { ml.getLayer(sdkLine) && ml.setPaintProperty(sdkLine, 'line-opacity', sdkLineOpacity.get(ctx.map)); } catch {} });
  }
  if (byBattery) {
    const above = sdkLine ? layers[layers.findIndex(l => l.id === sdkLine) + 1]?.id : undefined;
    const width = sdkLine ? ml.getPaintProperty(sdkLine, 'line-width') : null;
    legs.forEach((leg, i) => {
      const [from, to] = legPct(i);
      const id = `ev-battery-${i}`;
      ctx.addSource(id, {
        type: 'geojson', lineMetrics: true,
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.slice(leg.startPointIndex, leg.endPointIndex + 1) } },
      });
      ctx.addLayer({
        id, type: 'line', source: id,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-width': width ?? 6,
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, chargeColor(rgb, from), 1, chargeColor(rgb, to)],
        },
      }, above);
    });
  }

  const tripBounds = bboxOf(coords);

  // The focused leg — a soft glow over the SDK's line, under its pins.
  const legLine = i => ({
    type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: coords.slice(legs[i].startPointIndex, legs[i].endPointIndex + 1) },
  });
  ctx.addSource('ev-leg-focus', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  ctx.addLayer({
    id: 'ev-leg-focus', type: 'line', source: 'ev-leg-focus',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': accent, 'line-width': 18, 'line-opacity': 0.35, 'line-blur': 4 },
  }, routing.getLayerToRenderLinesUnder());
  const focusLeg = i => ml.getSource('ev-leg-focus')?.setData(
    i == null ? { type: 'FeatureCollection', features: [] } : legLine(i));

  // 4. Cards — the charging park, its live status, and the stop in the plan.
  const stopCard = (s, i) => {
    const conn = s.p.chargingConnectionInfo || {};
    const siteKw = Number(s.p.chargingParkPowerInkW) || Number(conn.chargingPowerInkW) || null;
    const usedKw = Number(conn.chargingPowerInkW) || (siteKw ? Math.min(siteKw, car.dcPeak) : null);
    const arrive = s.leg.summary.remainingChargeAtArrivalInkWh;
    const rows = s.live ? s.live.rows : [];
    const meta = [
      ['Stop', `${i + 1} of ${stops.length}`],
      ['Charge time', fmtMin(s.p.chargingTimeInSeconds)],
      ['Battery', arrive != null
        ? `${pct(arrive, car.usable)}% → ${pct(s.p.targetChargeInkWh, car.usable)}%`
        : `to ${pct(s.p.targetChargeInkWh, car.usable)}%`],
      ['Charging on', `${fmtPlug(conn.plugType) || 'DC'}${usedKw ? ` · ${Math.round(usedKw)} kW` : ''}`],
    ];
    const operator = s.p.chargePointOperator?.name || s.p.chargingParkOperatorName;
    if (operator && operator !== s.p.chargingParkName) meta.push(['Operator', operator]);
    if (s.p.nearbyServices?.length) meta.push(['Nearby', s.p.nearbyServices.map(n => serviceLabel(n.type)).join(', ')]);
    return evStationCard({
      title: s.p.chargingParkName || `Charging stop ${i + 1}`,
      address: s.p.address?.freeformAddress?.trim(),
      rows, meta,
      pending: s.live === undefined && !!s.uuid,
      note: s.live === null ? (s.uuid ? 'This park reports no live status' : 'No park id in the route response') : null,
    });
  };

  /* Each leg's time is driving only; the route's travelTimeInSeconds is
     their sum plus the charging stops. Steps show whole minutes, and the
     totals are summed from those same minutes, so the numbers in the panel
     always add up (within a minute or two of TomTom's exact total). */
  const legSec  = leg => Math.round((leg.summary.travelTimeInSeconds || 0) / 60) * 60;
  const stopSec = stop => Math.max(1, Math.round((stop.p.chargingTimeInSeconds || 0) / 60)) * 60;
  const drive = legs.reduce((t, l) => t + legSec(l), 0);
  const charging = stops.reduce((t, st) => t + stopSec(st), 0);
  const total = drive + charging;
  const arriveKWh = sum.remainingChargeAtArrivalInkWh;
  const endCard = (which) => which === 'origin'
    ? infoCard({
        accent, eyebrow: 'Origin', title: fromName, subtitle: fromHits[0]?.address || undefined,
        rows: [
          ['Vehicle', `${car.label} · ${car.usable} kWh usable`],
          ['Battery', `${fmtKWh(startKWh)} (${pct(startKWh, car.usable)}%)`],
          ['At 110 km/h', `${(car.highway / 10).toFixed(1)} kWh / 100 km`],
          ['Peak DC charge', `${car.dcPeak} kW · 10 → 80% in ${car.t10to80} min`],
          ['Reserve', `Never below ${reservePct}% · ${fmtKWh(reserveKWh)}`],
        ],
        footer: `Car data · EV Database (ev-database.org/${car.src})`,
      })
    : infoCard({
        accent, eyebrow: 'Destination', title: toName, subtitle: toHits[0]?.address || undefined,
        rows: [
          ['Distance', fmtKm(sum.lengthInMeters)],
          ['Drive time', fmtHr(drive)],
          ['Charging time', stops.length ? fmtHr(charging) : '—'],
          ['Total trip', fmtHr(total)],
          ['Energy used', sum.batteryConsumptionInkWh ? fmtKWh(sum.batteryConsumptionInkWh) : '—'],
          ['Battery on arrival', arriveKWh != null ? `${fmtKWh(arriveKWh)} (${pct(arriveKWh, car.usable)}%)` : '—'],
        ],
        footer: `Live · TomTom EV Routing · ${car.label}`,
      });

  let openPopup = null;
  const closePopup = () => { try { openPopup?.remove(); } catch {} openPopup = null; };
  const openStopCard = (i) => {
    closePopup();
    const s = stops[i];
    openPopup = ctx.addPopup({ closeButton: true, offset: haveEvIcons ? PIN_POPUP_OFFSET : 24 }, s.pos, stopCard(s, i));
    openPopup._stop = i;
  };
  const openEndCard = (which) => {
    closePopup();
    openPopup = ctx.addPopup({ closeButton: true, offset: 40 }, which === 'origin' ? origin : dest, endCard(which));
  };

  // 5. The step list, in trip order: depart, drive, charge, …, arrive.
  const steps = [{ kind: 'origin' }];
  legs.forEach((leg, i) => {
    steps.push({ kind: 'leg', legIndex: i });
    const si = stops.findIndex(s => s.legIndex === i);
    if (si >= 0) steps.push({ kind: 'stop', stopIndex: si });
  });
  steps.push({ kind: 'dest' });

  let selected = null;   // index into steps
  let flight = 0;        // latest camera move started from the list

  /* Rail from this step's node to the next one: the battery level it
     covers in the battery view, the route colour otherwise. */
  const railFor = (st) => {
    if (!byBattery || st.kind !== 'leg') return accent;
    const [a, b] = legPct(st.legIndex);
    return chargeCss(rgb, a, b);
  };
  /* One row per step. The title says what happens, the line under it
     what it does to the battery, and the right column how long that step
     takes — driving time for a drive, charging time for a stop. */
  const dur = (sec, label) => `<span class="trip-dur" title="${label}">${fmtHr(sec)}</span>`;
  const stepHtml = (st, n) => {
    const on = n === selected ? ' is-active' : '';
    const vars = `style="--trip-rail: ${railFor(st)}; --trip-accent: ${accent}"`;
    if (st.kind === 'origin') {
      return `<li class="trip-step trip-step-end${on}" ${vars}><button type="button" class="trip-row" data-step="${n}">
        ${nodeImg(wpIcons.start, '')}
        <span class="trip-main"><span class="trip-name">Depart ${esc(fromName)}</span>
          <span class="trip-sub">Battery ${pct(startKWh, car.usable)}% · ${fmtKWh(startKWh)}</span></span></button></li>`;
    }
    if (st.kind === 'dest') {
      return `<li class="trip-step trip-step-end${on}" ${vars}><button type="button" class="trip-row" data-step="${n}">
        ${nodeImg(wpIcons.finish, ICON.flag)}
        <span class="trip-main"><span class="trip-name">Arrive ${esc(toName)}</span>
          <span class="trip-sub">${arriveKWh != null ? `Battery left ${pct(arriveKWh, car.usable)}% · ${fmtKWh(arriveKWh)}` : ''}</span></span></button></li>`;
    }
    if (st.kind === 'leg') {
      const s = legs[st.legIndex].summary;
      const delay = s.trafficDelayInSeconds >= 60 ? ` · <span class="trip-delay">incl. ${fmtMin(s.trafficDelayInSeconds)} traffic</span>` : '';
      return `<li class="trip-step trip-step-leg${on}" ${vars}><button type="button" class="trip-row" data-step="${n}">
        <span class="trip-node"></span>
        <span class="trip-main"><span class="trip-name">Drive ${fmtKm(s.lengthInMeters)}</span>
          <span class="trip-sub">Battery ${legPct(st.legIndex)[0]}% → ${legPct(st.legIndex)[1]}% · uses ${fmtKWh(s.batteryConsumptionInkWh || 0)}${delay}</span></span>
        ${dur(legSec(legs[st.legIndex]), 'Driving time')}</button></li>`;
    }
    const s = stops[st.stopIndex];
    const conn = s.p.chargingConnectionInfo || {};
    const kw = Number(conn.chargingPowerInkW) || null;
    const live = s.live === undefined && s.uuid
      ? '<span class="trip-live is-pending">Checking…</span>'
      : s.live
        ? `<span class="trip-live${s.live.free > 0 ? ' is-free' : ' is-busy'}">${s.live.free} of ${s.live.total} points free now</span>`
        : '';
    return `<li class="trip-step trip-step-stop${on}" ${vars}><button type="button" class="trip-row" data-step="${n}">
      ${haveEvIcons ? nodeImg(`ev-round-${evStateOf(s.live)}`, ICON.bolt) : `<span class="trip-node">${ICON.bolt}</span>`}
      <span class="trip-main">
        <span class="trip-name">Charge at ${esc(s.p.chargingParkName || `stop ${st.stopIndex + 1}`)}</span>
        <span class="trip-sub">Battery ${pct(s.leg.summary.remainingChargeAtArrivalInkWh, car.usable)}% → ${pct(s.p.targetChargeInkWh, car.usable)}%${kw ? ` · ${Math.round(kw)} kW` : ''}</span>
        ${live}
      </span>
      ${dur(stopSec(s), 'Charging time')}</button></li>`;
  };

  const renderPanel = () => {
    ctx.setSidePanel(`<div class="trip-card">
      <div class="trip-head">
        <div class="trip-eyebrow">Trip plan · ${esc(car.label)}</div>
        <button type="button" class="trip-title" data-step="all" title="Show the whole trip">${esc(fromName)} → ${esc(toName)}</button>
      </div>
      <div class="trip-stats">
        <div class="trip-stat"><span class="trip-stat-label">Distance</span><span class="trip-stat-value">${fmtKm(sum.lengthInMeters)}</span></div>
        <div class="trip-stat"><span class="trip-stat-label">Trip time</span><span class="trip-stat-value">${fmtHr(total)}</span></div>
        <div class="trip-stat"><span class="trip-stat-label">Charging</span><span class="trip-stat-value">${stops.length ? fmtHr(charging) : '—'}</span></div>
      </div>
      <ol class="trip-steps">${steps.map(stepHtml).join('')}</ol>
      <div class="trip-note">${stops.length} charging stop${stops.length === 1 ? '' : 's'} planned by TomTom EV Routing${routes.endpoint === 'classic' ? ' (classic endpoint)' : ''}, ${startKWh < reserveKWh
        ? `starting below the ${reservePct}% reserve, so the first stop tops it up`
        : `never below the ${reservePct}% reserve`} · live availability from Charging Availability</div>
    </div>`);
    const host = document.getElementById('map-side');
    host?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };

  /* Select a step: highlight it in the list, fly the map there, open the
     matching card. */
  const selectStep = (n) => {
    const scroll = document.getElementById('map-side')?.scrollTop;
    selected = n;
    const st = steps[n];
    if (st.kind === 'leg') {
      flight++;
      focusLeg(st.legIndex);
      closePopup();
      ctx.fitBounds(bboxOf(legLine(st.legIndex).geometry.coordinates), { duration: 1400 });
    } else {
      focusLeg(null);
      closePopup();
      const isStop = st.kind === 'stop';
      ctx.setView({
        center: isStop ? stops[st.stopIndex].pos : st.kind === 'origin' ? origin : dest,
        zoom: isStop ? STOP_ZOOM : END_ZOOM,
      });
      // The card opens where the flight lands, so it can pan itself into view.
      const token = ++flight;
      ml.once('moveend', () => {
        if (ctx.cancelled || token !== flight) return;
        if (isStop) openStopCard(st.stopIndex); else openEndCard(st.kind === 'origin' ? 'origin' : 'dest');
      });
    }
    renderPanel();
    const host = document.getElementById('map-side');
    if (host && scroll != null) host.scrollTop = scroll;
    host?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const showAll = () => {
    selected = null;
    flight++;
    focusLeg(null);
    closePopup();
    ctx.fitBounds(tripBounds, { duration: 1400 });
    renderPanel();
  };

  const onPanelClick = (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    if (b.dataset.step === 'all') showAll(); else selectStep(Number(b.dataset.step));
  };
  const host = document.getElementById('map-side');
  host?.addEventListener('click', onPanelClick);
  ctx.onTeardown(() => host?.removeEventListener('click', onPanelClick));

  // Clicks on the map's own pins land on the same steps.
  const unsubs = [
    routing.events.user.chargingStops.on('click', (stop) => {
      const s = stopByUuid.get(stop?.properties?.chargingParkId || stop?.properties?.chargingParkUuid);
      const n = s ? steps.findIndex(st => st.kind === 'stop' && stops[st.stopIndex] === s) : -1;
      if (n >= 0) selectStep(n);
    }),
    routing.events.user.waypoints.on('click', (wp) => {
      const idx = wp?.properties?.index;
      selectStep(idx === 0 ? 0 : steps.length - 1);
    }),
  ];
  ctx.onTeardown(() => unsubs.forEach(u => { try { typeof u === 'function' ? u() : u?.off?.(); } catch {} }));

  renderPanel();
  // Sprites the SDK added after the first render show up once the map settles.
  ml.once('idle', () => { if (!ctx.cancelled) renderPanel(); });
  // Frame the trip once the panel is up, so the route clears it — on a
  // phone the panel docks over the bottom of the map.
  ctx.fitBounds(tripBounds, { duration: 900 });
  ctx.markHomeBounds(tripBounds);

  ctx.setLegend({
    title: byBattery ? 'Battery & charging' : 'Charging stops',
    items: [
      ...(byBattery ? [{
        html: `<span class="map-legend-swatch bar" style="background:linear-gradient(90deg, ${chargeColor(rgb, 0)}, ${chargeColor(rgb, 100)});color:transparent;"></span>`,
        label: 'Battery empty → full · interpolated between stops',
      }] : []),
      { color: dotColors?.available || 'var(--c-positive)', shape: 'dot', label: 'Point free now' },
      { color: dotColors?.occupied || 'var(--c-negative)', shape: 'dot', label: 'All busy' },
      { label: 'No dot · no live feed' },
    ],
  });

  // 6. Live availability at the parks the route actually uses.
  await Promise.all(stops.map(async (s) => {
    if (!s.uuid) { s.live = null; return; }
    const connectors = await chargingAvailability({ chargingAvailabilityId: s.uuid }).catch(() => null);
    const rows = rowsFromAvailability(connectors || []);
    const total = rows.reduce((n, r) => n + r.total, 0);
    s.live = total ? { free: rows.reduce((n, r) => n + r.free, 0), total, rows } : null;
  }));
  if (ctx.cancelled) return;
  // The icon mapping runs when routes are shown — show them again so each
  // pin wears its live state.
  if (haveEvIcons && stops.some(s => s.live)) {
    await routing.showRoutes(routes);
    if (ctx.cancelled) return;
  }
  renderPanel();
  if (openPopup?._stop != null && openPopup.isOpen()) openPopup.setHTML(stopCard(stops[openPopup._stop], openPopup._stop));
}
