/* Where to stay — multi-vibe density heatmap.

   For each selected "vibe" (dining, cafés, nightlife, …) we fold POIs
   from N anchors spread across the city into a single heatmap source.
   Without the multi-anchor sampling the heatmap collapses into a tiny
   disc around one city centre point; the spread gives the layer real
   urban geography to render.

   The full per-city dataset is fetched once, deduplicated by coordinate
   and cached in module scope. Toggling chips, palette, radius or
   anything else afterwards is pure client-side filtering — zero
   network — so the panel feels instant after the first city load.
   Switching cities pays the full fetch once, then caches that city too. */

import { poiSearch, nearbySearch } from '../../map/services.js';
import { paramFor } from '../../state.js';

/* All ramps are "vibe-leaning" — warm pastels rising to a glowing peak.
   Avoid red-on-green or blue-on-red here: those read as risk / classic
   data-viz, the opposite of the "where the vibe is" lens this case is
   selling. The default is `sunset` because it carries the most warmth
   per unit of saturation, and reads well against the mono basemap. */
const PALETTES = {
  'sunset':      { from: '#FCD34D', mid: '#FB923C', warm: '#F472B6', hot: '#9333EA' },  // yellow → orange → pink → purple
  'tropic':      { from: '#5EEAD4', mid: '#FCD34D', warm: '#F472B6', hot: '#EC4899' },  // aqua → yellow → pink → magenta
  'peach':       { from: '#FED7AA', mid: '#FBA76F', warm: '#F472B6', hot: '#A855F7' },  // peach → orange → pink → purple
  'violet-pink': { from: '#6443A1', mid: '#9333EA', warm: '#DB2777', hot: '#F472B6' },
  'teal-coral':  { from: '#0EA5B7', mid: '#4ECDC4', warm: '#F08A5D', hot: '#EE6748' },
  'amber-red':   { from: '#FCD34D', mid: '#FB923C', warm: '#F97316', hot: '#DC2626' },
};

/* 6–7 anchors per city, spread across the broader metro — not just the
   urban core — so the heatmap covers the actual city footprint instead
   of one tight disc in the middle. With a 3 km radius (the new default)
   anchors overlap smoothly for dedup while extending coverage into the
   outer neighbourhoods (Noord, Bijlmer, Wedding, Poblenou, …) that the
   old tight-centre sampling missed. `view` is the camera target. */
const CITIES = {
  amsterdam: {
    view: { center: [4.8975, 52.3650], zoom: 11.5 },
    anchors: [
      [4.8945, 52.3730],  // Centrum
      [4.9180, 52.3920],  // Noord
      [4.8420, 52.3760],  // West / Bos en Lommer
      [4.8770, 52.3380],  // Zuid / Buitenveldert
      [4.9450, 52.3530],  // Oost / Watergraafsmeer
      [4.8200, 52.3680],  // Nieuw-West / Slotermeer
    ],
  },
  paris: {
    view: { center: [2.3522, 48.8580], zoom: 11.2 },
    anchors: [
      [2.3530, 48.8580],  // 1er–4e Marais / Châtelet
      [2.3470, 48.8470],  // 5e–6e Latin Quarter
      [2.3450, 48.8870],  // 18e Montmartre
      [2.3820, 48.8540],  // 11e–12e Bastille / Bercy
      [2.3070, 48.8780],  // 8e–17e Étoile / Batignolles
      [2.3170, 48.8390],  // 14e–15e Montparnasse
    ],
  },
  berlin: {
    view: { center: [13.4050, 52.5150], zoom: 10.8 },
    anchors: [
      [13.4050, 52.5200],  // Mitte
      [13.4030, 52.4970],  // Kreuzberg
      [13.4180, 52.5400],  // Prenzlauer Berg
      [13.3050, 52.5060],  // Charlottenburg
      [13.4540, 52.5150],  // Friedrichshain
      [13.4400, 52.4790],  // Neukölln
      [13.3700, 52.5510],  // Wedding / Gesundbrunnen
    ],
  },
  barcelona: {
    view: { center: [2.1734, 41.3870], zoom: 11.6 },
    anchors: [
      [2.1780, 41.3830],  // Gòtic / Born
      [2.1620, 41.3920],  // Eixample centre
      [2.1570, 41.4040],  // Gràcia
      [2.1680, 41.3740],  // Poble Sec
      [2.1410, 41.3780],  // Sants / Eixample-Esquerra
      [2.2050, 41.3990],  // Poblenou
    ],
  },
};

/* Vibe → probe. `query` runs fuzzy POI search; `categorySet` uses the
   nearbySearch endpoint (transit doesn't fuzzy-match well off the word). */
const VIBES = {
  dining:    { label: 'Dining',    probe: { query: 'restaurant' } },
  cafes:     { label: 'Cafés',     probe: { query: 'cafe' } },
  nightlife: { label: 'Nightlife', probe: { query: 'bar' } },
  sights:    { label: 'Sights',    probe: { query: 'museum' } },
  shopping:  { label: 'Shopping',  probe: { query: 'shopping' } },
  parks:     { label: 'Parks',     probe: { query: 'park' } },
  transit:   { label: 'Transit',   probe: { categorySet: 9942 } },
  markets:   { label: 'Markets',   probe: { query: 'market' } },
};
const ALL_VIBES = Object.keys(VIBES);

const RADIUS_M  = { '2000': 2000, '3000': 3000, '4000': 4000 };
const POI_LIMIT = 100;

/* Module-scope cache. Key = `${cityKey}:${radiusM}`. Stores the *promise*
   so concurrent renders during the first fetch share one network round.
   Each entry resolves to `Map<vibeKey, Feature[]>` — pre-deduplicated
   per vibe, ready to fold into the heatmap source. */
