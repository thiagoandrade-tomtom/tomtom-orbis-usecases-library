/* Ask the map — replays.

   A replay stands in for the language model, nothing else: it decides
   which agent-toolkit tools to call and with what, and the real tools then
   run against live TomTom services on the real map. So the trace, the map
   and every number in the answer are live; only the plan is scripted.
   That keeps the case working — and free, and predictable on stage —
   when no model is connected.

   Each replay is a list of steps. A step sees the results of this turn's
   tool calls so far (`r`, in call order) and a `memo` that carries ids
   from one replay to its follow-up, and returns either the next tool
   calls, `{ calls: [[toolName, input], …] }`, or the closing answer,
   `{ text }`. Inputs follow the toolkit's own documented examples. */

const NEW_YORK_BOX = [-74.06, 40.60, -73.75, 40.88];
/* "Near X" searches anchor on fixed points: a name resolved against the
   viewport drifts wherever the last answer left the camera. */
const LOUVRE = [2.3376, 48.8606];
const SHIBUYA_CROSSING = [139.7005, 35.6595];
const OPERA_HOUSE = [151.2153, -33.8568];
const BURJ_KHALIFA = [55.2744, 25.1972];

/** Output of the last call to `name` in this turn. */
const out = (r, name) => [...r].reverse().find(x => x.name === name)?.out;
/** Whether that call worked: a failed one comes back as an error string or `{ error }`. */
const ok = (r, name) => { const o = out(r, name); return !!o && typeof o === 'object' && !('error' in o); };

/* Traffic flow colours of the TomTom style, per theme — the same ones the
   City live traffic case paints jams in: slow, queueing, stationary. */
const trafficColors = () => document.documentElement.getAttribute('data-theme') === 'dark'
  ? { slow: '#DB9200', queue: '#DA2E0B', stop: '#8F0000' }
  : { slow: '#FFC105', queue: '#FB2D09', stop: '#AD0000' };

const km = m => `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
const min = s => {
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
};

/* Route summaries come back under a few shapes depending on the tool;
   read whichever is there. */
function routeSummary(o) {
  const s = o?.summary || o?.routes?.[0]?.summary || o?.route?.summary || o?.primary?.summary;
  if (!s) return null;
  return {
    len: s.lengthInMeters ?? s.distanceMeters ?? s.lengthMeters,
    time: s.travelTimeInSeconds ?? s.durationSeconds ?? s.travelTimeSeconds,
    delay: s.trafficDelayInSeconds ?? s.trafficDelaySeconds ?? 0,
  };
}
const placesOf = o => o?.features || o?.places || o?.results || [];
/* A Dutch-style "coffeeshop" sells cannabis, not lunch — never the pick. */
const lunchable = o => placesOf(o).filter(p => !/coffee ?shop/i.test(nameOf(p)));
const nameOf = p => p?.name || p?.poi?.name || p?.title || p?.address || 'a spot nearby';
const posOf = p => p?.position || p?.coordinates || p?.geometry?.coordinates;
const datasetOf = o => o?.incidentsDatasetId || o?.placesDatasetId || o?.routesDatasetId || o?.datasetId || o?.id;

export const REPLAYS = {
  afternoon: {
    label: 'Plan a visit',
    prompt: 'Drive from the Louvre to Gare du Nord in Paris, with lunch at a café nearby.',
    follow: 'cafeSwap',
    steps: [
      () => ({ calls: [['discoverPlaces', {
        poiCategories: ['CAFE'],
        where: { mode: 'nearby', position: LOUVRE, radiusMeters: 500 },
        datasetId: 'lunch-cafes',
      }]] }),
      r => {
        const cafe = lunchable(out(r, 'discoverPlaces'))[0];
        return { calls: [['setRoute', {
          locations: [
            { query: 'Louvre Museum, Paris', queryAs: 'poi' },
            cafe?.id ? { placeIdOrDatasetId: cafe.id } : { query: 'café near the Louvre, Paris', queryAs: 'poi' },
            { query: 'Gare du Nord, Paris', queryAs: 'poi' },
          ],
          showOnMap: true,
        }]] };
      },
      r => {
        const found = out(r, 'discoverPlaces');
        const cafe = placesOf(found)[0];
        const s = routeSummary(out(r, 'setRoute'));
        return { text: s
          ? `**Louvre → ${nameOf(cafe)} → Gare du Nord**: ${km(s.len)}, ${min(s.time)} with traffic. ${found?.count ?? 'Other'} cafés within 500 m are on the map.`
          : `Lunch: ${nameOf(cafe)}. Route failed; try again.` };
      },
    ],
  },

  cafeSwap: {
    label: 'Make lunch vegetarian',
    prompt: 'Make lunch a vegetarian place.',
    steps: [
      () => ({ calls: [['discoverPlaces', {
        query: 'vegetarian restaurant',
        where: { mode: 'nearby', position: LOUVRE, radiusMeters: 800 },
        datasetId: 'lunch-veggie',
      }]] }),
      r => {
        const veg = placesOf(out(r, 'discoverPlaces'))[0];
        return { calls: [['replaceWaypointInRoute', {
          waypointIndex: 1,
          location: veg?.id ? { placeIdOrDatasetId: veg.id } : { query: 'vegetarian restaurant near the Louvre, Paris', queryAs: 'poi' },
          showOnMap: true,
        }]] };
      },
      r => {
        const veg = placesOf(out(r, 'discoverPlaces'))[0];
        const s = routeSummary(out(r, 'replaceWaypointInRoute'));
        return { text: !veg ? 'No vegetarian place within 800 m. Café kept.'
          : !ok(r, 'replaceWaypointInRoute') ? `Found ${nameOf(veg)}, but the route update failed.`
          : `Lunch is now **${nameOf(veg)}**.${s ? ` ${km(s.len)}, ${min(s.time)}.` : ''}` };
      },
    ],
  },

  jams: {
    label: 'Worst jams now',
    prompt: 'Worst traffic jams in New York right now? Chart the top 5.',
    follow: 'hotspots',
    steps: [
      () => ({ calls: [['getTrafficIncidents', {
        where: { mode: 'within', boundingBox: NEW_YORK_BOX },
        categoryFilter: ['jam'],
        label: 'New York',
        // A demo answer, not a control room: no background polling.
        monitor: false,
      }]] }),
      (r, memo) => {
        const id = memo.jams = datasetOf(out(r, 'getTrafficIncidents'));
        // Bars in the map's own traffic colours, by how bad the jam is.
        const c = trafficColors();
        return { calls: [['analyseData', {
          incidentsDatasetIDs: [id],
          name: 'top-5-jams-by-delay',
          description: 'Delay, top 5 jams (min)',
          outputFormat: 'chart',
          code: `const list = incidentsByDataset['${id}'] || [];
