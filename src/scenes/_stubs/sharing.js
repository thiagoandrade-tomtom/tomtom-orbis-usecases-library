/* Vehicle Sharing Aggregator — vehicles anchored to real street positions.

   Real GBFS feeds aren't wired in here, but the previous version placed
   markers at random lat/lng offsets which routinely landed mid-canal or
   on rooftops. Instead we query the Search API for real bicycle-parking
   and parking-lot positions around central Amsterdam — those are exactly
   the locations a shared-mobility provider would stage vehicles. Each
   vehicle is overlaid on one of those real anchors. */

import { infoCard } from '../../render/popup.js';
import { createStatefulPin } from '../../render/marker.js';
import { poiSearch, geocode } from '../../map/services.js';
import { haversine } from '../../map/geo.js';
import { paramFor } from '../../state.js';

// Brand colours pulled from the semantic palette so the map reads as a
// coordinated multi-brand legend, not a clash of competing logo reds.
const BRANDS = [
  { name: 'FlashGo',     accent: 'attention',   vehicle: 'E-scooter', icon: 'bike', unlock: '€1.00', perMin: '€0.25', kmPerPct: 0.4 },
  { name: 'CityRide',    accent: 'neutral',     vehicle: 'E-bike',    icon: 'bike', unlock: '€0.50', perMin: '€0.18', kmPerPct: 0.4 },
  { name: 'GreenWheels', accent: 'positive',    vehicle: 'Car',       icon: 'car',  unlock: '€2.50', perMin: '€0.40', kmPerPct: 1.8 },
];

const FIRST_NAMES = ['Tess', 'Mark', 'Eva', 'Tim', 'Lara', 'Sam', 'Iris', 'Bram'];