const DATASET_CACHE = new Map();

function dedupKey(lon, lat) {
  // ~11 m precision at 4 decimals — collapses near-duplicates from
  // overlapping anchor discs without merging genuinely distinct POIs.
  return `${lon.toFixed(4)}:${lat.toFixed(4)}`;
}

function loadCityDataset(cityKey, radiusM) {
  const cacheKey = `${cityKey}:${radiusM}`;
  if (DATASET_CACHE.has(cacheKey)) return DATASET_CACHE.get(cacheKey);

  const city = CITIES[cityKey];
  const anchors = city?.anchors || [];

  // One task per (vibe × anchor). All fire in parallel; the browser
  // pipelines them on HTTP/2 so wall-clock ≈ slowest single call.
  const tasks = [];
  for (const vibe of ALL_VIBES) {
    const { probe } = VIBES[vibe];
    for (const anchor of anchors) {
      const p = (probe.query
        ? poiSearch({ query: probe.query, center: anchor, radius: radiusM, limit: POI_LIMIT })
        : nearbySearch({ center: anchor, radius: radiusM, categorySet: probe.categorySet, limit: POI_LIMIT })
      ).catch(() => []).then(arr => ({ vibe, arr }));
      tasks.push(p);
    }
  }

  const promise = Promise.all(tasks).then(rows => {
    const byVibe = new Map(ALL_VIBES.map(v => [v, []]));
    const seen   = new Set();   // per-vibe coordinate dedup
    for (const { vibe, arr } of rows) {
      for (const r of arr) {
        if (!r?.position) continue;
        const [lon, lat] = r.position;
        const k = `${vibe}:${dedupKey(lon, lat)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        byVibe.get(vibe).push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: { vibe },
        });
      }
    }
    return byVibe;
  });

  DATASET_CACHE.set(cacheKey, promise);
  return promise;
}

export default async function density(ctx, uc) {
  const cityKey = (paramFor(uc, 'city') || 'amsterdam').toLowerCase();
  const city    = CITIES[cityKey] || CITIES.amsterdam;
  const palette = PALETTES[paramFor(uc, 'palette') || 'sunset'] || PALETTES['sunset'];
  const radiusM = RADIUS_M[paramFor(uc, 'radius') || '3000'] || 3000;

  // Chips: `undefined` = all selected (mirrors detail-panel renderer).
  const vibesParam = paramFor(uc, 'vibes');
  const selectedVibes = Array.isArray(vibesParam) ? vibesParam : ALL_VIBES;
  const vibes = selectedVibes.filter(v => VIBES[v]);

  /* Frame all the city's anchor zones — a fixed city-centre zoom would
     either hide the outer districts or shrink the inner ones. Adding a
     small lat/lng pad expands the bbox slightly so the heat circles
     drawn around the outer anchors don't get clipped by the viewport. */
  {
    const lngs = city.anchors.map(a => a[0]);
    const lats = city.anchors.map(a => a[1]);
    const lngPad = (Math.max(...lngs) - Math.min(...lngs)) * 0.15 || 0.01;
    const latPad = (Math.max(...lats) - Math.min(...lats)) * 0.15 || 0.01;
    ctx.fitBounds([
      [Math.min(...lngs) - lngPad, Math.min(...lats) - latPad],
      [Math.max(...lngs) + lngPad, Math.max(...lats) + latPad],
    ], { duration: 700, maxZoom: 13 });
  }

  if (!vibes.length) {
    ctx.setLegend({
      title: 'Vibe density',
      items: [
        { color: 'transparent', shape: 'dot', label: 'Pick at least one vibe to see where your mix concentrates' },
      ],
    });
    return;
  }

  ctx.setLegend({
    title: 'Vibe density',
    items: [
      { gradient: [palette.from, palette.hot], label: 'Low → High density' },
      { color: 'transparent', shape: 'dot', label: `Loading ${city.anchors.length} anchors × ${vibes.length} ${vibes.length === 1 ? 'vibe' : 'vibes'}…` },
    ],
  });

  // First render of a (city, radius) pays the full fetch; chip toggles
  // and palette changes afterwards resolve from cache instantly.
  const byVibe = await loadCityDataset(cityKey, radiusM);
  if (ctx.cancelled) return;

  // Client-side filter by the user's selected chips.
  const features = [];
  for (const v of vibes) {
    const arr = byVibe.get(v) || [];
    features.push(...arr);
  }

  ctx.addSource('wts-pts', { type: 'geojson', data: { type: 'FeatureCollection', features } });
  ctx.addLayer({
    id: 'wts-heat', type: 'heatmap', source: 'wts-pts',
    paint: {
      'heatmap-weight':    1,
      'heatmap-radius': [
        'interpolate', ['linear'], ['zoom'],
        10, 18, 13, 36, 15, 60,
      ],
      'heatmap-intensity': [
        'interpolate', ['linear'], ['zoom'],
        10, 0.7, 13, 1.1, 15, 1.5,
      ],
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0,    'rgba(0,0,0,0)',
        0.2,  palette.from,
        0.45, palette.mid,
        0.7,  palette.warm,
        1.0,  palette.hot,
      ],
      'heatmap-opacity': 0.6,
    },
  });

  ctx.setLegend({
    title: 'Vibe density',
    items: [
      { gradient: [palette.from, palette.hot], label: 'Low → High density' },
      { color: 'transparent', shape: 'dot', label: `${features.length} POIs · ${vibes.length} ${vibes.length === 1 ? 'vibe' : 'vibes'} · ${city.anchors.length} anchors` },
    ],
  });
}
