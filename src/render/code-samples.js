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

import workerPluginSrc from '../../vite/maplibre-worker.js?raw';
import { GET_STARTED } from '../data/get-started.js';
import { TOOL_DOCS } from '../data/use-cases.js';

const NPM = `// Setup, in order (details in README.md):
// 1. Free API key at ${GET_STARTED.signup} → Products → Maps SDK for JavaScript
// 2. npm create vite@latest my-map -- --template vanilla, then copy these files in
// 3. ${GET_STARTED.install}
// 4. .env → ${GET_STARTED.envVar}=your_key
// 5. ${GET_STARTED.run} (keep vite.config.js — MapLibre's worker needs it)`;

/* SDK init shared by every app.js — key from env, MapLibre worker wired
   before any map is built, global TomTom config for the REST helpers. */
const HEAD = `${NPM}
import { TomTomMap } from '@tomtom-org/maps-sdk/map';
import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css'; // sizes the canvas + controls; the SDK ships no CSS

const KEY = import.meta.env.VITE_TOMTOM_API_KEY;
const API = 'https://api.tomtom.com';

// Any failure shows on the page as well as in the console — never a blank map.
function fail(err) {
  console.error(err);
  const note = document.querySelector('.note') ||
    document.body.appendChild(Object.assign(document.createElement('div'), { className: 'note' }));
  note.textContent = String(err?.message || err);
}
window.addEventListener('unhandledrejection', (e) => fail(e.reason));
if (!KEY) fail('No API key: add VITE_TOMTOM_API_KEY to .env, then restart npm run dev.');

// JSON from an endpoint. A free key allows ~5 requests a second, so calls
// leave at least 220 ms apart and a 429 (or a gateway hiccup) waits and
// retries; any other error throws.
let nextSlot = 0;
async function getJson(url, init) {
  for (let attempt = 1; ; attempt++) {
    const wait = nextSlot - Date.now();
    nextSlot = Math.max(nextSlot, Date.now()) + 220;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(url, init);
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    const { host, pathname } = new URL(url);
    throw new Error(\`\${res.status} from \${host}\${pathname}\${res.status === 403 ? ' — is this API enabled for your key?' : ''}\`);
  }
}

// The geojson worker must be wired BEFORE any map is constructed, or
// custom layers (routes, polygons, heat) silently never render.
maplibregl.setWorkerUrl(workerUrl);
TomTomConfig.instance.put({ apiKey: KEY, commonBaseURL: API });

const map = new TomTomMap({
  apiKey: KEY,
  style: '{{__style}}',
  mapLibre: { container: 'map', center: [{{__lng}}, {{__lat}}], zoom: {{__zoom}} },
});
const ml = map.mapLibreMap;
// Style and layer errors (a bad paint value, a missing source) — not tile misses.
ml.on('error', (e) => { if (!e.sourceId) fail(e.error); });`;

/* Inline forward-geocode helper — used by most cases. */
const GEO = `// Place name → [lng, lat]. Fuzzy Search resolves landmarks, POIs and
// addresses alike (/search/2/geocode only matches street addresses).
async function geocode(q) {
  const r = await getJson(\`\${API}/search/2/search/\${encodeURIComponent(q)}.json?key=\${KEY}&limit=1\`);
  const p = r.results?.[0]?.position;
  if (!p) throw new Error(\`No place found for "\${q}"\`);
  return [p.lon, p.lat];
}`;