// Deterministic pseudo-random so popups look the same across renders.
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export default async function sharing(ctx, uc) {
  const anchorQuery = paramFor(uc, 'anchor');
  // Per-vehicle-class colour overrides — let users brand a fleet view
  // without touching the semantic palette.
  const COLOR_OVERRIDES = {
    'E-scooter': paramFor(uc, 'scooterColor'),
    'E-bike':    paramFor(uc, 'bikeColor'),
    'Car':       paramFor(uc, 'carColor'),
  };
  /* Global search — anchor can be any address worldwide. */
  const anchorHit = (await geocode({ query: anchorQuery, limit: 1 }))[0];
  if (ctx.cancelled) return;
  const center = anchorHit?.position || [4.8810, 52.3635];

  ctx.setView({ center, zoom: 13.5, animate: true });

  // Real anchor points where shared vehicles would actually be staged.
  const [parking, bikeParking] = await Promise.all([
    poiSearch({ query: 'parking',         center, radius: 1500, limit: 12 }),
    poiSearch({ query: 'bicycle parking', center, radius: 1500, limit: 12 }),
  ]);
  if (ctx.cancelled) return;

  // Cars only on car parks; bikes/scooters on bicycle parking — keeps
  // brand placement plausible (no scooters dropped inside a multi-storey).
  const anchors = {
    'E-scooter': bikeParking.length ? bikeParking : parking,
    'E-bike':    bikeParking.length ? bikeParking : parking,
    'Car':       parking.length ? parking : bikeParking,
  };

  const rand = seeded(42);
  const used = new Set();

  /* Two vehicles must never land on the same coordinate. A marker exactly
     behind another is undiscoverable — you only learn it's there by
     clicking the one on top and watching a second colour appear.

     The claim has to be keyed on the POSITION, not on class + index: the
     scooter and bike pools are the same bicycle-parking array, so
     'E-scooter-3' and 'E-bike-3' are different keys pointing at the same
     spot, which is exactly how a blue e-bike ended up parked inside an
     amber scooter.

     Distinct isn't sufficient on its own, though — two bicycle racks 20 m
     apart are distinct and still render as one blob. So among the free
     anchors we take the one FARTHEST from everything already placed
     (maximin), which spreads the fleet as widely as the pool allows
     without ever costing a vehicle: it always picks a free spot, it just
     picks the best one. Taking the first spot that cleared a fixed
     minimum-gap threshold was the earlier version and it left markers
     two-thirds covered, because "good enough" kept winning over "best". */
  const placed = [];
  const posKey = ([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`;
  const spreadScore = (pos) =>
    placed.length ? Math.min(...placed.map(p => haversine(p, pos))) : Infinity;

  /* 18 is the fleet we'd like, not a guarantee — a brand stops placing
     when its anchor pool runs out of free spots. Around Leidseplein
     Search finds ~7 bicycle racks, so the scooter and bike brands (which
     share that pool) land fewer than the six each they ask for. */
  for (let i = 0; i < 18; i++) {
    const brand = BRANDS[i % BRANDS.length];
    const brandColor = COLOR_OVERRIDES[brand.vehicle] || ctx.color(brand.accent);
    const pool = anchors[brand.vehicle];
    if (!pool || pool.length === 0) continue;

    /* Scan the whole pool for the free anchor that sits farthest from the
       vehicles already down. Strict > keeps the first of any tie, so the
       layout is identical on every render — same as the seeded battery
       figures the popups show. */
    let anchorPick = null;
    let bestScore = -1;
    for (const candidate of pool) {
      if (!candidate?.position || used.has(posKey(candidate.position))) continue;
      const score = spreadScore(candidate.position);
      if (score > bestScore) { bestScore = score; anchorPick = candidate; }
    }
    /* Pool fully consumed. Skipping beats the old behaviour of reusing an
       anchor, which is what stacked markers in the first place — and the
       legend lists brands, not counts, so a shorter fleet reads fine. */
    if (!anchorPick) continue;
    used.add(posKey(anchorPick.position));

    const battery = Math.round(35 + rand() * 60);
    const range = Math.round(battery * brand.kmPerPct);
    const id = `${brand.name.slice(0, 2).toUpperCase()}-${1000 + i}`;
    const tone = battery < 25 ? 'danger' : battery < 50 ? 'warn' : 'success';

    /* Stateful shape: the staged fleet reads as a calm field of
       brand-coloured circles, and only the one the rider taps stands up
       as a pin. The vehicle-class icon carries into both states, so
       scooter / bike / car stays tellable while idle. */
    ctx.addMarker({
      element: createStatefulPin(brandColor, brand.icon),
      popupHTML: infoCard({
        accent: brandColor,
        eyebrow: `${brand.name} · ${brand.vehicle}`,
        title: id,
        rows: [
          ['Battery', `${battery}%`],
          ['Range', `${range} km`],
          ['Unlock', brand.unlock],
          ['Per minute', brand.perMin],
          ['Staged at', anchorPick.name || anchorPick.address || 'Public parking'],
          ['Reserved by', i % 5 === 0 ? FIRST_NAMES[i % FIRST_NAMES.length] : '—'],
        ],
        footer: tone === 'danger'
          ? 'Low battery · service crew dispatched'
          : 'Available now · tap brand app to unlock',
      }),
    }, anchorPick.position);
    placed.push(anchorPick.position);
  }

  // Frame all placed vehicles so the user sees the full fleet on first
  // load — beats a hardcoded zoom that crops outliers or wastes space.
  if (placed.length) {
    let minLng = center[0], maxLng = center[0];
    let minLat = center[1], maxLat = center[1];
    for (const [lng, lat] of placed) {
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
    ctx.fitBounds([[minLng, minLat], [maxLng, maxLat]], { duration: 900, maxZoom: 15 });
  }

  // Legend popup — positioned at the anchor, not a random lat/lng.
  ctx.addPopup(
    { anchor: 'top-left', offset: 12, closeButton: true },
    center,
    `<div class="pop"><div class="pop-head">
      <span class="pop-dot" style="background:${COLOR_OVERRIDES[BRANDS[0].vehicle] || ctx.color(BRANDS[0].accent)}"></span>
      <div class="pop-title-wrap">
        <div class="pop-eyebrow">Providers</div>
        <div class="pop-title">Active brands</div>
      </div></div>
      <div class="pop-rows">
        ${BRANDS.map(b => `
          <div class="pop-row">
            <span class="pop-k"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${COLOR_OVERRIDES[b.vehicle] || ctx.color(b.accent)};margin-right:6px"></span>${b.name}</span>
            <span class="pop-v">${b.vehicle}</span>
          </div>`).join('')}
      </div>
      <div class="pop-foot">Staged at real parking locations · refresh 15s</div>
    </div>`
  );
}
