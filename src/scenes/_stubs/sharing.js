/* Vehicle Sharing Aggregator — vehicles anchored to real street positions.

   Real GBFS feeds aren't wired in here, but the previous version placed
   markers at random lat/lng offsets which routinely landed mid-canal or
   on rooftops. Instead we query the Search API for real bicycle-parking
   and parking-lot positions around central Amsterdam — those are exactly
   the locations a shared-mobility provider would stage vehicles. Each
   vehicle is overlaid on one of those real anchors. */

import { infoCard } from '../../render/popup.js';
import { createPin } from '../../render/marker.js';
import { poiSearch, geocode } from '../../map/services.js';
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

  let vehicleIndex = 0;
  const placed = [];
  for (let i = 0; i < 18; i++) {
    const brand = BRANDS[i % BRANDS.length];
    const brandColor = COLOR_OVERRIDES[brand.vehicle] || ctx.color(brand.accent);
    const pool = anchors[brand.vehicle];
    if (!pool || pool.length === 0) continue;

    // Walk through anchors deterministically so two vehicles don't stack.
    let anchorPick = null;
    for (let k = 0; k < pool.length; k++) {
      const idx = (vehicleIndex + k) % pool.length;
      const key = `${brand.vehicle}-${idx}`;
      if (!used.has(key)) { used.add(key); anchorPick = pool[idx]; vehicleIndex = idx + 1; break; }
    }
    if (!anchorPick) anchorPick = pool[i % pool.length];

    const battery = Math.round(35 + rand() * 60);
    const range = Math.round(battery * brand.kmPerPct);
    const id = `${brand.name.slice(0, 2).toUpperCase()}-${1000 + i}`;
    const tone = battery < 25 ? 'danger' : battery < 50 ? 'warn' : 'success';

    ctx.addMarker({
      element: createPin(brandColor, brand.icon),
      anchor: 'bottom',
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
