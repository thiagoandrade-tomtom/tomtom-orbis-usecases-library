/* Per-use-case starter files surfaced in the Quickstart → Code tab.

   Unlike the old single illustrative fragment, each case ships a small
   set of files that actually runs in a Vite project after
   `npm i @tomtom-org/maps-sdk maplibre-gl` and a VITE_TOMTOM_API_KEY in
   `.env`. The file selector in the panel lets the developer grab each
   one (index.html / app.js / styles.css).

   `{{paramKey}}` placeholders + the reserved live tokens (`__style`,
   `__lng`, `__lat`, `__zoom`, `__dasharray`, palette keys) follow the
   exact same convention as the rest of the panel — snippets.js resolves
   them against the live map view + Configure values at render time.

   Shape: CODE_SAMPLES[mapType] = [{ name, lang, code }]. The first
   entry is the default tab. */

/* ---- Shared scaffolding ------------------------------------------- */

const NPM = `// Scaffold a Vite app, then: npm i @tomtom-org/maps-sdk maplibre-gl`;

/* SDK init shared by every app.js — key from env, MapLibre worker wired
   before any map is built, global TomTom config for the REST helpers. */
const HEAD = `${NPM}
import { TomTomMap } from '@tomtom-org/maps-sdk/map';
import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker?url';

const KEY = import.meta.env.VITE_TOMTOM_API_KEY;
const API = 'https://api.tomtom.com';

// The geojson worker must be wired BEFORE any map is constructed, or
// custom layers (routes, polygons, heat) silently never render.
maplibregl.setWorkerUrl(workerUrl);
TomTomConfig.instance.put({ apiKey: KEY, apiVersion: 1, commonBaseURL: API });

const map = new TomTomMap({
  key: KEY,
  style: '{{__style}}',
  mapLibre: { container: 'map', center: [{{__lng}}, {{__lat}}], zoom: {{__zoom}} },
});
const ml = map.mapLibreMap;`;

/* Inline forward-geocode helper — used by most cases. */
const GEO = `// Forward-geocode an address → [lng, lat]
async function geocode(q) {
  const r = await fetch(
    \`\${API}/search/2/geocode/\${encodeURIComponent(q)}.json?key=\${KEY}&limit=1\`
  ).then((r) => r.json());
  const p = r.results?.[0]?.position;
  return p ? [p.lon, p.lat] : null;
}`;

/* Pull route polyline points out of a Routing API response. */
const ROUTE_POINTS = `// Flatten a Routing API response into [lng, lat] pairs
const toLine = (route) => ({
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: route.legs.flatMap((l) => l.points.map((p) => [p.longitude, p.latitude])),
  },
});`;

const FIT = `// Frame the geometry
function fit(coords, padding = 64) {
  const b = coords.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  ml.fitBounds(b, { padding });
}`;

