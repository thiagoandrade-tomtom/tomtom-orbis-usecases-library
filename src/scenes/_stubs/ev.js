/* Find an EV charger — every charger in the city, live status up close.

   Three marker states, one dataset — the same ladder the basemap's own
   POIs climb:

     micro   every EV charging POI TomTom Search lists in the area
             (category 7309), as small dots shaded by the charger's top
             speed. Thousands of points at city zoom — the volume is the
             story. They stay underneath at every zoom, so a charger whose
             icon loses the collision contest is still on the map.
     round   from neighbourhood zoom, TomTom's own round charging icon
             (the basemap's `poi-charging_location` sprite) with the live
             status dot the SDK pins use: green = a point free right now,
             red = all busy, none = no live feed. No labels; icons
             declutter like basemap POIs do.
     pin     only for the charger under the pointer or the one selected:
             the SDK's charging pin with its name and "free / total".

   All three are drawn from the style's own sprites — nothing hand-made —
   and live availability comes from the Charging Availability API for the
   icons on screen — per plug × power level, which is what the card lists.

   Where the dots come from: a Nearby Search page stops at 100 results, and
   in central Amsterdam those 100 all sit within ~560 m. So the area is
   covered by a quadtree of small searches (ev-spec.js). For the preset
   cities that inventory is baked into public/data/ev/<city>.json; any other
   anchor is sampled live, nearest cells first, within a call budget — and
   the legend says so when the budget ran out. Availability is never baked. */

import { evStationCard, rowsFromAvailability, rowsFromInventory } from '../../render/ev-card.js';
import { buildEvMarkerImages, evStateOf } from '../../render/ev-sprites.js';
import { geocode, nearbySearchRaw, chargingAvailability } from '../../map/services.js';
import { paramFor } from '../../state.js';
import { CAT_EV, EV_CITIES, SPEED_TIERS, cityFor, coverSquare, projector, tierIndex } from './ev-spec.js';

/* The selected pin stands ~56 px above its point (icon-size 0.8). A card
   opening upward clears the whole pin plus a gap; one flipped below (pin
   near the top edge) or to the side only has to clear the point. */
const PIN_H = 56, GAP = 12;
const PIN_POPUP_OFFSET = {
  'top': [0, GAP], 'top-left': [0, GAP], 'top-right': [0, GAP],
  'bottom': [0, -(PIN_H + GAP)], 'bottom-left': [0, -(PIN_H + GAP)], 'bottom-right': [0, -(PIN_H + GAP)],
  'left': [18, -PIN_H / 2], 'right': [-18, -PIN_H / 2], 'center': [0, -PIN_H / 2],
};

const DETAIL_Z  = 14.5;    // from here: round icons over the micro-dots
const MAX_LIVE  = 40;      // availability lookups per settle, nearest the view centre first
const AVAIL_CONCURRENCY = 2;  // the availability endpoint throttles bursts hard (429)
const AVAIL_TTL_MS = 2 * 60 * 1000;
/* Live-sampled square for anchors outside the presets. Wide on purpose:
   cells are searched nearest-first and a full page splits, so a dense city
   spends the budget on the core (and the legend says it stopped), while a
   sparse one is covered whole within the same budget. */
const LIVE_HALF   = 8000;
const LIVE_BUDGET = 60;    // calls — ~15 s at the key's rate limit

// Top kW of each shown speed tier (slow, fast, rapid, ultra) — for the legend.
const TIER_TOP_KW = [11, 49, 149, Infinity];

// Plug filter → the Search connector types it covers.
const PLUG_TYPES = {
  type2:   ['IEC62196Type2Outlet', 'IEC62196Type2CableAttached'],
  ccs:     ['IEC62196Type2CCS', 'IEC62196Type1CCS'],
  chademo: ['Chademo'],
  tesla:   ['Tesla'],
};

/* Speed classes — [unknown, slow, fast, rapid, ultra]. Lightness steps of
   one green were too close to tell apart at dot size, so the two
   destination classes (slow / fast, mostly AC) stay green and the two
   en-route classes (rapid / ultra, DC) switch to blue and violet. Faster
   dots are also a little larger and drawn on top. */
const RAMP_LIGHT = ['#9AA3AE', '#A3C4AB', '#1E9E47', '#2A78E4', '#7B45D9'];
const RAMP_DARK  = ['#6B7480', '#7E9C86', '#3FD46F', '#4C9BFF', '#B18CFF'];
const TIER_SCALE = ['match', ['get', 'tier'], 3, 1.25, 4, 1.45, 1];

