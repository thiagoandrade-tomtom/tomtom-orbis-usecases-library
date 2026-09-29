/* Advanced Multi-Stop Routing — long-distance EV journey with optimised
   charging stops along the way.

   Calls TomTom's Long Distance EV Routing API with a realistic Tesla
   Model 3 LR-style profile (75 kWh battery, real speed/consumption
   curve, sane reserves). The API decides *where* to charge and *how
   long* based on the road network, live traffic, and the vehicle's
   energy budget — we just render its answer.

   Each leg in the response ends either at a charging stop (with
   `chargingInformationAtEndOfLeg`) or at the final destination. That
   block already names the real charging park TomTom picked — uuid, name,
   operator, exact coordinate, site power — so every stop is drawn from
   it as-is, and live availability is asked for that same park uuid. No
   nearby-search guess: a guess could pick a different charger (or none)
   next to the one the route actually uses.

   Falls back to the regular Routing API (no chargers) if the EV
   endpoint isn't available on the active key. */

import { infoCard, chip } from '../../render/popup.js';
import { evStationCard, rowsFromAvailability } from '../../render/ev-card.js';
import { createPin, createChargerPin } from '../../render/marker.js';
import {
  geocode, chargingAvailability, calculateLongDistanceEVRoute, calculateRoute,
} from '../../map/services.js';
import { paramFor } from '../../state.js';
import { casingFor, lineParams, HALO, fmtDurationSec } from '../_shared.js';

// Real-world EV profiles — each one feeds the LDEVR API an explicit
// consumption curve (kWh per 100 km at 50 / 100 / 130 km/h) and battery
// capacity, so picking a smaller / less efficient car visibly changes
// where and how often TomTom inserts charging stops along the route.
// Figures are rounded from manufacturer / EV-database real-world data.
// `dcPeak` is the car's peak DC charging power in kW — it decides which
// chargers the car can use at full speed, and how fast it charges there.
const CAR_PROFILES = {
  'tesla-m3-lr': {
    label: 'Tesla Model 3 Long Range',
    maxCharge: 75,
    dcPeak: 250,
    curve:  '50,11.5:100,16.5:130,23.0',
    aux:    0.3,
    weight: 1850,
  },
  'vw-id4': {
    label: 'VW ID.4',
    maxCharge: 77,
    dcPeak: 135,
    curve:  '50,13.5:100,19.0:130,26.5',
    aux:    0.4,
    weight: 2120,
  },
  'ioniq5': {
    label: 'Hyundai Ioniq 5',
    maxCharge: 77,
    dcPeak: 230,
    curve:  '50,13.0:100,18.0:130,25.0',
    aux:    0.4,
    weight: 2100,
  },
  'bmw-i4': {
    label: 'BMW i4 eDrive40',
    maxCharge: 84,
    dcPeak: 205,
    curve:  '50,12.5:100,17.5:130,24.0',
    aux:    0.4,
    weight: 2125,
  },
  'zoe': {
    label: 'Renault Zoe ZE50',
    maxCharge: 52,
    dcPeak: 46,
    curve:  '50,12.0:100,17.5:130,26.0',
    aux:    0.3,
    weight: 1577,
  },
};
const DEFAULT_CAR = 'tesla-m3-lr';

/* Cumulative time to reach each 10% of the battery at a given peak power,
   with the usual lithium taper: full power to 50%, easing to 60% of it by
   80%, and to 20% by 100%. A model, not a measured curve — but it scales
   with the car's real peak, which is what moves the stops around. */
function chargingCurve(capKWh, peakKw) {
  const power = soc => soc <= 0.5 ? peakKw
    : soc <= 0.8 ? peakKw * (1 - (soc - 0.5) / 0.3 * 0.4)
    : peakKw * (0.6 - (soc - 0.8) / 0.2 * 0.4);
  const out = [];
  let t = 0;
  for (let i = 1; i <= 100; i++) {
    t += (capKWh / 100) / power((i - 0.5) / 100) * 3600;
    if (i % 10 === 0) out.push({ chargeInkWh: Math.round(capKWh * i) / 100, timeToChargeInSeconds: Math.round(t) });
  }
  out[out.length - 1].chargeInkWh = capKWh;   // LDEVR: last point must equal maxChargeInkWh
  return out;
}

/* The car's charging modes for LDEVR. Every EU car here charges DC over
   CCS; a 50 kW post caps it at 50, and anything faster than the car's own
   peak is capped by the car. Without the "above 50 kW" mode the router
   can only choose 50 kW posts — which is how a Tesla ended up parked at a
   50 kW charger on a 170 kW site. */