const rows = (Array.isArray(list) ? list : list.features || [])
  .map(f => { const p = f.properties || f; return { road: (p.roadNumbers || [])[0] || p.from || 'Unnamed road', delay: (p.delayInSeconds ?? p.delay ?? 0) / 60, mag: p.magnitudeOfDelay ?? 0 }; })
  .sort((a, b) => b.delay - a.delay).slice(0, 5);
const tone = r => r.mag >= 3 ? '${c.stop}' : r.mag === 2 ? '${c.queue}' : '${c.slow}';
return { type: 'bar', data: { labels: rows.map(r => r.road), datasets: [{ label: 'Delay (min)', data: rows.map(r => Math.round(r.delay)), backgroundColor: rows.map(tone), borderRadius: 4, barThickness: 14 }] }, options: { indexAxis: 'y', scales: { x: { grid: { display: false }, ticks: { precision: 0 } }, y: { grid: { display: false } } } } };`,
        }]] };
      },
      r => {
        const o = out(r, 'getTrafficIncidents');
        const n = o?.count ?? o?.total ?? o?.featureCount ?? o?.incidents?.length;
        if (!ok(r, 'getTrafficIncidents')) return { text: 'Traffic data didn\'t come back. Try again in a moment.' };
        return { text: n === 0
          ? 'No jams in New York right now.'
          : `${n != null ? `**${n} jams** in New York now. ` : ''}Top 5 by delay in the chart; all on the map.` };
      },
    ],
  },

  hotspots: {
    label: 'Group into hotspots',
    prompt: 'Group them into hotspots.',
    steps: [
      (r, memo) => ({ calls: [['clusterIncidents', { incidentsDatasetID: memo.jams, eps: 0.8, minMembers: 2 }]] }),
      r => {
        const o = out(r, 'clusterIncidents');
        const n = o?.clusters?.length ?? o?.clusterCount ?? o?.count;
        return { text: n != null
          ? `**${n} hotspot${n === 1 ? '' : 's'}**, outlined on the map.`
          : 'Hotspots outlined on the map.' };
      },
    ],
  },

  chargers: {
    label: 'Chargers on the way',
    prompt: 'Route San Francisco to San José and find EV chargers on the way.',
    follow: 'chargerStop',
    steps: [
      () => ({ calls: [['setRoute', { locations: [{ query: 'San Francisco, CA', queryAs: 'place' }, { query: 'San Jose, CA', queryAs: 'place' }], showOnMap: true }]] }),
      () => ({ calls: [['discoverPlaces', {
        poiCategories: ['CHARGING_LOCATION'],
        where: { mode: 'within', route: { widthMeters: 1000 } },
        datasetId: 'route-chargers',
      }]] }),
      (r, memo) => {
        memo.charger = placesOf(out(r, 'discoverPlaces'))[0];
        const s = routeSummary(out(r, 'setRoute'));
        const n = out(r, 'discoverPlaces')?.count ?? placesOf(out(r, 'discoverPlaces')).length;
        return { text: `${s ? `**${km(s.len)}**, **${min(s.time)}** with traffic${s.delay > 60 ? ` (${min(s.delay)} delay)` : ''}. ` : ''}${n ? `**${n >= 100 ? '100+' : n} chargers** within 1 km of the route.` : 'No chargers within 1 km of the route.'}` };
      },
    ],
  },

  chargerStop: {
    label: 'Add a charging stop',
    prompt: 'Add the first charger as a stop.',
    steps: [
      (r, memo) => ({ calls: [['addWaypointsToRoute', {
        stops: [{ placeIdOrDatasetId: memo.charger?.id || 'route-chargers' }],
        showOnMap: true,
      }]] }),
      (r, memo) => {
        const s = routeSummary(out(r, 'addWaypointsToRoute'));
        return { text: ok(r, 'addWaypointsToRoute')
          ? `Stop added: **${nameOf(memo.charger)}**.${s ? ` Now ${km(s.len)}, ${min(s.time)}.` : ''}`
          : 'Adding the stop failed.' };
      },
    ],
  },

  dusk: {
    label: 'Dusk look',
    prompt: 'Dusk look: warm light on Dubai\'s Burj Khalifa.',
    follow: 'noPois',
    steps: [
      () => ({ calls: [['showCity3D', { look: 'dusk' }]] }),
      () => ({ calls: [['setMapStyling', { theme: { colors: ['#4a3d63', '#7d6390', '#f0a878', '#ffe0bf'] } }]] }),
      () => ({ calls: [['flyTo', { where: { position: BURJ_KHALIFA, zoom: 15.3 } }]] }),
      // A gentler tilt than the tour: all 828 m of the tower stay on screen.
      () => ({ calls: [['setPitchBearing', { pitch: 50, bearing: -15 }]] }),
      r => ({ text: r.every(x => x.out && typeof x.out === 'object' && !('error' in x.out))
        ? 'Downtown Dubai at dusk: warm sun on the towers, windows coming on.'
        : 'Part of the look failed; see the red steps.' }),
    ],
  },

  noPois: {
    label: 'Hide POI icons',
    prompt: 'Hide POI icons too.',
    steps: [
      () => ({ calls: [['setMapStyling', { set: { 'pois.visible': false } }]] }),
      () => ({ text: 'POI icons hidden.' }),
    ],
  },

  tour3d: {
    label: '3D tour',
    prompt: 'Fly to the Sydney Opera House in 3D and circle it.',
    // One camera move per step: the trace shows the agent steering the map.
    // showCity3D is this case's own tool, added to the toolkit's defaults.
    steps: [
      () => ({ calls: [['showCity3D', {}]] }),
      () => ({ calls: [['flyTo', { where: { position: OPERA_HOUSE, zoom: 16 } }]] }),
      // Opera House in front, then round to the CBD towers behind it (south-west).
      () => ({ calls: [['setPitchBearing', { pitch: 60, bearing: 140 }]] }),
      () => ({ calls: [['setPitchBearing', { bearing: -175 }]] }),
      () => ({ calls: [['setPitchBearing', { bearing: -135 }]] }),
      r => ({ text: r.every(x => x.out && typeof x.out === 'object' && !('error' in x.out))
        ? 'Sydney Opera House and the CBD in 3D. Right-drag to orbit.'
        : 'Part of the tour failed; see the red steps.' }),
    ],
  },

  coffee: {
    label: 'Cafés near Shibuya',
    prompt: 'Cafés within a 5-minute walk of Shibuya Crossing, Tokyo.',
    steps: [
      () => ({ calls: [['discoverPlaces', {
        poiCategories: ['CAFE'],
        where: { mode: 'nearby', position: SHIBUYA_CROSSING, radiusMeters: 400 },
        show: { markerType: 'pin', zoomMode: 'auto' },
      }]] }),
      r => {
        const found = out(r, 'discoverPlaces');
        const list = lunchable(found);
        return { text: list.length
          ? `**${found.count ?? list.length} cafés** within 400 m, incl. ${list.slice(0, 3).map(nameOf).join(', ')}.`
          : 'No cafés within 400 m of Shibuya Crossing.' };
      },
    ],
  },

  outline: {
    label: 'Outline two cities',
    prompt: 'Outline São Paulo and Rio de Janeiro on the map.',
    steps: [
      () => ({ calls: [
        ['locatePlace', { query: 'São Paulo, Brazil', queryAs: 'place', where: { mode: 'global' }, datasetId: 'sao-paulo-city', geometry: { show: true } }],
        ['locatePlace', { query: 'Rio de Janeiro, Brazil', queryAs: 'place', where: { mode: 'global' }, datasetId: 'rio-city', geometry: { show: true, mode: 'add' } }],
      ] }),
      () => ({ text: 'Both boundaries outlined, from TomTom geometry.' }),
    ],
  },
};

/* The prompts a conversation can open with. The panel shows them in a
   fresh random order on every visit — the first SHOWN up front, the rest
   behind "More" — so a returning visitor meets a different city first. */
export const ENTRY = ['tour3d', 'afternoon', 'jams', 'chargers', 'coffee', 'dusk', 'outline'];
export const SHOWN = 4;