// Availability lookups outlive a scene re-run (pan, param tweak), but not by much.
const availCache = new Map();   // id → { t, promise }

/* ---- Data -------------------------------------------------------------- */

/* Snapshot → records in the same shape the live sampler emits. */
function fromSnapshot(s) {
  const proj = projector(s.center);
  return s.x.map((x, i) => {
    const [lon, lat] = proj.toLL([x, s.y[i]]);
    return {
      id: `${s.city}-${i}`, lon, lat, name: s.name[i], addr: s.addr[i], kw: s.kw[i],
      conns: s.conns[i] ? s.conns[i].split(';') : [], avail: s.avail[i],
    };
  });
}

/* Live counts for one charger. A failed call (usually a 429 under a
   burst) is not cached — the next settle asks again — while a park that
   simply reports nothing is cached as null. */
function liveFor(rec) {
  if (!rec.avail) return Promise.resolve(null);
  const hit = availCache.get(rec.avail);
  if (hit && Date.now() - hit.t < AVAIL_TTL_MS) return hit.promise;
  const promise = chargingAvailability({ chargingAvailabilityId: rec.avail, maxAgeMs: AVAIL_TTL_MS })
    .then(connectors => {
      const rows = rowsFromAvailability(connectors);
      const total = rows.reduce((n, r) => n + r.total, 0);
      return total ? { free: rows.reduce((n, r) => n + r.free, 0), total, rows } : null;
    })
    .catch(() => { availCache.delete(rec.avail); return undefined; });
  availCache.set(rec.avail, { t: Date.now(), promise });
  return promise;
}