function chargingModesFor(car) {
  const plugType = 'Combo_to_IEC_62196_Type_2_Base';
  const modes = [{
    chargingConnections: [{ facilityType: 'Charge_Direct_Current_at_50kW', plugType }],
    chargingCurve: chargingCurve(car.maxCharge, Math.min(car.dcPeak, 50)),
  }];
  if (car.dcPeak > 50) modes.push({
    chargingConnections: [{ facilityType: 'Charge_Direct_Current_above_50kW', plugType }],
    chargingCurve: chargingCurve(car.maxCharge, car.dcPeak),
  });
  return modes;
}

// Constrain geocode to continental Europe so a free-form "Paris" can't
// resolve to Paris, Texas and trip the routing engine.
const GEOCODE_COUNTRIES = 'NL,BE,LU,DE,FR,CH,IT,ES,AT';

const fmtKm   = m => `${(m / 1000).toFixed(0)} km`;
/* Both duration helpers now route through the shared formatter so the
   crossover from "min" to "h" stays consistent across cases. fmtMin
   still clamps the floor at 1 min so a hyper-fast charge stop never
   reads as "0 min" — useful in dev with synthetic data. */
const fmtHr   = fmtDurationSec;
const fmtMin  = s => fmtDurationSec(Math.max(60, Number(s) || 0));
const fmtKWh  = k => `${Math.round(k)} kWh`;
const fmtPct  = (kwh, max) => `${Math.round((kwh / max) * 100)}%`;

