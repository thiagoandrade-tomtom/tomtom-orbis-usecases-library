/* EV Availability — live charger status.

   Real EV chargers around an Amsterdam anchor (TomTom POI category 7309),
   each enriched with the real-time Charging Availability endpoint so the
   pin colour reflects whether at least one connector is free right now:

     green  → at least one connector available
     amber  → all connectors occupied (charger busy)
     grey   → status unknown (provider not reporting)

   The popup shows per-connector breakdown (Type 2, CCS, CHAdeMO …) with
   available / occupied / out-of-service counts straight from the API. */

import { infoCard } from '../../render/popup.js';
import { createPin } from '../../render/marker.js';
import { geocode, nearbySearch, chargingAvailability } from '../../map/services.js';
import { paramFor } from '../../state.js';
const RADIUS = 2500;            // 2.5 km around the anchor
const CAT_EV = 7309;
const LIMIT  = 30;

// TomTom connector type strings → friendly labels.
const CONNECTOR_LABEL = {
  IEC62196Type2CableAttached: 'Type 2 (cable)',
  IEC62196Type2Outlet:        'Type 2',
  IEC62196Type2CCS:           'CCS Combo 2',
  Chademo:                    'CHAdeMO',
  Tesla:                      'Tesla',
  IEC60309AC1PhaseBlue:       'Schuko (1-phase)',
  IEC60309AC3PhaseRed:        'Industrial (3-phase)',
};
const fmtConnector = t => CONNECTOR_LABEL[t] || t.replace(/([A-Z])/g, ' $1').trim();

// Classify a charger by max rated power across its connectors:
//   1 bolt  = Slow AC   (≤ 7 kW   · overnight)
//   2 bolts = Fast AC   (7–43 kW  · destination)
//   3 bolts = Rapid DC  (≥ 50 kW  · motorway-style)
function speedTier(charger) {
  const conns = charger.chargingPark?.connectors || [];
  const maxKW = conns.reduce((m, c) => Math.max(m, c.ratedPowerKW || 0), 0);
  if (maxKW <= 0)   return { tier: 0, icon: 'location', label: 'Speed unknown', maxKW: null };
  if (maxKW >= 50)  return { tier: 3, icon: 'bolt3',    label: `Rapid DC · ${Math.round(maxKW)} kW`, maxKW };
  if (maxKW >= 7.1) return { tier: 2, icon: 'bolt2',    label: `Fast AC · ${Math.round(maxKW)} kW`,  maxKW };
  return                   { tier: 1, icon: 'bolt1',    label: `Slow AC · ${Math.round(maxKW)} kW`,  maxKW };
}

// Decide the pin colour from an array of connector availabilities. Maps
// directly to the semantic palette so a viewer scanning the map reads
// state without reading text: positive = free, attention = busy,
// general = no live data.
function statusColor(connectors, palette) {
  if (!connectors || connectors.length === 0) return { color: palette.unknown, label: 'Unknown' };
  let anyAvail = false, anyKnown = false;
  for (const c of connectors) {
    const cur = c.availability?.current;
    if (!cur) continue;
    anyKnown = true;
    if ((cur.available ?? 0) > 0) anyAvail = true;
  }
  if (!anyKnown) return { color: palette.unknown,   label: 'Unknown' };
  if (anyAvail)  return { color: palette.available, label: 'Available' };
  return                  { color: palette.occupied,  label: 'Occupied' };
}

function connectorRows(connectors) {
  if (!connectors || connectors.length === 0) {
    return [['Status', 'No live data']];
  }
  return connectors.map(c => {
    const cur = c.availability?.current || {};
    const avail = cur.available ?? 0;
    const total = c.total ?? (avail + (cur.occupied ?? 0) + (cur.outOfService ?? 0));
    return [fmtConnector(c.type), `${avail} / ${total} free`];
  });
}

export default async function ev(ctx, uc) {
  const anchorQuery = paramFor(uc, 'anchor');
  const palette = {
    available: paramFor(uc, 'availableColor') || ctx.color('positive'),
    occupied:  paramFor(uc, 'occupiedColor')  || ctx.color('attention'),
    unknown:   paramFor(uc, 'unknownColor')   || ctx.color('general'),
  };

  // 1. Resolve the anchor + center the map on it.
  /* Global search — anchor can be any address worldwide. */
  const anchorHit = (await geocode({ query: anchorQuery, limit: 1 }))[0];
  if (ctx.cancelled) return;
  const center = anchorHit?.position || [4.8810, 52.3580];
  ctx.setView({ center, zoom: 14.24, animate: true });

  // 2. Pull real EV charging stations from the Search API.
  const chargers = await nearbySearch({
    center, radius: RADIUS, categorySet: CAT_EV, limit: LIMIT,
  });
  if (ctx.cancelled) return;

  // Frame all chargers (plus the anchor) so the user sees the full set
  // on first load — a hardcoded zoom either crops the outer pins or
  // wastes space when chargers cluster. `fitBounds` already applies the
  // panel-aware safeInsets() padding so the left-side detail panel
  // doesn't overlap the pins.
  if (chargers.length) {
    let minLng = center[0], maxLng = center[0];
    let minLat = center[1], maxLat = center[1];
    for (const c of chargers) {
      const [lng, lat] = c.position;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
    ctx.fitBounds([[minLng, minLat], [maxLng, maxLat]], { duration: 900, maxZoom: 15 });
  }

  // 3. Fetch live availability for each charger in parallel. Failures
  //    degrade gracefully — the pin stays grey instead of vanishing.
  const availabilities = await Promise.all(
    chargers.map(c => chargingAvailability({ chargingAvailabilityId: c.id })
      .catch(() => []))
  );
  if (ctx.cancelled) return;

  const tiers = chargers.map(c => speedTier(c));

  // Drop one pin per charger — bolt count reflects speed tier,
  //    pin colour reflects live availability.
  chargers.forEach((c, i) => {
    const connectors = availabilities[i];
    const { color, label: availLabel } = statusColor(connectors, palette);
    const { icon, label: speedLabel } = tiers[i];
    ctx.addMarker({
      element: createPin(color, icon),
      anchor: 'bottom',
      popupHTML: infoCard({
        accent: color,
        eyebrow: `${speedLabel} · ${availLabel}`,
        title: c.name || 'Charging station',
        subtitle: c.address || undefined,
        rows: connectorRows(connectors),
        footer: 'Live · TomTom Charging Availability API',
      }),
    }, c.position);
  });

}