function indexHtml(title) {
  return {
    name: 'index.html',
    lang: 'html',
    code: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · TomTom Orbis</title>
    <!-- MapLibre CSS sizes the canvas + controls. The Orbis SDK adds no CSS. -->
    <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css" />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="map"></div>
    <!-- Vite ESM entry. Put VITE_TOMTOM_API_KEY in .env first. -->
    <script type="module" src="./app.js"></script>
  </body>
</html>`,
  };
}

function stylesCss(extra = '') {
  return {
    name: 'styles.css',
    lang: 'css',
    code: `html,
body {
  margin: 0;
  height: 100%;
}
#map {
  position: absolute;
  inset: 0;
}${extra ? '\n' + extra : ''}`,
  };
}

const POPUP_CSS = `
.tt-popup {
  font: 13px/1.4 system-ui, sans-serif;
  min-width: 180px;
}
.tt-popup h3 {
  margin: 0 0 4px;
  font-size: 14px;
}
.tt-popup .muted {
  color: #6b7280;
}`;

/* ---- app.js bodies, one per case ---------------------------------- */

const ROUTE = `${HEAD}

${GEO}

${ROUTE_POINTS}

${FIT}

ml.on('load', async () => {
  const from = await geocode('{{from}}');
  const to = await geocode('{{to}}');

  // Routing API — primary route, traffic-aware
  const res = await fetch(
    \`\${API}/routing/1/calculateRoute/\${from[1]},\${from[0]}:\${to[1]},\${to[0]}/json\` +
      \`?key=\${KEY}&travelMode={{travelMode}}&traffic={{traffic}}\`
  ).then((r) => r.json());
  const line = toLine(res.routes[0]);

  ml.addSource('route', { type: 'geojson', data: line });
  ml.addLayer({
    id: 'route',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '{{routeColor}}',
      'line-width': {{lineWidth}},
      'line-dasharray': {{__dasharray}},
    },
  });

  new maplibregl.Marker().setLngLat(from).addTo(ml);
  new maplibregl.Marker({ color: '{{routeColor}}' }).setLngLat(to).addTo(ml);
  fit(line.geometry.coordinates);
});`;

const POI = `${HEAD}

${GEO}

ml.on('load', async () => {
  // Open tilted so the base-style 3D buildings get perspective
  const center = (await geocode('{{anchor}}')) || [4.8925, 52.3731];
  ml.jumpTo({ center, zoom: 16, pitch: 45, bearing: -18 });

  // Click any POI the basemap already renders — no overlay needed
  ml.on('click', async (e) => {
    const hit = ml
      .queryRenderedFeatures(e.point)
      .find((f) => /poi|place/i.test(f.layer?.id || ''));
    if (!hit) return;
    const [lng, lat] = hit.geometry.coordinates;

    // Enrich the click in parallel: address + full POI record
    const [rev, search] = await Promise.all([
      fetch(\`\${API}/search/2/reverseGeocode/\${lat},\${lng}.json?key=\${KEY}\`).then((r) => r.json()),
      fetch(
        \`\${API}/search/2/poiSearch/\${encodeURIComponent(hit.properties.name || '')}.json\` +
          \`?key=\${KEY}&lat=\${lat}&lon=\${lng}&radius=80&limit=1&openingHours=nextSevenDays\`
      ).then((r) => r.json()),
    ]);
    const poi = search.results?.[0]?.poi;
    const addr = rev.addresses?.[0]?.address?.freeformAddress || '';

    new maplibregl.Popup()
      .setLngLat([lng, lat])
      .setHTML(
        \`<div class="tt-popup"><h3>\${hit.properties.name || 'Place'}</h3>\` +
          \`<div class="muted">\${addr}</div>\` +
          (poi?.phone ? \`<div>\${poi.phone}</div>\` : '') +
          (poi?.url ? \`<div><a href="https://\${poi.url}">\${poi.url}</a></div>\` : '') +
          '</div>'
      )
      .addTo(ml);
  });
});`;

const EV = `${HEAD}

${GEO}

${FIT}

const palette = {
  available: '{{availableColor}}',
  occupied: '{{occupiedColor}}',
  unknown: '{{unknownColor}}',
};

ml.on('load', async () => {
  const center = (await geocode('{{anchor}}')) || [4.8810, 52.3580];

  // categorySet 7309 = EV charging station, 2.5 km radius
  const res = await fetch(
    \`\${API}/search/2/nearbySearch/.json?key=\${KEY}\` +
      \`&lat=\${center[1]}&lon=\${center[0]}&categorySet=7309&radius=2500&limit=30\`
  ).then((r) => r.json());
  const chargers = res.results || [];

  await Promise.all(
    chargers.map(async (c) => {
      // Live connector status per charger
      let status = 'unknown';
      const id = c.dataSources?.chargingAvailability?.id;
      if (id) {
        const a = await fetch(
          \`\${API}/search/2/chargingAvailability.json?key=\${KEY}&chargingAvailabilityId=\${id}\`
        ).then((r) => r.json());
        const avail = a.connectors?.some((x) => x.availability?.current?.available > 0);
        status = avail ? 'available' : 'occupied';
      }
      new maplibregl.Marker({ color: palette[status] })
        .setLngLat([c.position.lon, c.position.lat])
        .addTo(ml);
    })
  );

  if (chargers.length) fit(chargers.map((c) => [c.position.lon, c.position.lat]));
});`;

const MULTISTOP = `${HEAD}

${GEO}

${FIT}

ml.on('load', async () => {
  const from = await geocode('{{from}}');
  const to = await geocode('{{to}}');

  // Long-Distance EV Routing — TomTom inserts charging stops for us
  const res = await fetch(
    \`\${API}/routing/1/calculateLongDistanceEVRoute/\${from[1]},\${from[0]}:\${to[1]},\${to[0]}/json\` +
      \`?key=\${KEY}&vehicleEngineType=electric&currentChargeInkWh={{startCharge}}&maxChargeInkWh=75\` +
      \`&constantSpeedConsumptionInkWhPerHundredkm=50,8.2:130,21.3\`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chargingModes: [{ chargingConnections: [{ facilityType: 'Charge_400V', plugType: 'IEC62196Type2CableAttached' }] }] }),
    }
  ).then((r) => r.json());

  const route = res.routes[0];
  const coords = route.legs.flatMap((l) => l.points.map((p) => [p.longitude, p.latitude]));
  ml.addSource('ev-route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
  ml.addLayer({
    id: 'ev-route',
    type: 'line',
    source: 'ev-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '{{routeColor}}', 'line-width': {{lineWidth}}, 'line-dasharray': {{__dasharray}} },
  });

  // A charging stop sits at the end of every leg except the last
  route.legs.slice(0, -1).forEach((leg) => {
    const p = leg.points[leg.points.length - 1];
    new maplibregl.Marker({ color: '{{routeColor}}' }).setLngLat([p.longitude, p.latitude]).addTo(ml);
  });
  new maplibregl.Marker().setLngLat(from).addTo(ml);
  fit(coords);
});`;

const FLEET = `${HEAD}

${GEO}

${FIT}

// 8 vans across Amsterdam, tagged by status. Colours from Configure.
const VEHICLES = [
  { from: 'Dam Square, Amsterdam', to: 'Vondelpark, Amsterdam', status: 'on-route' },
  { from: 'Jordaan, Amsterdam', to: 'Amstel, Amsterdam', status: 'on-route' },
  { from: 'NDSM Wharf, Amsterdam', to: 'Zuidas, Amsterdam', status: 'delayed' },
  { from: 'Oosterpark, Amsterdam', to: 'Westerpark, Amsterdam', status: 'idle' },
  { from: 'Haarlem, NL', to: 'Amsterdam Centraal', status: 'outside-zone' },
];
const STATUS = {
  'on-route': '{{onRouteColor}}',
  idle: '{{idleColor}}',
  delayed: '{{alertColor}}',
  'outside-zone': '{{alertColor}}',
};

ml.on('load', async () => {
  // Geofence — the real Amsterdam municipality polygon
  const g = await fetch(
    \`\${API}/search/2/geocode/Amsterdam.json?key=\${KEY}&entityTypeSet=Municipality&limit=1\`
  ).then((r) => r.json());
  const boundaryId = g.results?.[0]?.dataSources?.geometry?.id;
  if (boundaryId) {
    const poly = await fetch(
      \`\${API}/search/2/additionalData.json?key=\${KEY}&geometries=\${boundaryId}&geometriesZoom=11\`
    ).then((r) => r.json());
    const geometry = JSON.parse(poly.additionalData[0].geometryData).features[0].geometry;
    ml.addSource('geofence', { type: 'geojson', data: { type: 'Feature', geometry } });

    // Tint everything OUTSIDE the zone, not inside — the operating area
    // stays the brightest thing on the map. One world-spanning ring with
    // the zone punched out as a hole. MapLibre only reads a ring as a
    // hole when it winds against the outer ring, so flip it if it doesn't.
    const winding = (r) => {
      let s = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
      }
      return Math.sign(s);
    };
    const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
    const zone = geometry.coordinates[0];
    const hole = winding(zone) === winding(world) ? [...zone].reverse() : zone;
    ml.addSource('geofence-mask', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [world, hole] } },
    });
    // On a dark basemap a translucent overlay only adds light, so swap in
    // a near-black scrim at ~0.6 there to dim the outside instead of glow.
    ml.addLayer({
      id: 'geofence-mask-fill',
      type: 'fill',
      source: 'geofence-mask',
      paint: { 'fill-color': '{{geofenceColor}}', 'fill-opacity': 0.22 },
    });
    ml.addLayer({
      id: 'geofence-line',
      type: 'line',
      source: 'geofence',
      paint: { 'line-color': '{{geofenceColor}}', 'line-width': 3, 'line-dasharray': {{__dasharray}} },
    });
  }

  // Snap each van to a real route, pin coloured by status
  for (const v of VEHICLES) {
    const a = await geocode(v.from);
    const b = await geocode(v.to);
    if (!a || !b) continue;
    new maplibregl.Marker({ color: STATUS[v.status] }).setLngLat(a).addTo(ml);
  }
});`;

const PACKAGE = `${HEAD}

${GEO}

${ROUTE_POINTS}

${FIT}

ml.on('load', async () => {
  const hub = await geocode('{{hub}}');
  const dest = await geocode('{{dest}}');

  // Hub → recipient, traffic-aware for a live ETA
  const res = await fetch(
    \`\${API}/routing/1/calculateRoute/\${hub[1]},\${hub[0]}:\${dest[1]},\${dest[0]}/json?key=\${KEY}&traffic=true\`
  ).then((r) => r.json());
  const route = res.routes[0];
  const line = toLine(route);

  ml.addSource('parcel', { type: 'geojson', data: line });
  ml.addLayer({
    id: 'parcel',
    type: 'line',
    source: 'parcel',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '{{routeColor}}', 'line-width': {{lineWidth}}, 'line-dasharray': {{__dasharray}} },
  });

  const etaMin = Math.round(route.summary.travelTimeInSeconds / 60);
  new maplibregl.Marker().setLngLat(hub).addTo(ml);
  new maplibregl.Marker({ color: '{{routeColor}}' })
    .setLngLat(dest)
    .setPopup(new maplibregl.Popup().setText(\`ETA ~\${etaMin} min\`))
    .addTo(ml);
  fit(line.geometry.coordinates);
});`;

const DELIVERY = `${HEAD}

${GEO}

${FIT}

// Depot + customer stops. TomTom returns the optimal visit order.
const ADDRESSES = [
  'Schiphol Airport, Amsterdam', // depot (origin AND final destination)
  'Dam Square, Amsterdam',
  'Vondelpark, Amsterdam',
  'Artis Zoo, Amsterdam',
  'Rijksmuseum, Amsterdam',
];

ml.on('load', async () => {
  const pts = (await Promise.all(ADDRESSES.map(geocode))).filter(Boolean);
  const depot = pts[0];

  // Routing API with computeBestOrder = TSP optimisation. Depot is
  // pinned as both the start and the end of the loop.
  const waypoints = [depot, ...pts.slice(1), depot].map((p) => \`\${p[1]},\${p[0]}\`).join(':');
  const res = await fetch(
    \`\${API}/routing/1/calculateRoute/\${waypoints}/json\` +
      \`?key=\${KEY}&traffic=true&computeBestOrder=true&travelMode=car\`
  ).then((r) => r.json());

  const coords = res.routes[0].legs.flatMap((l) => l.points.map((p) => [p.longitude, p.latitude]));
  ml.addSource('delivery', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
  ml.addLayer({
    id: 'delivery',
    type: 'line',
    source: 'delivery',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '{{routeColor}}', 'line-width': {{lineWidth}}, 'line-dasharray': {{__dasharray}} },
  });

  // Numbered stop pins in the optimised order
  pts.slice(1).forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'tt-num';
    el.textContent = String(i + 1);
    new maplibregl.Marker({ element: el }).setLngLat(p).addTo(ml);
  });
  new maplibregl.Marker({ color: '#646E7B' }).setLngLat(depot).addTo(ml);
  fit(coords);
});`;

const CITY = `${HEAD}

// 6 daily-life essentials, with TomTom category codes
const ESSENTIALS = [
  { key: 'groceries', q: 'supermarket' },
  { key: 'schools', cat: 7372 },
  { key: 'healthcare', cat: 7321 },
  { key: 'transit', cat: 9942 },
  { key: 'parks', cat: 9362 },
  { key: 'cafes', cat: 7315 },
];

ml.on('load', () => {
  ml.on('click', async (e) => {
    const { lng, lat } = e.lngLat;

    // Resolve the clicked point to its subdivision, then its polygon
    const rev = await fetch(\`\${API}/search/2/reverseGeocode/\${lat},\${lng}.json?key=\${KEY}\`).then((r) => r.json());
    const a = rev.addresses?.[0]?.address;
    const name = [a?.municipalitySubdivision, a?.municipality].filter(Boolean).join(', ');
    const geo = await fetch(
      \`\${API}/search/2/geocode/\${encodeURIComponent(name)}.json?key=\${KEY}&entityTypeSet=MunicipalitySubdivision&limit=1\`
    ).then((r) => r.json());
    const bId = geo.results?.[0]?.dataSources?.geometry?.id;
    if (bId) {
      const poly = await fetch(\`\${API}/search/2/additionalData.json?key=\${KEY}&geometries=\${bId}&geometriesZoom=12\`).then((r) => r.json());
      const geometry = JSON.parse(poly.additionalData[0].geometryData).features[0].geometry;
      const src = ml.getSource('area');
      const data = { type: 'Feature', geometry };
      if (src) src.setData(data);
      else {
        ml.addSource('area', { type: 'geojson', data });
        ml.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '{{fillColor}}', 'fill-opacity': 0.18 } });
        ml.addLayer({ id: 'area-outline', type: 'line', source: 'area', paint: { 'line-color': '{{strokeColor}}', 'line-width': {{strokeWidth}}, 'line-dasharray': {{__dasharray}} } });
      }
    }

    // 1.2 km walkability sweep — count essentials reachable
    const counts = await Promise.all(
      ESSENTIALS.map((es) => {
        const base = es.cat
          ? \`\${API}/search/2/nearbySearch/.json?key=\${KEY}&lat=\${lat}&lon=\${lng}&radius=1200&categorySet=\${es.cat}&limit=20\`
          : \`\${API}/search/2/poiSearch/\${es.q}.json?key=\${KEY}&lat=\${lat}&lon=\${lng}&radius=1200&limit=20\`;
        return fetch(base).then((r) => r.json()).then((j) => (j.results || []).length);
      })
    );
    const score = counts.filter((n) => n > 0).length;
    new maplibregl.Popup().setLngLat([lng, lat]).setHTML(\`<div class="tt-popup"><h3>\${name}</h3><div>\${score}/6 essentials within a 1.2 km walk</div></div>\`).addTo(ml);
  });
});`;

const DENSITY = `${HEAD}

// Multi-anchor sampling so the heatmap covers the whole metro, not a
// disc around one point. Add anchors for fuller coverage.
const ANCHORS = [
  [4.8925, 52.3731],
  [4.8896, 52.3584],
  [4.8721, 52.3667],
  [4.9041, 52.3676],
];
const VIBE_QUERIES = { dining: 'restaurant', cafes: 'cafe', nightlife: 'bar', sights: 'tourist attraction', parks: 'park', transit: 'public transport' };
const vibes = {{vibes}}; // array of selected keys

ml.on('load', async () => {
  // One Search call per (vibe, anchor) — fan out in parallel
  const jobs = [];
  for (const v of vibes) {
    for (const [lon, lat] of ANCHORS) {
      jobs.push(
        fetch(
          \`\${API}/search/2/poiSearch/\${encodeURIComponent(VIBE_QUERIES[v] || v)}.json\` +
            \`?key=\${KEY}&lat=\${lat}&lon=\${lon}&radius={{radius}}&limit=100\`
        ).then((r) => r.json())
      );
    }
  }
  const responses = await Promise.all(jobs);
  const features = responses.flatMap((res) =>
    (res.results || []).map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.position.lon, r.position.lat] },
    }))
  );

  ml.addSource('poi', { type: 'geojson', data: { type: 'FeatureCollection', features } });
  ml.addLayer({
    id: 'heat',
    type: 'heatmap',
    source: 'poi',
    paint: {
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(0,0,0,0)',
        0.2, '{{__paletteFrom}}',
        0.45, '{{__paletteMid}}',
        0.7, '{{__paletteWarm}}',
        1.0, '{{__paletteHot}}',
      ],
      'heatmap-radius': 28,
    },
  });
});`;

const SPORT = `${HEAD}

${FIT}

ml.on('load', async () => {
  // Demo: the TCS Amsterdam Marathon loop via multi-stop pedestrian
  // routing. Swap this for loadActivity('run.gpx') to replay a file.
  const loop = [
    [4.8852, 52.3434], // Olympic Stadium
    [4.8686, 52.3579], // Vondelpark
    [4.8952, 52.3702], // Centrum
    [4.9100, 52.3500], // Amstel
    [4.8852, 52.3434],
  ];
  const waypoints = loop.map((p) => \`\${p[1]},\${p[0]}\`).join(':');
  const res = await fetch(
    \`\${API}/routing/1/calculateRoute/\${waypoints}/json?key=\${KEY}&travelMode=pedestrian&traffic=false\`
  ).then((r) => r.json());
  const coords = res.routes[0].legs.flatMap((l) => l.points.map((p) => [p.longitude, p.latitude]));

  ml.addSource('track', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
  ml.addLayer({
    id: 'track',
    type: 'line',
    source: 'track',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '{{routeColor}}', 'line-width': {{lineWidth}}, 'line-dasharray': {{__dasharray}} },
  });
  new maplibregl.Marker().setLngLat(coords[0]).addTo(ml);
  fit(coords);
});`;

const SHARING = `${HEAD}

${GEO}

${FIT}

const BRANDS = [
  { color: '{{scooterColor}}', query: 'bicycle parking', count: 6 },
  { color: '{{bikeColor}}', query: 'bicycle parking', count: 6 },
  { color: '{{carColor}}', query: 'parking', count: 6 },
];

ml.on('load', async () => {
  const center = (await geocode('{{anchor}}')) || [4.8810, 52.3635];
  const placed = [];

  for (const brand of BRANDS) {
    // Real parking / bike-parking anchors, so vehicles sit on actual spots
    const res = await fetch(
      \`\${API}/search/2/poiSearch/\${encodeURIComponent(brand.query)}.json\` +
        \`?key=\${KEY}&lat=\${center[1]}&lon=\${center[0]}&radius=1500&limit=\${brand.count}\`
    ).then((r) => r.json());
    (res.results || []).forEach((p) => {
      const ll = [p.position.lon, p.position.lat];
      new maplibregl.Marker({ color: brand.color }).setLngLat(ll).addTo(ml);
      placed.push(ll);
    });
  }
  if (placed.length) fit(placed);
});`;

const HEATMAP = `${HEAD}

// Global sample grid, a cold→hot ramp, and the critical line (°C).
const FIELD = [-180, -56, 180, 75];          // [w, s, e, n]
const CRITICAL = 30;                          // ≥ this glows red
const RAMP = [[-30,'#3a2c86'],[0,'#4ea3e8'],[18,'#f4d35e'],[34,'#e8602f'],[44,'#9e1530']]; // palette: {{palette}}

function gridPoints(step = 9) {
  const [w, s, e, n] = FIELD, pts = [];
  for (let lon = w; lon < e; lon += step) for (let lat = s; lat < n; lat += step) pts.push([lon, lat]);
  return pts;
}

ml.on('load', async () => {
  const pts = gridPoints();
  const lat = pts.map((p) => p[1]).join(','), lon = pts.map((p) => p[0]).join(',');

  // 1. Open-Meteo — free, open, no key, CORS. Historical daily highs for
  //    the chosen day ({{period}}): recent dates use the forecast host
  //    (last ~92 days), older ones the archive host. {{unit}} only
  //    changes labels, the field stays °C.
  const day = resolveDate('{{period}}');  // e.g. yesterday / a year ago
  const rows = await fetch(
    \`https://api.open-meteo.com/v1/forecast?latitude=\${lat}&longitude=\${lon}&start_date=\${day}&end_date=\${day}&daily=temperature_2m_max&timezone=GMT\`
  ).then((r) => r.json());
  const samples = rows.map((row) => ({ lon: row.longitude, lat: row.latitude, t: row.daily.temperature_2m_max[0] }));

  // 2. Bilinearly interpolate the regular grid into a smooth field on a
  //    canvas, colour by RAMP, glow toward red ≥ CRITICAL, then clip to a
  //    land outline (Natural Earth, open data) so it stops at the coast.
  //    MapLibre's linear raster resampling does the final smoothing.
  const url = interpolateFieldToDataURL(samples, FIELD, RAMP, CRITICAL, landGeoJSON);

  // 3. One raster image over the whole world — pan anywhere, no crop.
  //    Slot it under the basemap labels so borders/names stay readable.
  ml.addSource('temp', {
    type: 'image', url,
    coordinates: [[FIELD[0], FIELD[3]], [FIELD[2], FIELD[3]], [FIELD[2], FIELD[1]], [FIELD[0], FIELD[1]]],
  });
  const water = ml.getStyle().layers.find((l) => l.type === 'fill' && l['source-layer'] === 'water');
  ml.addLayer({ id: 'temp-field', type: 'raster', source: 'temp', paint: { 'raster-resampling': 'linear' } }, water?.id);

  // Fly to the chosen region; the data underneath is global.
  flyToRegion('{{region}}');
});`;

const NUM_CSS = `
.tt-num {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: {{routeColor}};
  color: #fff;
  font: 700 12px/1 system-ui, sans-serif;
}`;

/* mapType → ordered file set. app.js first (default tab). */
export const CODE_SAMPLES = {
  route:     [{ name: 'app.js', lang: 'js', code: ROUTE },     indexHtml('Plan a route'),          stylesCss()],
  poi:       [{ name: 'app.js', lang: 'js', code: POI },       indexHtml('Discover places'),       stylesCss(POPUP_CSS)],
  ev:        [{ name: 'app.js', lang: 'js', code: EV },        indexHtml('Find an EV charger'),    stylesCss()],
  multistop: [{ name: 'app.js', lang: 'js', code: MULTISTOP }, indexHtml('Long-distance EV trip'), stylesCss()],
  fleet:     [{ name: 'app.js', lang: 'js', code: FLEET },     indexHtml('Track your fleet'),      stylesCss()],
  package:   [{ name: 'app.js', lang: 'js', code: PACKAGE },   indexHtml('Package tracker'),       stylesCss(POPUP_CSS)],
  delivery:  [{ name: 'app.js', lang: 'js', code: DELIVERY },  indexHtml('Live delivery dispatch'), stylesCss(NUM_CSS)],
  city:      [{ name: 'app.js', lang: 'js', code: CITY },      indexHtml('Neighbourhood analysis'), stylesCss(POPUP_CSS)],
  density:   [{ name: 'app.js', lang: 'js', code: DENSITY },   indexHtml('Vibe density'),          stylesCss()],
  sport:     [{ name: 'app.js', lang: 'js', code: SPORT },     indexHtml('Activity tracker'),      stylesCss()],
  sharing:   [{ name: 'app.js', lang: 'js', code: SHARING },   indexHtml('Shared mobility'),       stylesCss()],
  heatmap:   [{ name: 'app.js', lang: 'js', code: HEATMAP },   indexHtml('Temperature map'),       stylesCss()],
};

/** Files for a use case, falling back to a bare route example. */
export function filesForType(mapType) {
  return CODE_SAMPLES[mapType] || CODE_SAMPLES.route;
}

/* README bundled into the .zip so a downloaded use case is runnable
   without guessing the deps / env var / scaffold. The exported files are
   plain source; this is the "how to run it" that turns them into a
   working Vite app. Uses indented code blocks (no backticks) so it stays
   valid markdown inside this template literal. */
export function readmeFor(uc, fileNames = []) {
  const list = fileNames.map(n => '- ' + n).join('\n');
  return `# TomTom Orbis Maps — ${uc.title}

Starter files exported from the TomTom Orbis use-case library. They are
plain source that runs inside a Vite project.

## Files in this package
${list}

## Run it

1. Scaffold a Vite app and enter it:

        npm create vite@latest my-map -- --template vanilla
        cd my-map

2. Copy the files from this package into the project root, replacing the
   template's index.html / main.js / style.css.

3. Install the TomTom Orbis Maps SDK and MapLibre:

        npm i @tomtom-org/maps-sdk maplibre-gl

4. Add your TomTom API key in a .env file at the project root:

        VITE_TOMTOM_API_KEY=your_key_here

   Get a key at https://developer.tomtom.com/. The VITE_ prefix is
   required for Vite to expose it to the browser (import.meta.env).

5. Start the dev server:

        npm run dev
`;
}