/* Bounded parallelism for the cases that fan out many Search calls. */
const POOL = `// Run fn over items, at most n at a time — stays under the key's rate limit.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
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

function indexHtml(title, extraBody = '') {
  return {
    name: 'index.html',
    lang: 'html',
    code: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · TomTom Orbis</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="map"></div>${extraBody ? `\n    ${extraBody}` : ''}
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
}
.note {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 32px;
  padding: 10px 14px;
  border-radius: 8px;
  background: #b42318;
  color: #fff;
  font: 13px/1.4 system-ui, sans-serif;
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

const STEPS_CSS = `
#steps {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 300px;
  max-height: calc(100% - 32px);
  overflow: auto;
  margin: 0;
  padding: 8px 8px 8px 32px;
  background: #fff;
  border-radius: 8px;
  font: 13px/1.4 system-ui, sans-serif;
}
#steps li {
  padding: 8px;
  cursor: pointer;
}
#steps li:hover {
  background: #f2f2f2;
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
  const res = await getJson(
    \`\${API}/routing/1/calculateRoute/\${from[1]},\${from[0]}:\${to[1]},\${to[0]}/json\` +
      \`?key=\${KEY}&travelMode={{travelMode}}&traffic={{traffic}}\`
  );
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
  const center = await geocode('{{anchor}}');
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
      getJson(\`\${API}/search/2/reverseGeocode/\${lat},\${lng}.json?key=\${KEY}\`),
      getJson(
        \`\${API}/search/2/poiSearch/\${encodeURIComponent(hit.properties.name || '')}.json\` +
          \`?key=\${KEY}&lat=\${lat}&lon=\${lng}&radius=80&limit=1&openingHours=nextSevenDays\`
      ),
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

${POOL}

const DETAIL_Z = 14.5;   // below: every charger as a dot · above: live free / total
const HALF = 3000;       // metres — the square to cover around the anchor

// One Nearby Search page stops at 100 results, so a city needs many small
// searches: split any cell that comes back full into four, search again.
async function coverSquare(center, half) {
  const mx = 111320 * Math.cos((center[1] * Math.PI) / 180), my = 110540;
  const seen = new Map();
  let queue = [{ x: 0, y: 0, h: half }];
  while (queue.length) {
    const batch = queue.splice(0, 4);
    await Promise.all(batch.map(async (c) => {
      const lon = center[0] + c.x / mx, lat = center[1] + c.y / my;
      const res = await getJson(
        \`\${API}/search/2/nearbySearch/.json?key=\${KEY}&lat=\${lat}&lon=\${lon}\` +
          \`&radius=\${Math.ceil(c.h * Math.SQRT2)}&categorySet=7309&limit=100\`
      );
      const results = res.results || [];
      if (results.length >= 100 && c.h > 150) {
        const q = c.h / 2;
        queue.push({ x: c.x - q, y: c.y - q, h: q }, { x: c.x + q, y: c.y - q, h: q },
                   { x: c.x - q, y: c.y + q, h: q }, { x: c.x + q, y: c.y + q, h: q });
        return;
      }
      for (const r of results) {
        const dx = (r.position.lon - center[0]) * mx - c.x, dy = (r.position.lat - center[1]) * my - c.y;
        if (Math.abs(dx) <= c.h && Math.abs(dy) <= c.h) seen.set(r.id, r);
      }
    }));
  }
  return [...seen.values()];
}

ml.on('load', async () => {
  const center = await geocode('{{anchor}}');
  ml.flyTo({ center, zoom: 12 });
  const chargers = await coverSquare(center, HALF);

  // City level — every charger as a dot, shaded by top connector power.
  const kw = (r) => Math.max(0, ...(r.chargingPark?.connectors || []).map((c) => c.ratedPowerKW || 0));
  ml.addSource('ev', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: chargers.map((r) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [r.position.lon, r.position.lat] },
        properties: { kw: kw(r) },
      })),
    },
  });
  ml.addLayer({
    id: 'ev-dots', type: 'circle', source: 'ev', maxzoom: DETAIL_Z,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.3, 14, 3.6],
      'circle-color': ['step', ['get', 'kw'], '#9AA3AE', 1, '#A6D8B2', 12, '#62B77A', 50, '#2F8F46', 150, '#14532D'],
    },
  });

  // Neighbourhood level — live free / total from the EV Charging
  // Availability API, for the chargers on screen that have a live feed.
  const live = async (r) => {
    const id = r.dataSources?.chargingAvailability?.id;
    if (!id) return null;
    const res = await getJson(\`\${API}/search/2/chargingAvailability.json?key=\${KEY}&chargingAvailability=\${id}\`);
    let free = 0, total = 0;
    for (const c of res.connectors || []) {
      const now = c.availability?.current || {};
      free += now.available ?? 0;
      total += ['available', 'occupied', 'reserved', 'unknown', 'outOfService']
        .reduce((n, k) => n + (now[k] ?? 0), 0) || (c.total ?? 0);
    }
    return total ? { free, total } : null;
  };
  ml.addSource('ev-live', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  ml.addLayer({
    id: 'ev-live', type: 'symbol', source: 'ev-live', minzoom: DETAIL_Z,
    layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto-Bold'], 'text-size': 13 },
    paint: {
      'text-color': ['case', ['>', ['get', 'free'], 0], '#2F8F46', '#C0392B'],
      'text-halo-color': '#FFFFFF', 'text-halo-width': 1.4,
    },
  });
  ml.on('moveend', async () => {
    if (ml.getZoom() < DETAIL_Z) return;
    const b = ml.getBounds();
    const inView = chargers.filter((r) => b.contains([r.position.lon, r.position.lat])).slice(0, 60);
    const states = await pool(inView, 4, (r) => live(r).catch(() => null));
    ml.getSource('ev-live').setData({
      type: 'FeatureCollection',
      features: inView.flatMap((r, i) => states[i] ? [{
        type: 'Feature', geometry: { type: 'Point', coordinates: [r.position.lon, r.position.lat] },
        properties: { free: states[i].free, label: \`\${r.poi?.name ?? 'Charger'}\\n\${states[i].free}/\${states[i].total} free\` },
      }] : []),
    });
  });
});`;

const MULTISTOP = `${HEAD}

${GEO}

${FIT}

// Tesla Model 3 Long Range AWD — EV Database figures (ev-database.org/car/1591):
// 75 kWh usable, 250 kW peak DC, 10 → 80% in 27 min, 107 / 163 Wh/km city / 110 km/h.
const CAP = 75, DC_PEAK = 250;

// Consumption at 50, 110 and 130 km/h (130 from E = r + a·v² through the other two).
const consumption = '50,10.7:110,16.3:130,19.1';

// Charging curve: peak power to 20%, then P = peak · e^(−k·(soc − 20)). k = 0.027
// makes 10 → 80% take the measured 27 min. The API wants the cumulative
// seconds to reach each charge level, ending at a full battery.
const powerAt = (soc) => DC_PEAK * (soc <= 20 ? 1 : Math.exp(-0.027 * (soc - 20)));
const chargingCurve = [];
for (let soc = 0, t = 0; soc < 100; soc += 1) {
  t += (CAP / 100) / powerAt(soc) * 3600;
  if ((soc + 1) % 10 === 0) chargingCurve.push({ chargeInkWh: (CAP * (soc + 1)) / 100, timeToChargeInSeconds: Math.round(t) });
}

const km = (m) => \`\${Math.round(m / 1000)} km\`;
const min = (s) => \`\${Math.max(1, Math.round(s / 60))} min\`;
const pct = (kwh) => \`\${Math.round((kwh / CAP) * 100)}%\`;

ml.on('load', async () => {
  const from = await geocode('{{from}}');
  const to = await geocode('{{to}}');

  // One call plans the trip — Long Distance EV Routing inserts real charging
  // parks, and never arrives at a charger or the destination below the reserve.
  const q = new URLSearchParams({
    key: KEY, vehicleEngineType: 'electric', traffic: 'true',
    constantSpeedConsumptionInkWhPerHundredkm: consumption,
    maxChargeInkWh: CAP, currentChargeInkWh: (CAP * {{startCharge}}) / 100,
    minChargeAtDestinationInkWh: (CAP * {{reserve}}) / 100,
    minChargeAtChargingStopsInkWh: (CAP * {{reserve}}) / 100,
    vehicleWeight: 1919,
  });
  const res = await getJson(\`\${API}/routing/1/calculateLongDistanceEVRoute/\${from[1]},\${from[0]}:\${to[1]},\${to[0]}/json?\${q}\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chargingModes: [{
        chargingConnections: [{ facilityType: 'Charge_Direct_Current_above_50kW', plugType: 'Combo_to_IEC_62196_Type_2_Base' }],
        chargingCurve,
      }],
    }),
  });
  const route = res.routes[0];
  const coords = route.legs.flatMap((l) => l.points.map((p) => [p.longitude, p.latitude]));

  ml.addSource('trip', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
  ml.addLayer({
    id: 'trip', type: 'line', source: 'trip',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '{{routeColor}}', 'line-width': 6 },
  });
  fit(coords);

  // The trip as steps: drive → charge → … → arrive. Click one to fly there.
  const steps = [];
  route.legs.forEach((leg) => {
    const s = leg.summary;
    const legCoords = leg.points.map((p) => [p.longitude, p.latitude]);
    steps.push({
      text: \`Drive \${km(s.lengthInMeters)} · \${min(s.travelTimeInSeconds)} — arrive at \${pct(s.remainingChargeAtArrivalInkWh)}\`,
      go: () => fit(legCoords),
    });
    const stop = s.chargingInformationAtEndOfLeg;
    if (stop) {
      const c = stop.chargingParkLocation.coordinate;
      const at = [c.longitude, c.latitude];
      new maplibregl.Marker({ color: '{{routeColor}}' }).setLngLat(at).addTo(ml);
      steps.push({
        text: \`Charge \${min(stop.chargingTimeInSeconds)} at \${stop.chargingParkName} — \${pct(s.remainingChargeAtArrivalInkWh)} → \${pct(stop.targetChargeInkWh)}\`,
        go: async () => {
          ml.flyTo({ center: at, zoom: 14.5 });
          // Live status of the park the route really uses.
          const live = await getJson(
            \`\${API}/search/2/chargingAvailability.json?key=\${KEY}&chargingAvailability=\${stop.chargingParkUuid}\`
          );
          const free = (live.connectors || []).reduce((n, c) => n + (c.availability?.current?.available ?? 0), 0);
          new maplibregl.Popup({ offset: 40 })
            .setLngLat(at)
            .setHTML(\`<b>\${stop.chargingParkName}</b><br>\${free} points free now\`)
            .addTo(ml);
        },
      });
    }
  });
  steps.push({ text: \`Arrive — battery \${pct(route.summary.remainingChargeAtArrivalInkWh)}\`, go: () => ml.flyTo({ center: to, zoom: 13 }) });

  const list = document.getElementById('steps');
  for (const st of steps) {
    const li = document.createElement('li');
    li.textContent = st.text;
    li.onclick = st.go;
    list.appendChild(li);
  }
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
  const g = await getJson(
    \`\${API}/search/2/geocode/Amsterdam.json?key=\${KEY}&entityTypeSet=Municipality&limit=1\`
  );
  const boundaryId = g.results?.[0]?.dataSources?.geometry?.id;
  if (boundaryId) {
    const poly = await getJson(
      \`\${API}/search/2/additionalData.json?key=\${KEY}&geometries=\${boundaryId}&geometriesZoom=11\`
    );
    const geometry = poly.additionalData[0].geometryData.features[0].geometry; // a FeatureCollection
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
    const zone = geometry.type === 'MultiPolygon' ? geometry.coordinates[0][0] : geometry.coordinates[0];
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
  const res = await getJson(
    \`\${API}/routing/1/calculateRoute/\${hub[1]},\${hub[0]}:\${dest[1]},\${dest[0]}/json?key=\${KEY}&traffic=true\`
  );
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
import { TrafficFlowModule, TrafficIncidentsModule } from '@tomtom-org/maps-sdk/map';

${FIT}

// Depot + drops, pre-resolved — this demo is about Routing, not geocoding.
const DEPOT = [4.833147, 52.406885];
const STOPS = [
  { id: '#A-1042', name: 'M. Visser',   at: [4.898071, 52.356337] },
  { id: '#A-1043', name: 'L. Janssen',  at: [4.895798, 52.360431] },
  { id: '#A-1044', name: 'S. Bakker',   at: [4.930133, 52.370346] },
  { id: '#A-1045', name: 'K. de Vries', at: [4.926288, 52.359124] },
  { id: '#A-1046', name: 'P. Mulder',   at: [4.894012, 52.353722] },
  { id: '#A-1047', name: 'A. de Boer',  at: [4.871467, 52.367752] },
];

// An electric van: with a consumption model every leg summary carries
// batteryConsumptionInkWh, so a run costs kWh as well as km and minutes.
const VEHICLE = {
  vehicleEngineType: 'electric',
  constantSpeedConsumptionInkWhPerHundredkm: '50,22.0:80,26.0:110,33.0',
  currentChargeInkWh: 66,
  maxChargeInkWh: 75,
  auxiliaryPowerInkW: 1.5,
};

// One round trip, depot pinned at both ends. sequence = null lets TomTom
// pick the fastest visit order (computeBestOrder); otherwise it's routed
// exactly as given.
async function route(sequence) {
  const visit = sequence || STOPS;
  const locs = [DEPOT, ...visit.map((s) => s.at), DEPOT].map(([lng, lat]) => \`\${lat},\${lng}\`).join(':');
  const q = new URLSearchParams({ key: KEY, traffic: 'true', computeBestOrder: String(!sequence), ...VEHICLE });
  const res = await getJson(\`\${API}/routing/1/calculateRoute/\${locs}/json?\${q}\`);
  const r = res.routes[0];
  const legs = r.legs.map((l) => ({ summary: l.summary, points: l.points.map((p) => [p.longitude, p.latitude]) }));
  return { order: sequence || orderFromLegs(legs), legs, summary: r.summary };
}

// The visit order, read from the legs themselves: match each leg's end
// to its stop. The legs ARE the polyline, so the pin numbers always
// follow the line.
function orderFromLegs(legs) {
  return legs.slice(0, -1).map((l) => {
    const [x, y] = l.points.at(-1);
    return STOPS.reduce((a, s) => ((s.at[0] - x) ** 2 + (s.at[1] - y) ** 2 < (a.at[0] - x) ** 2 + (a.at[1] - y) ** 2 ? s : a));
  });
}

const km = (m) => \`\${(m / 1000).toFixed(1)} km\`;
const min = (s) => \`\${Math.round(s / 60)} min\`;
const kwh = (k) => \`\${(k || 0).toFixed(1)} kWh\`;

// Direction chevron, drawn once as an SDF so the layer sets its colour.
function addChevron() {
  const px = 2, c = document.createElement('canvas');
  c.width = c.height = 16 * px;
  const g = c.getContext('2d');
  g.strokeStyle = '#000'; g.lineWidth = 2.6 * px; g.lineCap = g.lineJoin = 'round';
  g.beginPath(); g.moveTo(5.5 * px, 3.5 * px); g.lineTo(10.5 * px, 8 * px); g.lineTo(5.5 * px, 12.5 * px); g.stroke();
  ml.addImage('chevron', g.getImageData(0, 0, c.width, c.height), { pixelRatio: px, sdf: true });
}

let pins = [];
function draw(run) {
  const n = run.order.length;
  const join = (legs) => legs.flatMap((l, i) => (i ? l.points.slice(1) : l.points));
  ml.getSource('run').setData({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { kind: 'delivery' }, geometry: { type: 'LineString', coordinates: join(run.legs.slice(0, n)) } },
      { type: 'Feature', properties: { kind: 'return' }, geometry: { type: 'LineString', coordinates: run.legs[n].points } },
    ],
  });
  pins.forEach((m) => m.remove());
  pins = run.order.map((s, i) => {
    const el = document.createElement('div');
    el.className = 'tt-num';
    el.textContent = String(i + 1);
    const leg = run.legs[i].summary;
    return new maplibregl.Marker({ element: el })
      .setLngLat(s.at)
      .setPopup(new maplibregl.Popup().setText(\`\${s.name} · \${km(leg.lengthInMeters)} · \${min(leg.travelTimeInSeconds)} · \${kwh(leg.batteryConsumptionInkWh)}\`))
      .addTo(ml);
  });
}

// What one run saves over another, in km, minutes and kWh.
const diff = (a, b) => \`\${km(a.summary.lengthInMeters - b.summary.lengthInMeters)} · \` +
  \`\${min(a.summary.travelTimeInSeconds - b.summary.travelTimeInSeconds)} · \` +
  \`\${kwh(a.summary.batteryConsumptionInkWh - b.summary.batteryConsumptionInkWh)}\`;
const say = (html) => { document.getElementById('summary').innerHTML = html; };

let fastest;
ml.on('load', async () => {
  if ({{trafficFlow}}) await TrafficFlowModule.get(map, { visible: true });
  if ({{trafficIncidents}}) await TrafficIncidentsModule.get(map, { visible: true });

  // Each leg keeps to the right of its direction, half a line over, so a
  // street driven out and back reads as two lanes, each with its arrows.
  const lane = ({{lineWidth}} + 3) / 2;
  addChevron();
  ml.addSource('run', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  ml.addLayer({
    id: 'run', type: 'line', source: 'run',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '{{routeColor}}', 'line-width': {{lineWidth}}, 'line-dasharray': {{__dasharray}}, 'line-offset': lane,
      'line-opacity': ['match', ['get', 'kind'], 'return', 0.6, 1],
    },
  });
  ml.addLayer({
    id: 'run-arrows', type: 'symbol', source: 'run',
    layout: {
      'symbol-placement': 'line', 'symbol-spacing': 48, 'icon-image': 'chevron',
      'icon-size': {{lineWidth}} / 18, 'icon-offset': [0, lane / ({{lineWidth}} / 18)],
      'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-keep-upright': false,
    },
    paint: { 'icon-color': '#fff', 'icon-opacity': ['match', ['get', 'kind'], 'return', 0.55, 0.95] },
  });
  new maplibregl.Marker({ color: '#646E7B' }).setLngLat(DEPOT).addTo(ml);

  // The fastest order, and the order the drops came in — the yardstick
  // for what TomTom's optimisation saved.
  const [best, received] = await Promise.all([route(null), route(STOPS)]);
  fastest = best;
  draw(best);
  say(\`<b>Fastest delivery route</b> · optimized by TomTom<br>Saves \${diff(received, best)} over the order received\`);
  fit(best.legs.flatMap((l) => l.points));
});

// A dispatcher's own order — wire this to your list's drop + confirm,
// e.g. routeInOrder(['#A-1045', '#A-1042', …]).
window.routeInOrder = async (ids) => {
  const mine = await route(ids.map((id) => STOPS.find((s) => s.id === id)));
  draw(mine);
  say(\`<b>Your order</b><br>\${diff(mine, fastest)} against the fastest route\`);
};`;


const CITY = `${HEAD}

// Walk grade on a honeycomb: sample essentials from a lattice of anchors,
// then grade every hex cell client-side — no API call per cell.
// Car-free living: bus stop at the corner, a metro / train station within
// a walk, a supermarket, a park. (In production, bake this sampling into a
// JSON file offline and load that — POIs change slowly.)
const ESSENTIALS = [
  { key: 'bus', cat: 9942, w: 3, k: 3, full: 150, tau: 300 },
  { key: 'rail', cat: 7380, w: 3, k: 1, full: 400, tau: 700 },
  { key: 'groceries', q: 'supermarket', w: 3, k: 1, full: 150, tau: 360 },
  { key: 'parks', cat: 9362, w: 1, k: 1, full: 200, tau: 500 },
];
const RADIUS_KM = 6, SPACING = 3000, SEARCH_R = 2200, HEX = 700;
const [lon0, lat0] = ml.getCenter().toArray();
const mx = 111320 * Math.cos((lat0 * Math.PI) / 180), my = 110540;
const toLL = ([x, y]) => [lon0 + x / mx, lat0 + y / my];
const toXY = ([lon, lat]) => [(lon - lon0) * mx, (lat - lat0) * my];

// Strict curves: a supermarket five minutes away is already an errand.
const decay = (e, m) => (m <= e.full ? 1 : Math.exp(-(m - e.full) / e.tau));

async function sample() {
  const pts = Object.fromEntries(ESSENTIALS.map((e) => [e.key, []]));
  const n = Math.ceil((RADIUS_KM * 2000) / SPACING) + 1, off = (n - 1) / 2;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const [lon, lat] = toLL([(j - off) * SPACING, (i - off) * SPACING]);
    for (const e of ESSENTIALS) {
      const q = \`key=\${KEY}&lat=\${lat}&lon=\${lon}&radius=\${SEARCH_R}&limit=100\`;
      const url = e.cat
        ? \`\${API}/search/2/nearbySearch/.json?\${q}&categorySet=\${e.cat}\`
        : \`\${API}/search/2/poiSearch/\${e.q}.json?\${q}\`;
      const res = await getJson(url);
      for (const r of res.results || []) pts[e.key].push(toXY([r.position.lon, r.position.lat]));
    }
  }
  return pts;
}

function hexes() {
  const out = [], w = Math.sqrt(3) * HEX, h = 1.5 * HEX, R = RADIUS_KM * 1000;
  for (let r = -Math.ceil(R / h); r <= Math.ceil(R / h); r++) {
    for (let q = -Math.ceil(R / w) - r; q <= Math.ceil(R / w) - r; q++) {
      const x = w * (q + r / 2), y = r * h;
      if (Math.hypot(x, y) > R) continue;
      const ring = [0, 1, 2, 3, 4, 5, 0].map((i) => {
        const a = ((60 * i - 30) * Math.PI) / 180;
        return toLL([x + HEX * Math.cos(a), y + HEX * Math.sin(a)]);
      });
      out.push({ xy: [x, y], ring });
    }
  }
  return out;
}

const RAMP = ['#C0392B', '#D9652B', '#E0A030', '#D8C93A', '#9CC43E', '#4CA64C', '#1E7A45'];
const colour = (s) => RAMP[Math.min(RAMP.length - 1, Math.floor((s / 100) * RAMP.length))];

ml.on('load', async () => {
  const pts = await sample();
  const features = hexes().map(({ xy, ring }) => {
    let sum = 0, wsum = 0;
    for (const e of ESSENTIALS) {
      const d = pts[e.key].map((p) => Math.hypot(p[0] - xy[0], p[1] - xy[1]) * 1.3).sort((a, b) => a - b);
      const nearest = Array.from({ length: e.k }, (_, i) => decay(e, d[i] ?? Infinity));
      sum += e.w * (nearest.reduce((a, b) => a + b, 0) / e.k);
      wsum += e.w;
    }
    const score = (sum / wsum) * 100;
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { score, color: colour(score) } };
  }).filter((f) => f.properties.score >= 4);

  ml.addSource('hexes', { type: 'geojson', data: { type: 'FeatureCollection', features } });
  // Beneath the water layer, so rivers and coastlines cut the honeycomb.
  const water = ml.getStyle().layers.find((l) => l.id.startsWith('Water'))?.id;
  ml.addLayer({
    id: 'hex-fill', type: 'fill', source: 'hexes',
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': {{opacity}}, 'fill-antialias': false },
  }, water);
});`;

const DENSITY = `${HEAD}

${POOL}

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
  // One Search call per (vibe, anchor), four at a time
  const jobs = vibes.flatMap((v) => ANCHORS.map(([lon, lat]) => ({ v, lon, lat })));
  const responses = await pool(jobs, 4, ({ v, lon, lat }) =>
    getJson(
      \`\${API}/search/2/poiSearch/\${encodeURIComponent(VIBE_QUERIES[v] || v)}.json\` +
        \`?key=\${KEY}&lat=\${lat}&lon=\${lon}&radius={{radius}}&limit=100\`
    )
  );
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
  const res = await getJson(
    \`\${API}/routing/1/calculateRoute/\${waypoints}/json?key=\${KEY}&travelMode=pedestrian&traffic=false\`
  );
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
  { color: '{{scooterColor}}', query: 'bicycle parking', count: 6, ofs: 0 },
  { color: '{{bikeColor}}', query: 'bicycle parking', count: 6, ofs: 6 }, // the next six spots
  { color: '{{carColor}}', query: 'parking', count: 6, ofs: 0 },
];

ml.on('load', async () => {
  const center = await geocode('{{anchor}}');
  const placed = [];

  for (const brand of BRANDS) {
    // Real parking / bike-parking anchors, so vehicles sit on actual spots
    const res = await getJson(
      \`\${API}/search/2/poiSearch/\${encodeURIComponent(brand.query)}.json\` +
        \`?key=\${KEY}&lat=\${center[1]}&lon=\${center[0]}&radius=1500&limit=\${brand.count}&ofs=\${brand.ofs}\`
    );
    (res.results || []).forEach((p) => {
      const ll = [p.position.lon, p.position.lat];
      new maplibregl.Marker({ color: brand.color }).setLngLat(ll).addTo(ml);
      placed.push(ll);
    });
  }
  if (placed.length) fit(placed);
});`;

const HEATMAP = `${HEAD}

// Region boxes [w, s, e, n] and their Natural Earth continent (null = all land).
const REGIONS = {
  world: [[-165, -50, 178, 68], null],
  europe: [[-11, 35, 32, 66], 'Europe'],
  'north-america': [[-128, 14, -62, 60], 'North America'],
  'south-america': [[-82, -55, -34, 13], 'South America'],
  africa: [[-18, -35, 52, 38], 'Africa'],
  asia: [[40, -10, 150, 60], 'Asia'],
  oceania: [[110, -48, 179, -5], 'Oceania'],
};
// Cold → hot ramps in °C, so a colour means the same temperature in every palette.
const PALETTES = {
  classic: [[-30, '#3a2c86'], [0, '#4ea3e8'], [10, '#74cfc4'], [18, '#f4d35e'], [26, '#ef9d3c'], [34, '#e8602f'], [44, '#9e1530']],
  spectral: [[-30, '#5e4fa2'], [0, '#66c2a5'], [18, '#e6f598'], [24, '#fee08b'], [30, '#fdae61'], [36, '#f46d43'], [44, '#9e0142']],
  inferno: [[-30, '#1b0c41'], [5, '#781c6d'], [16, '#a52c60'], [24, '#cf4446'], [30, '#ed6925'], [37, '#fb9a06'], [44, '#fcf6b1']],
  viridis: [[-30, '#440154'], [0, '#2a788e'], [12, '#22a884'], [26, '#7ad151'], [40, '#fde725']],
};
const CRITICAL = 30; // °C — at and above this the field glows red
const COUNTRIES = 'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/110m/cultural/ne_110m_admin_0_countries.json';

const [BBOX, CONTINENT] = REGIONS['{{region}}'] || REGIONS.europe;
const RAMP = (PALETTES['{{palette}}'] || PALETTES.classic).map(([t, h]) => [t, [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))]);

// The day to show ({{period}}). Open-Meteo's forecast host serves the last
// ~92 days, the archive host everything older.
function day(period) {
  const d = new Date();
  if (period === 'yesterday') d.setUTCDate(d.getUTCDate() - 1);
  else if (period === 'last-year') d.setUTCFullYear(d.getUTCFullYear() - 1);
  else return { date: period, host: 'archive-api.open-meteo.com/v1/archive' };
  return { date: d.toISOString().slice(0, 10), host: period === 'yesterday' ? 'api.open-meteo.com/v1/forecast' : 'archive-api.open-meteo.com/v1/archive' };
}

const colour = (t) => {
  let i = 1;
  while (i < RAMP.length - 1 && t > RAMP[i][0]) i++;
  const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i];
  const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return c0.map((v, k) => v + (c1[k] - v) * f);
};
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

ml.on('load', async () => {
  // 1. A regular grid over the padded region, ≤ ~400 points: one Open-Meteo call
  //    (much more and the URL passes the server's 8 KB limit, a 414).
  const [w, s, e, n] = [BBOX[0] - 4, Math.max(-80, BBOX[1] - 4), BBOX[2] + 4, Math.min(80, BBOX[3] + 4)];
  const step = Math.max(1, Math.sqrt(((e - w) * (n - s)) / 400));
  const cols = Math.ceil((e - w) / step) + 1, rows = Math.ceil((n - s) / step) + 1;
  const lons = [], lats = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { lons.push((w + c * step).toFixed(1)); lats.push((s + r * step).toFixed(1)); }
  const { date, host } = day('{{period}}');
  const [temps, countries] = await Promise.all([
    getJson(\`https://\${host}?latitude=\${lats}&longitude=\${lons}&start_date=\${date}&end_date=\${date}&daily=temperature_2m_max&timezone=GMT\`),
    getJson(COUNTRIES),
  ]);
  const grid = temps.map((p) => p.daily?.temperature_2m_max?.[0] ?? NaN);

  // 2. Bilinear field on a canvas laid out in Web Mercator (how MapLibre
  //    stretches an image source), coloured by the ramp, glowing ≥ CRITICAL.
  const W = 512, H = Math.round((W * (mercY(n) - mercY(s))) / (((e - w) * Math.PI) / 180));
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = canvas.getContext('2d'), img = g.createImageData(W, H);
  const at = (c, r) => grid[Math.min(rows - 1, r) * cols + Math.min(cols - 1, c)];
  for (let y = 0; y < H; y++) {
    const lat = (Math.atan(Math.sinh(mercY(n) - (y / H) * (mercY(n) - mercY(s)))) * 180) / Math.PI;
    const gy = (lat - s) / step, r = Math.floor(gy), fy = gy - r;
    for (let x = 0; x < W; x++) {
      const gx = (x / W) * (cols - 1), c = Math.floor(gx), fx = gx - c;
      const t = (at(c, r) * (1 - fx) + at(c + 1, r) * fx) * (1 - fy) + (at(c, r + 1) * (1 - fx) + at(c + 1, r + 1) * fx) * fy;
      if (Number.isNaN(t)) continue;
      const glow = Math.min(1, Math.max(0, (t - CRITICAL) / 8)) * 0.6;
      const rgb = colour(t).map((v, k) => v + ([239, 68, 68][k] - v) * glow);
      img.data.set([...rgb, 190 + 50 * glow], (y * W + x) * 4);
    }
  }
  g.putImageData(img, 0, 0);

  // 3. Keep the field on land: punch it out with the region's countries.
  const px = ([lon, lat]) => [((lon - w) / (e - w)) * W, ((mercY(n) - mercY(Math.max(-85, Math.min(85, lat)))) / (mercY(n) - mercY(s))) * H];
  g.globalCompositeOperation = 'destination-in';
  g.beginPath();
  for (const f of countries.features) {
    if (CONTINENT && f.properties.CONTINENT !== CONTINENT) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const ring of polys.flat()) ring.forEach((pt, i) => g[i ? 'lineTo' : 'moveTo'](...px(pt)));
  }
  g.fill();

  // 4. One image source under the basemap labels. {{unit}} only changes labels.
  ml.addSource('temp', { type: 'image', url: canvas.toDataURL(), coordinates: [[w, n], [e, n], [e, s], [w, s]] });
  const labels = ml.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  ml.addLayer({ id: 'temp-field', type: 'raster', source: 'temp', paint: { 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }, labels);
  ml.fitBounds([[BBOX[0], BBOX[1]], [BBOX[2], BBOX[3]]], { padding: 24 });
});`;

const TRAFFIC = `${HEAD}
import { TrafficFlowModule } from '@tomtom-org/maps-sdk/map';

${POOL}

// Preset metro boxes — Incident Details accepts up to 10,000 km².
const CITIES = {
  saopaulo:   [-46.83, -23.70, -46.45, -23.42],
  mexicocity: [-99.30, 19.30, -98.98, 19.56],
  newyork:    [-74.10, 40.60, -73.80, 40.88],
  losangeles: [-118.55, 33.90, -118.10, 34.15],
  london:     [-0.35, 51.40, 0.12, 51.62],
  paris:      [2.20, 48.78, 2.50, 48.95],
  berlin:     [13.20, 52.43, 13.60, 52.60],
  amsterdam:  [4.75, 52.30, 5.02, 52.43],
};
const BBOX = CITIES['{{city}}'] || CITIES.newyork;
const TOP = {{count}};
// What "worst" means — every lens reads only the incident's own numbers.
const RANK = {
  impact:  (p) => p.delay * p.length,               // queue impact
  delay:   (p) => p.delay,                          // longest delay
  length:  (p) => p.length,                         // longest queue
  slowest: (p) => (p.length >= 300 ? p.delay / p.length : 0), // min lost per km
}['{{rankBy}}'];
const REFRESH_MS = {{refresh}} * 1000;
const FIELDS = '{incidents{geometry{type,coordinates},properties{id,magnitudeOfDelay,delay,length,from,to,roadNumbers}}}';

const mid = (c) => c[Math.floor(c.length / 2)];

async function worstJams() {
  // Live jams only: categoryFilter=6, present-time incidents
  const res = await getJson(
    \`\${API}/traffic/services/5/incidentDetails?key=\${KEY}&bbox=\${BBOX.join(',')}\` +
      \`&fields=\${encodeURIComponent(FIELDS)}&categoryFilter=6&timeValidityFilter=present\`
  );
  // Rank by delay × length — the queue a viewer is actually sitting in
  const top = (res.incidents || [])
    .filter((j) => j.properties.delay > 0)
    .sort((a, b) => RANK(b.properties) - RANK(a.properties))
    .slice(0, TOP);

  // Enrich: live speed (Flow Segment Data) + the road's name (Reverse Geocoding),
  // two jams at a time so the burst stays under the rate limit
  return pool(top, 2, async (j, i) => {
    const [lng, lat] = mid(j.geometry.coordinates);
    const [flow, rev] = await Promise.all([
      getJson(\`\${API}/traffic/services/4/flowSegmentData/absolute/10/json?key=\${KEY}&point=\${lat},\${lng}\`),
      getJson(\`\${API}/search/2/reverseGeocode/\${lat},\${lng}.json?key=\${KEY}\`),
    ]);
    const p = j.properties;
    const ff = flow.flowSegmentData?.freeFlowSpeed;
    return {
      rank: i + 1,
      line: j.geometry,
      at: [lng, lat],
      name: rev.addresses?.[0]?.address?.streetName || p.roadNumbers?.[0] || p.from,
      // Average speed THROUGH the jam: length / (free-flow time + delay).
      // currentSpeed is a single point and can contradict the delay.
      freeFlow: ff && Math.round(ff),
      speed: ff ? Math.round((p.length / (p.length / (ff / 3.6) + p.delay)) * 3.6) : undefined,
      lengthKm: (p.length / 1000).toFixed(1),
      delayMin: Math.max(1, Math.round(p.delay / 60)),
      // Colours from the Orbis dark style's own traffic-flow layers:
      // stationary dark red for major delays, queueing red otherwise.
      major: p.magnitudeOfDelay >= 3,
      color: p.magnitudeOfDelay >= 3 ? '#8F0000' : '#DA2E0B',
    };
  });
}

let markers = [];
function draw(jams) {
  ml.getSource('jams').setData({
    type: 'FeatureCollection',
    features: jams.map((j) => ({ type: 'Feature', geometry: j.line, properties: { major: j.major } })),
  });
  markers.forEach((m) => m.remove());
  markers = jams.map((j) => {
    const el = document.createElement('div');
    el.className = 'jam-badge';
    el.style.background = j.color;
    el.textContent = j.rank;
    const card = \`<div class="tt-popup"><h3>#\${j.rank} \${j.name}</h3>\` +
      \`<div>\${j.speed ?? '—'} km/h <span class="muted">of \${j.freeFlow ?? '—'}</span></div>\` +
      \`<div>\${j.lengthKm} km of queue · +\${j.delayMin} min</div></div>\`;
    return new maplibregl.Marker({ element: el })
      .setLngLat(j.at)
      .setPopup(new maplibregl.Popup({ offset: 16 }).setHTML(card))
      .addTo(ml);
  });
}

ml.on('load', async () => {
  // Road traffic underneath: 'all' = the SDK overlay; 'main' = only the
  // arteries, from the style's own flow tiles, as one continuous ramp.
  const FLOW = '{{flow}}';
  if (FLOW === 'all') (await TrafficFlowModule.get(map)).setVisible(true);
  if (FLOW === 'main' && ml.getSource('vectorTilesFlow')) {
    ml.addLayer({
      id: 'arterials', type: 'line', source: 'vectorTilesFlow', 'source-layer': 'Traffic flow',
      filter: ['match', ['get', 'road_category'], ['motorway', 'trunk', 'primary'], true, false],
      paint: {
        'line-color': ['interpolate', ['linear'], ['get', 'relative_speed'],
          0.1, '#8F0000', 0.25, '#DA2E0B', 0.55, '#DB9200', 0.85, '#1F7A45'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 15, 6],
      },
    });
  }

  // lineMetrics enables line-progress: each jam deepens from its tail to
  // its head (incident geometry runs in the driving direction).
  ml.addSource('jams', { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
  const grad = (a, b) => ['interpolate', ['linear'], ['line-progress'], 0, a, 1, b];
  ml.addLayer({ id: 'jams-casing', type: 'line', source: 'jams',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#FFFFFF', 'line-width': 11 } });   // light casing on a dark map
  // line-gradient can't read feature properties: one layer per family.
  ml.addLayer({ id: 'jams-moderate', type: 'line', source: 'jams', filter: ['!', ['get', 'major']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-gradient': grad('#DB9200', '#DA2E0B'), 'line-width': 7 } });
  ml.addLayer({ id: 'jams-major', type: 'line', source: 'jams', filter: ['get', 'major'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-gradient': grad('#DA2E0B', '#8F0000'), 'line-width': 7 } });

  const jams = await worstJams();
  draw(jams);
  ml.fitBounds([[BBOX[0], BBOX[1]], [BBOX[2], BBOX[3]]], { padding: 48 });

  // Keep it live — a traffic board is only as good as its last refresh
  setInterval(async () => draw(await worstJams()), REFRESH_MS);
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

const SUMMARY_CSS = `
#summary {
  position: absolute;
  top: 12px;
  left: 12px;
  max-width: 320px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  font: 13px/1.4 system-ui, sans-serif;
}
#summary:empty {
  display: none;
}`;

const JAM_CSS = `
.jam-badge {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 2px solid #fff;
  border-radius: 50%;
  color: #fff;
  font: 700 12px/1 system-ui, sans-serif;
  cursor: pointer;
}`;

/* Ask the map: a chat beside the map, driven by the SDK's agent toolkit.
   It needs a model as well as the map, so it ships its own vite.config.js:
   the dev server holds the model key and forwards the page's calls. */
const AGENT = `${HEAD}