export default async function multistop(ctx, uc) {
  const { color: accent, width: lineWidth, dashArray } = lineParams(uc, { defaultColor: ctx.caseColor(uc) });
  const STROKE_COLOR = casingFor(accent);
  const fromQ        = paramFor(uc, 'from');
  const toQ          = paramFor(uc, 'to');
  const carKey       = paramFor(uc, 'car') || DEFAULT_CAR;
  const car          = CAR_PROFILES[carKey] || CAR_PROFILES[DEFAULT_CAR];
  const startKWh     = Math.min(Number(paramFor(uc, 'startCharge') || 25), car.maxCharge);
  const VEHICLE = {
    constantSpeedConsumptionInkWhPerHundredkm: car.curve,
    maxChargeInkWh:                  car.maxCharge,
    currentChargeInkWh:              startKWh,
    auxiliaryPowerInkW:              car.aux,
    vehicleWeight:                   car.weight,
    minChargeAtDestinationInkWh:     5,
    minChargeAtChargingStopsInkWh:   5,
    chargingModes:                   chargingModesFor(car),
  };
  const MAX_CHARGE_DISPLAY = car.maxCharge;

  // 1. Geocode start + finish. No country lock — users can route anywhere globally.
  const [fromHits, toHits] = await Promise.all([
    geocode({ query: fromQ, limit: 1 }).catch(() => []),
    geocode({ query: toQ,   limit: 1 }).catch(() => []),
  ]);
  if (ctx.cancelled) return;
  const origin = fromHits[0]?.position;
  const dest   = toHits[0]?.position;
  if (!origin || !dest) return;

  /* Initial frame — straight-line bbox of origin + dest at the
     midpoint so the user immediately sees both endpoints in context,
     not a continent-scale flash. fitBounds animates again to the snapped
     route once the routing API returns. */
  {
    const minLng = Math.min(origin[0], dest[0]), maxLng = Math.max(origin[0], dest[0]);
    const minLat = Math.min(origin[1], dest[1]), maxLat = Math.max(origin[1], dest[1]);
    ctx.fitBounds([[minLng, minLat], [maxLng, maxLat]], { duration: 0 });
  }

  // Live traffic context — long-distance EV planning hinges on motorway congestion.
  ctx.enableTrafficFlow();
  ctx.enableTrafficIncidents();

  // 2. Try Long Distance EV routing; fall back to regular routing if the
  //    endpoint isn't enabled on this key. Surface failures clearly.
  let ev = null, regular = null, evError = null, regularError = null;
  try {
    ev = await calculateLongDistanceEVRoute({ origin, dest, ...VEHICLE });
  } catch (err) {
    evError = err.message;
    console.warn('[multistop] EV routing unavailable:', err.message);
    try { regular = await calculateRoute({ origin, dest }); }
    catch (err2) {
      regularError = err2.message;
      console.warn('[multistop] regular routing also failed:', err2.message);
    }
  }
  if (ctx.cancelled) return;

  const routed = ev || regular;

  // If both APIs failed, surface a clear error popup so the user isn't
  // staring at an empty map wondering what went wrong.
  if (!routed) {
    ctx.addPopup(
      { offset: 0, anchor: 'center', closeButton: true },
      origin,
      infoCard({
        accent, eyebrow: 'Routing failed', title: "TomTom couldn't plan this trip",
        rows: [
          ['From',   fromHits[0]?.address || fromQ],
          ['To',     toHits[0]?.address || toQ],
          ['Reason', (regularError || evError || 'unknown').slice(0, 120)],
        ],
        footer: 'Try a closer destination, or check your API key has Long-Distance EV enabled.',
      })
    );
    return;
  }

  // 3. Draw the snapped polyline + frame the actual route geometry.
  const coords = routed.geojson.geometry.coordinates;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  }
  ctx.fitBounds([[minLng, minLat], [maxLng, maxLat]], { duration: 900 });
  /* Overwrite the placeholder straight-line bbox home with the real
     snapped-route frame so recenter returns to the full path. */
  ctx.markHomeBounds([[minLng, minLat], [maxLng, maxLat]]);

  ctx.addSource('ev-route', { type: 'geojson', data: routed.geojson });
  ctx.addLayer({
    id: 'ev-route-casing', type: 'line', source: 'ev-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': STROKE_COLOR, 'line-width': lineWidth + HALO, 'line-opacity': 0.80 },
  });
  const evLinePaint = { 'line-color': accent, 'line-width': lineWidth };
  if (dashArray) evLinePaint['line-dasharray'] = dashArray;
  ctx.addLayer({
    id: 'ev-route-line', type: 'line', source: 'ev-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: evLinePaint,
  });

  // 4. Origin marker.
  ctx.addMarker({
    element: createPin(accent, 'star'), anchor: 'bottom',
    popupHTML: infoCard({
      accent, eyebrow: 'Origin', title: fromHits[0]?.name || fromQ,
      subtitle: fromHits[0]?.address || undefined,
      rows: [
        ['Vehicle',     `${car.label} · ${car.maxCharge} kWh`],
        ['Battery',     `${fmtKWh(VEHICLE.currentChargeInkWh)} (${fmtPct(VEHICLE.currentChargeInkWh, MAX_CHARGE_DISPLAY)})`],
        ['At 100 km/h', `${car.curve.split(':').find(p => p.startsWith('100,')).split(',')[1]} kWh / 100 km`],
        ['Peak DC charge', `${car.dcPeak} kW`],
      ],
    }),
  }, origin);

  // 5. Charging stops — straight from each leg's chargingInformationAtEndOfLeg.
  //    The park's own coordinate places the pin; its uuid is the Charging
  //    Availability id, so the live count is for the charger the route
  //    really uses.
  const legs = ev?.legs || [];
  const chargingLegs = legs.filter(l => l.summary?.chargingInformationAtEndOfLeg);

  const stopInfos = await Promise.all(chargingLegs.map(async (leg) => {
    const info = leg.summary.chargingInformationAtEndOfLeg;
    const c = info.chargingParkLocation?.coordinate;
    const pos = c ? [c.longitude, c.latitude] : leg.points[leg.points.length - 1];
    const availability = info.chargingParkUuid
      ? await chargingAvailability({ chargingAvailabilityId: info.chargingParkUuid }).catch(() => [])
      : [];
    return { pos, leg, info, availability };
  }));
  if (ctx.cancelled) return;

  const fmtPlug = p => String(p || '')
    .replace(/^Combo_to_IEC_62196_Type_2_Base$/, 'CCS Combo 2')
    .replace(/^IEC_62196_Type_2.*/, 'Type 2')
    .replace(/^Chademo$/i, 'CHAdeMO')
    .replace(/_/g, ' ');

  stopInfos.forEach((s, i) => {
    const { info, leg } = s;
    const loc = info.chargingParkLocation || {};
    const conn = info.chargingConnectionInfo || {};
    // Site power is what TomTom lists for the park; the car draws up to its
    // own peak from it. Both come from the response — nothing assumed.
    const siteKw = Number(info.chargingParkPowerInkW) || Number(conn.chargingPowerInkW) || null;
    const usedKw = siteKw ? Math.min(siteKw, car.dcPeak) : null;
    // Live free / total per plug × power at the park the route uses.
    const liveRows = rowsFromAvailability(s.availability);

    const arriveKWh = leg.summary.remainingChargeAtArrivalInkWh;
    const meta = [
      ['Stop', `${i + 1} of ${stopInfos.length}`],
      ['Charge time', fmtMin(info.chargingTimeInSeconds)],
      ['Battery', arriveKWh != null
        ? `${fmtPct(arriveKWh, MAX_CHARGE_DISPLAY)} → ${fmtPct(info.targetChargeInkWh, MAX_CHARGE_DISPLAY)}`
        : `to ${fmtPct(info.targetChargeInkWh, MAX_CHARGE_DISPLAY)}`],
      ['Charging on', `${fmtPlug(conn.chargingPlugType || info.chargingConnections?.[0]?.plugType) || 'DC'}${usedKw ? ` · up to ${Math.round(usedKw)} kW` : ''}`],
      ['Leg before', `${fmtKm(leg.summary.lengthInMeters)} · ${fmtHr(leg.summary.travelTimeInSeconds)}`],
    ];
    const operator = info.chargePointOperator?.name || info.chargingParkOperatorName;
    if (operator && operator !== info.chargingParkName) meta.push(['Operator', operator]);

    ctx.addMarker({
      element: createChargerPin({ kw: siteKw || 0 }),
      anchor: 'bottom',
      popupHTML: evStationCard({
        title: info.chargingParkName || `Charging stop ${i + 1}`,
        address: [loc.street?.trim(), [loc.postalCode, loc.city].filter(Boolean).join(' ').trim()].filter(Boolean).join(', '),
        rows: liveRows,
        meta,
        note: liveRows.length ? null : (info.chargingParkUuid ? 'This park reports no live status' : 'No park id in the route response'),
      }),
    }, s.pos);
  });

  // 6. Destination marker — with final battery + total trip stats.
  const sum = routed.summary;
  const drivingTime   = sum.travelTimeInSeconds || 0;
  const chargingTime  = sum.totalChargingTimeInSeconds || 0;
  const totalTime     = drivingTime + chargingTime;
  const remainingKWh  = sum.remainingChargeAtArrivalInkWh;
  const energyUsedKWh = sum.batteryConsumptionInkWh
    ?? (VEHICLE.currentChargeInkWh + (chargingLegs.reduce((t, l) =>
        t + (l.summary.chargingInformationAtEndOfLeg?.targetChargeInkWh || 0)
        - (l.summary.chargingInformationAtEndOfLeg?.batteryChargeAtBeginningOfChargingInkWh || 0), 0))
        - (remainingKWh ?? 0));

  ctx.addMarker({
    element: createPin(accent, 'flag'), anchor: 'bottom',
    popupHTML: infoCard({
      accent, eyebrow: 'Destination', title: toHits[0]?.name || toQ,
      subtitle: toHits[0]?.address || undefined,
      rows: [
        ['Distance',        fmtKm(sum.lengthInMeters)],
        ['Drive time',      fmtHr(drivingTime)],
        ['Charging time',   chargingLegs.length ? fmtHr(chargingTime) : '—'],
        ['Total trip',      fmtHr(totalTime)],
        ['Charging stops',  String(chargingLegs.length)],
        ['Energy used',     Number.isFinite(energyUsedKWh) && energyUsedKWh > 0 ? fmtKWh(energyUsedKWh) : '—'],
        ['Battery on arrival', remainingKWh != null
          ? `${fmtKWh(remainingKWh)} (${fmtPct(remainingKWh, MAX_CHARGE_DISPLAY)})`
          : '—'],
      ],
      footer: ev
        ? `Live · TomTom Long-Distance EV Routing · ${car.label}`
        : `Live · TomTom Routing — Long-Distance EV not enabled, charging stops omitted · ${car.label}`,
    }),
  }, dest);

  // 7. Tour summary chip at the route midpoint.
  const mid = coords[Math.floor(coords.length / 2)];
  ctx.addPopup(
    { offset: 14, anchor: 'bottom' },
    mid,
    chip({
      accent,
      text: chargingLegs.length
        ? `${fmtKm(sum.lengthInMeters)} · ${fmtHr(totalTime)} · ${chargingLegs.length} charge${chargingLegs.length === 1 ? '' : 's'}`
        : `${fmtKm(sum.lengthInMeters)} · ${fmtHr(totalTime)}`,
    })
  );
}