async function mapLimit(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

function chargerCard(rec, live, pending) {
  return evStationCard({
    title: rec.name,
    address: rec.addr,
    // Live rows when the park reports them; otherwise Search's inventory.
    rows: live ? live.rows : rowsFromInventory(rec.conns),
    pending,
    note: !live && !pending ? (rec.avail ? 'Live status unavailable right now' : 'This charger has no live status feed') : null,
  });
}

/* ---- Scene ------------------------------------------------------------- */

export default async function ev(ctx, uc) {
  const anchorQuery = paramFor(uc, 'anchor');
  const minPower = Number(paramFor(uc, 'minPower') || 0);
  const plugTypes = PLUG_TYPES[paramFor(uc, 'plug')] || null;
  // A charger with unknown power fails a power floor — it can't be shown to meet it.
  const matches = r => (!minPower || r.kw >= minPower)
    && (!plugTypes || r.conns.some(c => plugTypes.includes(c.split('|')[0])));
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const ramp = dark ? RAMP_DARK : RAMP_LIGHT;
  const ml = ctx.ml;

  // 1. Anchor — any address worldwide.
  const anchorHit = (await geocode({ query: anchorQuery, limit: 1 }))[0];
  if (ctx.cancelled) return;
  const center = anchorHit?.position || [4.8810, 52.3580];
  const cityKey = cityFor(center);
  const half = cityKey ? EV_CITIES[cityKey].half : LIVE_HALF;

  // City-level frame: the volume first, the neighbourhood one scroll away.
  ctx.setView({ center, zoom: cityKey ? 12 : 12.6, animate: true });


  // The basemap carries a handful of charging POIs of its own; hide them
  // so ours aren't doubled.
  for (const id of ['POI', 'POI - Micro']) {
    if (!ml.getLayer(id)) continue;
    const prev = ml.getFilter(id);
    ml.setFilter(id, ['all', prev, ['!=', ['get', 'category'], 'charging_location']]);
    ctx.onTeardown(() => { try { ml.getLayer(id) && ml.setFilter(id, prev); } catch {} });
  }

  // 2. Layers — micro dots, round icons, and the one pin.
  const records = new Map();   // id → record
  const live = new Map();      // id → { free, total, counts } | null
  let hoverId = null, selectedId = null;

  const featureOf = r => ({
    type: 'Feature', id: r.id,
    geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
    properties: {
      id: r.id,
      tier: tierIndex(r.kw),
      st: evStateOf(live.get(r.id)),
      // Faster chargers, then ones with a free point, win the collision contest.
      rank: -(r.kw || 0) - (live.get(r.id)?.free ? 1000 : 0),
      label: r.name || 'Charging station',
      live: live.get(r.id) ? `${live.get(r.id).free}/${live.get(r.id).total}` : '',
    },
  });
  let dataTimer = null;
  const pushData = () => {
    dataTimer = null;
    ml.getSource('ev-all')?.setData({ type: 'FeatureCollection', features: [...records.values()].map(featureOf) });
  };
  const schedulePush = () => { dataTimer ??= setTimeout(pushData, 200); };
  ctx.onTeardown(() => clearTimeout(dataTimer));

  ctx.addSource('ev-all', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // Dots and round icons slot in under the basemap's place names (city,
  // neighbourhood …) so labels stay readable; only the pin rides on top.
  const underLabels = ml.getStyle().layers.find(l => l.id.startsWith('Places - '))?.id;
  ctx.addLayer({
    id: 'ev-dots', type: 'circle', source: 'ev-all',
    layout: { 'circle-sort-key': ['get', 'tier'] },
    paint: {
      'circle-color': ['match', ['get', 'tier'], 1, ramp[1], 2, ramp[2], 3, ramp[3], 4, ramp[4], ramp[0]],
      'circle-radius': ['interpolate', ['linear'], ['zoom'],
        9, ['*', 1.8, TIER_SCALE], 12, ['*', 3, TIER_SCALE], 14, ['*', 4, TIER_SCALE], 17, ['*', 4.6, TIER_SCALE]],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 0, 12, 0.6, 15, 1],
      'circle-stroke-color': dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)',
    },
  }, underLabels);

  const dotColors = buildEvMarkerImages(ml);
  const haveIcons = Boolean(dotColors);
  const statusFg = dark ? { free: '#6FCB8A', busy: '#FF8A80' } : { free: '#2F8F46', busy: '#C62828' };
  const pinned = () => ['literal', [hoverId, selectedId].filter(Boolean)];
  if (haveIcons) {
    ctx.addLayer({
      id: 'ev-round', type: 'symbol', source: 'ev-all', minzoom: DETAIL_Z,
      filter: ['!', ['in', ['get', 'id'], pinned()]],
      layout: {
        'icon-image': ['concat', 'ev-round-', ['get', 'st']],
        'icon-size': ['interpolate', ['linear'], ['zoom'], DETAIL_Z, 0.75, 18, 1],
        'icon-padding': 1,
        'symbol-sort-key': ['get', 'rank'],
      },
    }, underLabels);
    ctx.addLayer({
      id: 'ev-pin', type: 'symbol', source: 'ev-all',
      filter: ['in', ['get', 'id'], pinned()],
      layout: {
        'icon-image': ['concat', 'ev-pin-', ['get', 'st']],
        'icon-anchor': 'bottom',
        'icon-size': 0.8,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': ['case', ['!=', ['get', 'live'], ''],
          ['format',
            ['get', 'label'], {},
            '\n', {},
            ['concat', ['get', 'live'], ' free'], {
              'font-scale': 0.92,
              'text-color': ['case', ['==', ['get', 'st'], 'available'], statusFg.free, statusFg.busy],
            }],
          ['get', 'label']],
        'text-font': ['Noto-Bold'],
        'text-size': 13,
        'text-anchor': 'top',
        'text-offset': [0, 0.3],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': dark ? '#FFFFFF' : '#1A1F2A',
        'text-halo-color': dark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)',
        'text-halo-width': 1.4,
      },
    });
  }
  const refreshPinned = () => {
    if (!haveIcons) return;
    ml.setFilter('ev-round', ['!', ['in', ['get', 'id'], pinned()]]);
    ml.setFilter('ev-pin', ['in', ['get', 'id'], pinned()]);
  };

  let source = null;
  const renderLegend = () => {
    const n = records.size.toLocaleString('en-GB');
    const detail = ml.getZoom() >= DETAIL_Z;
    const items = detail
      ? [
          { color: dotColors?.available || 'var(--c-positive)', shape: 'dot', label: 'Point free now' },
          { color: dotColors?.occupied || 'var(--c-negative)', shape: 'dot', label: 'All busy' },
          { label: 'No dot · no live feed' },
        ]
      : SPEED_TIERS.slice(1)
          .map((t, i) => ({ color: ramp[i + 1], shape: 'dot', label: t.label, top: TIER_TOP_KW[i] }))
          .filter(t => t.top >= minPower)          // tiers the power floor rules out aren't on the map
          .concat([{ label: 'Zoom in for live availability' }]);
    if (source) items.push({ label: source });
    ctx.setLegend({ title: `${n} chargers`, items });
  };

  // 3. Live availability for the icons actually on screen.
  let liveRun = 0;
  const refreshLive = async () => {
    if (ctx.cancelled) return;
    renderLegend();
    const run = ++liveRun;
    if (!haveIcons || ml.getZoom() < DETAIL_Z) return;
    const c = ml.getCenter();
    const onScreen = [...new Set(ml.queryRenderedFeatures({ layers: ['ev-round', 'ev-pin'] }).map(f => f.properties.id))]
      .map(id => records.get(id))
      .filter(r => r && !live.has(r.id))
      .sort((p, q) => Math.hypot(p.lon - c.lng, p.lat - c.lat) - Math.hypot(q.lon - c.lng, q.lat - c.lat))
      .slice(0, MAX_LIVE);
    await mapLimit(onScreen, AVAIL_CONCURRENCY, async (r) => {
      if (ctx.cancelled || run !== liveRun) return;   // superseded by a newer pan
      const l = await liveFor(r);
      if (l === undefined) return;                     // failed — retry on the next settle
      live.set(r.id, l);
      schedulePush();
    });
  };
  let debounce;
  ctx.on('moveend', () => { clearTimeout(debounce); debounce = setTimeout(refreshLive, 250); });
  ctx.onTeardown(() => clearTimeout(debounce));

  // 4. Hover lifts a charger to its pin; click selects it and opens its card.
  const hitAt = (point) => {
    const layers = ['ev-pin', 'ev-round', 'ev-dots'].filter(id => ml.getLayer(id));
    const f = ml.queryRenderedFeatures(point, { layers })[0];
    return f ? records.get(f.properties.id) : null;
  };
  ctx.on('mousemove', (e) => {
    const rec = hitAt(e.point);
    ml.getCanvas().style.cursor = rec ? 'pointer' : '';
    const id = rec && ml.getZoom() >= DETAIL_Z ? rec.id : null;
    if (id !== hoverId) { hoverId = id; refreshPinned(); }
  });
  // A pan or zoom moves the map under a still pointer — drop the hover pin.
  const clearHover = () => { if (hoverId) { hoverId = null; refreshPinned(); } };
  ctx.on('mouseout', clearHover);
  ctx.on('movestart', clearHover);

  let openPopup = null;
  ctx.on('click', async (e) => {
    const rec = hitAt(e.point);
    if (!rec) return;
    // At city zoom a dot is a doorway into the neighbourhood, not a card.
    if (ml.getZoom() < DETAIL_Z) {
      ml.easeTo({ center: [rec.lon, rec.lat], zoom: DETAIL_Z + 1.5, duration: 700 });
      return;
    }
    try { openPopup?.remove(); } catch {}
    selectedId = rec.id;
    refreshPinned();
    const known = live.get(rec.id);
    const popup = ctx.addPopup(
      { closeButton: true, offset: PIN_POPUP_OFFSET },
      [rec.lon, rec.lat],
      chargerCard(rec, known, known === undefined && !!rec.avail),
    );
    openPopup = popup;
    popup.on('close', () => { if (selectedId === rec.id) { selectedId = null; refreshPinned(); } });
    if (known === undefined) {
      const l = await liveFor(rec);
      if (l !== undefined) { live.set(rec.id, l); schedulePush(); }
      if (!ctx.cancelled && popup.isOpen()) popup.setHTML(chargerCard(rec, l ?? null, false));
    }
  });

  // 5. Fill the dots.
  const pushRecords = (list) => { for (const r of list) if (matches(r)) records.set(r.id, r); pushData(); };
  const snapshot = cityKey
    ? await fetch(`${import.meta.env.BASE_URL}data/ev/${cityKey}.json`).then(r => r.ok ? r.json() : null).catch(() => null)
    : null;
  if (ctx.cancelled) return;

  if (snapshot) {
    source = `TomTom Search · baked ${snapshot.bakedAt}`;
    pushRecords(fromSnapshot(snapshot));
  } else {
    source = 'TomTom Search · sampling live…';
    renderLegend();
    const fetchPage = (pt, radius) => nearbySearchRaw({ center: pt, radius, categorySet: CAT_EV, limit: 100 });
    const res = await coverSquare({
      center, half, budget: LIVE_BUDGET, fetchPage,
      onCell: list => { if (!ctx.cancelled) { pushRecords(list); renderLegend(); } },
    });
    if (ctx.cancelled) return;
    const km = (half * 2 / 1000).toFixed(0);
    source = res.unresolved
      ? `TomTom Search · live, nearest part of a ${km} km square (call budget reached)`
      : `TomTom Search · live, ${km} km square`;
  }
  renderLegend();
  ml.once('idle', refreshLive);
}