// The agent — install alongside the SDK:
//   npm i @tomtom-org/maps-sdk-plugin-agent-toolkit @tomtom-org/maps-sdk-plugin-map-theme ai zod @turf/turf chart.js h3-js @ai-sdk/anthropic
// Model key: ANTHROPIC_API_KEY in .env, with no VITE_ prefix. vite.config.js
// forwards it, so it never reaches the browser. Any AI SDK provider works:
// swap createAnthropic for createAzure, createOpenAI, …
import { createMapAgent } from '@tomtom-org/maps-sdk-plugin-agent-toolkit';
import { createAnthropic } from '@ai-sdk/anthropic';

const claude = createAnthropic({ baseURL: \`\${location.origin}/claude/v1\`, apiKey: 'set-by-dev-server' });
const agent = createMapAgent(map, {
  model: claude('claude-opus-5-5'),
  // Safe defaults for a public page: no GPS fix sent to the model, no data
  // from arbitrary URLs, generated analysis code only in the sandbox.
  tools: { getCurrentLocation: false },
  datasets: { byod: { enabled: false } },
  codeExecution: { allowMainThreadFallback: false },
  systemPromptSuffix: 'Answer in two to four short sentences with the numbers that matter. State only numbers a tool returned; if a tool failed, say so.',
});

const log = document.getElementById('log');
const form = document.getElementById('ask');
const history = []; // the whole conversation, so follow-ups remember earlier results
const el = (tag, cls, text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });

async function ask(text) {
  if (!text.trim() || form.inert) return;
  form.inert = true;
  const reply = el('li', 'agent');
  const steps = el('div', 'steps');
  const answer = el('p', 'answer', '…');
  reply.append(steps, answer);
  log.append(el('li', 'user', text), reply);
  history.push({ role: 'user', content: text });
  const chips = new Map();
  try {
    const result = await agent.stream({ messages: history });
    let said = '';
    for await (const part of result.fullStream) {
      if (part.type === 'tool-call') {
        // Every tool the agent calls shows up as a chip: the trace is the point.
        const chip = el('span', 'step', part.toolName);
        chips.set(part.toolCallId, chip);
        steps.append(chip);
      } else if (part.type === 'tool-result' || part.type === 'tool-error') {
        const failed = part.type === 'tool-error' || part.output?.error;
        chips.get(part.toolCallId)?.classList.add(failed ? 'failed' : 'done');
      } else if (part.type === 'text-delta') {
        said += part.text;
        answer.textContent = said;
      } else if (part.type === 'error') {
        throw part.error;
      }
    }
    history.push(...(await result.responseMessages));
  } catch (err) {
    history.pop(); // drop the unanswered question
    answer.textContent = 'No answer.';
    fail(err);
  } finally {
    form.inert = false;
    reply.scrollIntoView({ block: 'end' });
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  ask(form.elements.q.value);
  form.elements.q.value = '';
});
document.querySelectorAll('[data-prompt]').forEach((b) => b.addEventListener('click', () => ask(b.dataset.prompt)));`;

const AGENT_HTML = `<aside id="chat">
      <ol id="log"></ol>
      <div class="prompts">
        <button type="button" data-prompt="Route San Francisco to San José and find EV chargers on the way.">Chargers on the way</button>
        <button type="button" data-prompt="Worst traffic jams in New York right now?">Worst jams now</button>
      </div>
      <form id="ask"><input name="q" placeholder="Ask about places, routes, traffic" autocomplete="off" /><button>Ask</button></form>
    </aside>`;

const AGENT_CSS = `
#chat {
  position: absolute;
  top: 16px;
  right: 16px;
  bottom: 16px;
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  font: 13px/1.4 system-ui, sans-serif;
}
#log {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}
#log li {
  margin-bottom: 12px;
}
#log .user {
  margin-left: 15%;
  padding: 8px 10px;
  border-radius: 10px;
  background: #f2f2f2;
}
.steps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.step {
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2ff;
  color: #3c5c98;
  font-size: 11px;
}
.step.done {
  background: #e6f4ea;
  color: #2f7a45;
}
.step.failed {
  background: #fdecea;
  color: #b42318;
}
.answer {
  margin: 6px 0 0;
  white-space: pre-wrap;
}
.prompts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.prompts button,
#ask button {
  padding: 4px 10px;
  border: 1px solid #ccc;
  border-radius: 999px;
  background: #fff;
  font: inherit;
  cursor: pointer;
}
#ask {
  display: flex;
  gap: 6px;
}
#ask input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid #ccc;
  border-radius: 999px;
  font: inherit;
}
#ask[inert] {
  opacity: 0.5;
}`;

/* The worker plugin, plus a dev proxy that adds the model key server-side. */
const AGENT_VITE_CONFIG = `${workerPluginSrc.trim()}

import { loadEnv } from 'vite';

// The page calls /claude/…; the dev server forwards it to the Claude API
// with ANTHROPIC_API_KEY from .env, so the key never reaches the browser.
export default ({ mode }) => {
  const key = loadEnv(mode, process.cwd(), '').ANTHROPIC_API_KEY;
  if (!key) console.warn('No ANTHROPIC_API_KEY in .env: the map works, the agent will not answer.');
  return {
    plugins: [maplibreWorker()],
    server: {
      proxy: {
        '/claude': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\\/claude/, ''),
          headers: { 'x-api-key': key ?? '' },
        },
      },
    },
  };
};
`;

/* mapType → ordered file set. app.js first (default tab). */
export const CODE_SAMPLES = {
  route:     [{ name: 'app.js', lang: 'js', code: ROUTE },     indexHtml('Plan a route'),          stylesCss()],
  poi:       [{ name: 'app.js', lang: 'js', code: POI },       indexHtml('Discover places'),       stylesCss(POPUP_CSS)],
  ev:        [{ name: 'app.js', lang: 'js', code: EV },        indexHtml('Find an EV charger'),    stylesCss()],
  multistop: [{ name: 'app.js', lang: 'js', code: MULTISTOP }, indexHtml('Long-distance EV trip', '<ol id="steps"></ol>'), stylesCss(STEPS_CSS)],
  fleet:     [{ name: 'app.js', lang: 'js', code: FLEET },     indexHtml('Track your fleet'),      stylesCss()],
  package:   [{ name: 'app.js', lang: 'js', code: PACKAGE },   indexHtml('Package tracker'),       stylesCss(POPUP_CSS)],
  delivery:  [{ name: 'app.js', lang: 'js', code: DELIVERY },  indexHtml('Live delivery dispatch', '<div id="summary"></div>'), stylesCss(NUM_CSS + SUMMARY_CSS)],
  city:      [{ name: 'app.js', lang: 'js', code: CITY },      indexHtml('Neighbourhood analysis'), stylesCss(POPUP_CSS)],
  density:   [{ name: 'app.js', lang: 'js', code: DENSITY },   indexHtml('Vibe density'),          stylesCss()],
  sport:     [{ name: 'app.js', lang: 'js', code: SPORT },     indexHtml('Activity tracker'),      stylesCss()],
  sharing:   [{ name: 'app.js', lang: 'js', code: SHARING },   indexHtml('Shared mobility'),       stylesCss()],
  heatmap:   [{ name: 'app.js', lang: 'js', code: HEATMAP },   indexHtml('Temperature map'),       stylesCss()],
  traffic:   [{ name: 'app.js', lang: 'js', code: TRAFFIC },   indexHtml('City live traffic'),     stylesCss(POPUP_CSS + JAM_CSS)],
  agent:     [{ name: 'app.js', lang: 'js', code: AGENT },     indexHtml('Ask the map', AGENT_HTML), stylesCss(AGENT_CSS), { name: 'vite.config.js', lang: 'js', code: AGENT_VITE_CONFIG }],
};

/** Files for a use case, falling back to a bare route example. */
export function filesForType(mapType) {
  // vite.config.js rides along in every case: without it MapLibre 6's worker
  // dies under \`npm run dev\` and the map never becomes ready.
  // A case that needs more from the dev server (the agent's model proxy)
  // ships its own.
  const files = CODE_SAMPLES[mapType] || CODE_SAMPLES.route;
  return files.some(f => f.name === 'vite.config.js') ? files : [...files, { name: 'vite.config.js', lang: 'js', code: VITE_CONFIG }];
}

/* README bundled into the .zip so a downloaded use case is runnable
   without guessing the deps / env var / scaffold. The exported files are
   plain source; this is the "how to run it" that turns them into a
   working Vite app. Uses indented code blocks (no backticks) so it stays
   valid markdown inside this template literal. */
/* vite.config.js bundled into the .zip — MapLibre 6's worker breaks in
   Vite dev without it (see vite/maplibre-worker.js, the same plugin this
   app runs on). */
export const VITE_CONFIG = `${workerPluginSrc.trim()}

export default { plugins: [maplibreWorker()] };
`;

export function readmeFor(uc, fileNames = []) {
  const list = [...new Set(fileNames)].map(n => '- ' + n).join('\n');
  const docs = uc.tools
    .map(t => [t.name, t.docs || TOOL_DOCS[t.name]])
    .filter(([, href]) => href)
    .map(([name, href]) => `- ${name}: ${href}`).join('\n');
  return `# TomTom Orbis Maps — ${uc.title}

Starter files exported from the TomTom Orbis use-case library: plain
source for a Vite project.

## Files in this package
${list}

## Run it

1. Get a free API key. Sign in at ${GET_STARTED.signup}, open Products,
   pick Maps SDK for JavaScript and create a free SDK key.
   Step by step: ${GET_STARTED.keyHowTo}

2. Create a Vite app and enter it:

        npm create vite@latest my-map -- --template vanilla
        cd my-map

3. Copy every file from this package into the project root, replacing the
   template's index.html. Keep vite.config.js: it lets MapLibre 6's map
   worker run under the dev server. The template's src/ folder is unused.

4. Install the TomTom Orbis Maps SDK and MapLibre:

        ${GET_STARTED.install}

5. Create .env at the project root with your key (keep it out of git):

        ${GET_STARTED.envVar}=your_key
${uc.mapType === 'agent' ? `
   This case also runs an AI model. Install the agent toolkit and a
   model provider, and add the model key to the same .env (no VITE_
   prefix: vite.config.js keeps it on the dev server):

        npm i @tomtom-org/maps-sdk-plugin-agent-toolkit @tomtom-org/maps-sdk-plugin-map-theme ai zod @turf/turf chart.js h3-js @ai-sdk/anthropic
        ANTHROPIC_API_KEY=your_model_key
` : ''}
6. Start it:

        ${GET_STARTED.run}

   The map opens at the case's view. If something fails, a red note at
   the bottom of the map says what, and the console has the details.

## If it doesn't work

- "No API key": .env is missing or misnamed, or the dev server was
  started before you created it. Fix it and restart \`${GET_STARTED.run}\`.
- "403 from api.tomtom.com/…": that API isn't enabled for your key. Turn
  it on for the key at ${GET_STARTED.signup}.
- "No place found for …": the place name didn't resolve. Use a more
  specific name, such as "Dam Square, Amsterdam".
- 429 responses are retried automatically. A free key allows about five
  requests a second.
- A blank map with "document is not defined" in the console means
  vite.config.js is missing.

Before you ship, read ${GET_STARTED.keySecurity}

## Docs for this case
${docs}

Everything else: ${GET_STARTED.docs}
`;
}
