/* Prompt generators for the Quickstart → Prompt tab.

   What the agent prompt is FOR: someone copies it into Claude Code /
   Cursor / any coding agent and gets a working preview map back — the
   same map they just configured here, on the Orbis SDK, with the
   settings we already know are the good ones. The shortest possible
   path from "I want this map" to "this map runs". Every line has to
   earn its place against that goal.

   Rules the content follows:

   - Nothing generic. A section that isn't needed for THIS case isn't
     printed: the MCP note only when the case actually has lookups to
     make, the dash-array mapping only when it has a line-style control,
     the 3D note only when the camera is close enough for buildings to
     render, the traffic note only when a Traffic API is in scope.
   - The SDK contract is spelled out, not implied — install line, the
     worker-before-map gotcha, TomTomConfig, `map.mapLibreMap`, and the
     defaults that make an Orbis map look right (label scale, overlay
     widths, framing, traffic through the SDK modules). These are the
     same values the library itself renders with; see map/config.js and
     map/provider.js.
   - MapLibre GL JS renders, TomTom Orbis supplies styles and data.
     Mapbox is ruled out explicitly: left unsaid, a coding agent reaches
     for `mapbox-gl` and `mapbox://` URLs on reflex.
   - Live values only — camera and parameters are read at copy time, so
     the prompt always describes the map currently on screen.

   `plainPrompt` is the same case as a spec doc: user story, acceptance
   criteria, no implementation talk. Reads cleanly in Jira/Notion or in
   a generic LLM that has no tools. */

import { paramFor } from '../state.js';
import { TOOL_DOCS } from '../data/use-cases.js';

/* ---------- live view ------------------------------------------------ */

function viewOf(view) {
  const v = view || {};
  return {
    style:   v.style ?? 'standardDark',
    lng:     v.center?.[0] ?? 4.9041,
    lat:     v.center?.[1] ?? 52.3676,
    zoom:    v.zoom ?? 11,
    pitch:   v.pitch ?? 0,
    bearing: v.bearing ?? 0,
  };
}

/* Style family behind a concrete style id, plus what that family buys
   you — the agent should know WHY the case is on this basemap, or it
   will "helpfully" swap it for the default one. */
const FAMILY_NOTE = {
  standard:  'full-detail TomTom basemap',
  driving:   'roads emphasised, surroundings muted',
  mono:      'desaturated, so overlay colour carries the data',
  satellite: 'TomTom satellite imagery — single style, no light/dark pair',
};
const THEME_PAIR = {
  standardLight: 'standardDark',  standardDark: 'standardLight',
  drivingLight:  'drivingDark',   drivingDark:  'drivingLight',
  monoLight:     'monoDark',      monoDark:     'monoLight',
};
const familyOf = style =>
  /^driving/.test(style)   ? 'driving'   :
  /^mono/.test(style)      ? 'mono'      :
  /^satellite/.test(style) ? 'satellite' : 'standard';

/* ---------- parameters ----------------------------------------------- */

function fmtValue(v) {
  if (Array.isArray(v)) return v.length ? v.join(', ') : '(none selected)';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v ?? '');
}

/* One row per control: key, label, type, the value the user is looking
   at right now, and the range it may take. A select without its options
   is a value the agent will hard-code; with them it becomes a control. */
function paramRows(uc) {
  if (!uc.params?.length) return null;
  return uc.params.map(p => {
    const type = p.type || 'text';
    const row = `- \`${p.key}\` — ${p.label} (${type}): ${fmtValue(paramFor(uc, p.key))}`;
    const extra = [];
    if (p.options?.length) {
      /* Comboboxes carry 10 presets and accept free text on top; four is
         enough to show the shape without spending the tokens. Selects are
         a closed set, so every option matters. */
      const values = p.options.map(o => o.value);
      const shown = type === 'combobox' ? values.slice(0, 4) : values;
      const rest = values.length > shown.length ? ', …' : '';
      extra.push(`${type === 'combobox' ? 'presets' : 'options'}: ${shown.join(' | ')}${rest}`);
    }
    if (p.search) {
      extra.push(`free text also allowed — resolve it through ${p.search === 'city' ? 'Geocoding' : 'Search'} before use`);
    }
    return extra.length ? `${row}\n  ${extra.join(' · ')}` : row;
  }).join('\n');
}

const hasParam  = (uc, key) => !!uc.params?.some(p => p.key === key);
const anyParam  = (uc, keys) => keys.some(k => hasParam(uc, k));
const hasColour = uc => !!uc.params?.some(p => p.type === 'color');

/* ---------- tools ----------------------------------------------------- */

/* How each service is actually reached in a browser preview. Names match
   `tools[].name` in the catalog. These are the calls this library makes
   itself (see map/services.js and map/scene-context.js), so an agent
   following them lands on the same endpoints and the same SDK modules —
   not on a raster-tile overlay or an endpoint that doesn't exist. */
const ENDPOINT_HINTS = {
  'Routing API':
    'GET /routing/1/calculateRoute/{lat},{lon}:{lat},{lon}/json?traffic=true&travelMode=car (add computeBestOrder=true for stop optimisation, maxAlternatives=N for alternatives)',
  'ETA API':
    'no separate call — read routes[0].summary.travelTimeInSeconds / trafficDelayInSeconds / arrivalTime off the Routing response',
  'Long Distance EV Routing API':
    'POST /routing/1/calculateLongDistanceEVRoute/{lat},{lon}:{lat},{lon}/json — battery + consumption curve in the query, chargingModes in the body',
  'Places API':
    'GET /search/2/poiSearch/{query}.json?lat=&lon=&radius=&limit= (openingHours=nextSevenDays for hours)',
  'Search API':
    'GET /search/2/nearbySearch/.json?lat=&lon=&categorySet=&radius= for categories · GET /search/2/geocode/{query}.json?limit=1 for an address',
  'Reverse Geocoding API':
    'GET /search/2/reverseGeocode/{lat},{lon}.json',
  'EV Charging Availability API':
    'GET /search/2/chargingAvailability.json?chargingAvailabilityId={result.dataSources.chargingAvailability.id}',
  'Admin Boundaries':
    'GET /search/2/geocode/{name}.json?entityTypeSet=Municipality|MunicipalitySubdivision → dataSources.geometry.id → GET /search/2/additionalData.json?geometries={id}&geometriesZoom=11',
  'Traffic Flow API':
    'through the SDK: TrafficFlowModule.get(map) → setVisible(true) — themed vector overlay, not the legacy raster tiles',
  'Traffic Incidents API':
    'through the SDK: TrafficIncidentsModule.get(map) → setVisible(true) — pictograms + segment highlights styled with the active theme',
  'Geofencing API':
    'server-side fences (project → fence → object). For a client-side preview, test containment locally against the boundary polygon',
  'Maps Display API':
    'no direct calls — the SDK requests the Orbis vector tiles for the style you pass in',
  'Orbis 3D Landmarks API':
    'streamed landmark meshes, enabled through the SDK alongside the buildings3D layer group',
  'Elevation API':
    'not a TomTom endpoint — elevation and heart rate are read from the activity file itself',
  'Open-Meteo API':
    'https://api.open-meteo.com/v1/forecast for recent dates, archive-api.open-meteo.com for older ones — open, keyless, CORS-friendly',
  'Provider feed (GBFS)':
    'optional public feed — free_bike_status.json / station_status.json',
};

/* Gating and provenance belong on the row, not in the reader's head: an
   agent that treats a private-preview API as mandatory stalls, and one
   that assumes a third-party feed needs the TomTom key sends it there. */
function toolRows(uc) {
  return uc.tools.map(t => {
    const tag =
      t.exclusive          ? ' [private preview — skip it if the key has no access]' :
      t.type === 'integration' ? ' [third party — no TomTom key]' :
      t.type === 'sdk'     ? ' [SDK]' : '';
    const how  = ENDPOINT_HINTS[t.name] ? `\n  ${ENDPOINT_HINTS[t.name]}` : '';
    const docs = t.docs || TOOL_DOCS[t.name];
    return `- ${t.name}${tag}${how}${docs ? `\n  docs: ${docs}` : ''}`;
  }).join('\n');
}

/* The MCP server is worth naming only when the case has lookups it can
   actually serve. The two file/open-data cases (activity replay, weather
   field) have none, and telling them to prefer MCP tools is noise. */
const MCP_COVERS = /search|places|geocod|routing|traffic|ev charging/i;
const wantsMcpNote = uc => uc.tools.some(t => t.type === 'api' && MCP_COVERS.test(t.name));

/* ---------- per-case build recipe ------------------------------------- */

/* The step list that turns a config dump into a running map: which call,
   with which parameters, drawn how. Mirrors what the live scene does, so
   the generated preview behaves like the one in the panel. Keyed by
   `mapType`; a case with no recipe simply prints no Steps section. */
const RECIPES = {
  route: [
    'Geocode `from` and `to` (limit=1) into [lng, lat].',
    'Call Routing with `travelMode`, `traffic` and `maxAlternatives=2`.',
    'Draw the primary as a wide soft casing plus a solid line on top; draw the alternatives underneath in a muted tone.',
    'Click an alternative to promote it to primary — restyle in place, do not refetch.',
    'Markers at origin and destination; show distance, travel time and traffic delay from `routes[].summary`.',
    'Frame the primary geometry with fitBounds.',
  ],
  poi: [
    'Geocode `anchor`, then open at zoom ~16 with pitch ~45 so 3D buildings and landmarks read.',
    'On map click, run `queryRenderedFeatures(e.point)` and take the first hit from a POI/place layer — the basemap already carries the POIs, no overlay needed.',
    'Enrich that one click in parallel: Reverse Geocoding for the address, and poiSearch on the feature name (radius ~80, limit 1, openingHours=nextSevenDays) for hours, phone and website.',
    'Popup with name, address, opening hours, phone, website — drop the fields that came back empty rather than rendering blanks.',
    'Build the `categories` chip rail from the POI classes actually present in the viewport, and filter the rendered layers when a chip flips — no refetch.',
  ],
  ev: [
    'Geocode `anchor`.',
    'nearbySearch with `categorySet=7309` (EV charging station), radius 2500, limit 30.',
    'For each result carrying `dataSources.chargingAvailability.id`, fetch live connector status in parallel; a failed lookup degrades that charger to unknown, it does not fail the map.',
    'Colour each marker by status (`availableColor` / `occupiedColor` / `unknownColor`) and size it by speed tier — slow, fast, rapid — from connector power.',
    'Popup per charger: connector types, power, available vs total. fitBounds over the results.',
  ],
  multistop: [
    'Geocode `from` and `to`.',
    'Call Long Distance EV Routing with the battery and consumption profile of the selected `car` and `currentChargeInkWh` from `startCharge`; put the charging connector preferences in the POST body.',
    'Draw the returned route — TomTom has already inserted the charging stops.',
    'Every leg except the last ends at a charger: mark each one and label charge-in, charge-out and charging time from the leg summary.',
    'Show total drive time plus total charging time; fitBounds over the whole polyline.',
  ],
  fleet: [
    'Resolve the operating area: geocode the city with `entityTypeSet=Municipality`, take `dataSources.geometry.id`, then pull the polygon from additionalData.',
    'Render the geofence INVERTED — one world-spanning ring with the zone punched out as a hole — so everything outside is dimmed and the operating area stays the brightest thing on the map. MapLibre only treats the inner ring as a hole when it winds against the outer one, so flip it when the windings match.',
    'Outline the zone itself in `geofenceColor` with the chosen `geofenceStyle`.',
    'Snap each van to a real route and place it along that line; tag it on-route, idle, delayed or outside-zone and colour it accordingly.',
    'Turn on traffic flow through the SDK module; a van sitting on a congested segment flips to the alert colour.',
  ],
  package: [
    'Geocode `hub` and `dest`.',
    'Route hub → recipient with `traffic=true` and draw the snapped path.',
    'Animate the courier marker along the polyline with requestAnimationFrame, interpolating between points.',
    'ETA window from `summary.travelTimeInSeconds` plus `trafficDelayInSeconds`, in the destination popup, recomputed as the courier advances.',
  ],
  delivery: [
    'Geocode the depot and every stop.',
    'One Routing call over depot → stops → depot with `computeBestOrder=true` and `traffic=true`; the depot is pinned as both first and last waypoint.',
    'Read the optimised sequence from `optimizedWaypoints` and number the stop pins in that order.',
    'Per-stop ETA from each leg summary; totals from `routes[0].summary`.',
    'Draw the loop as a single line and fitBounds over it.',
  ],
  city: [
    'On map click, reverse-geocode the point to a municipality and subdivision name.',
    'Geocode that name with `entityTypeSet=MunicipalitySubdivision`, take `dataSources.geometry.id`, and pull the polygon from additionalData.',
    'Fill and outline it with `fillColor` / `strokeColor` / `strokeWidth` / `strokeStyle`; on the next click call `setData` on the existing source instead of stacking new layers.',
    'Sweep six daily essentials inside a 1.2 km walk buffer — groceries, schools, healthcare, transit, parks, cafés — as parallel category searches.',
    'Score the area out of 5 from how many essentials are present, and show the verdict plus per-category counts in the popup.',
    'Honour the `traffic` toggle with the SDK traffic-flow module.',
  ],
  density: [
    'Sample the metro from several anchors, not one: a ring of district centres around the city centre, so the field covers the city instead of a disc around a single point.',
    'One POI search per (vibe × anchor) with the chosen `radius`, fanned out in parallel, de-duplicated by POI id.',
    'Feed the points into a MapLibre `heatmap` layer with colour stops from the chosen `palette` and `heatmap-radius` around 28.',
    'fitBounds over the sampled points and render a legend that says what the ramp means.',
  ],
  sport: [
    'Load the selected file from `/activities/{activity}` and parse it — GPX (`<trkpt>` plus `<extensions>`), TCX, or GeoJSON. Elevation and heart rate come from the FILE; there is no elevation endpoint to call.',
    'Build the track as a LineString and add the source with `lineMetrics: true` — `line-progress` is only valid inside `line-gradient`, and only with line metrics on.',
    'Colour the line by pace: a gradient over `line-progress` derived from per-point speed, so slow stretches read differently from fast ones.',
    'Place a marker at every kilometre split with its pace, heart rate and elevation gain.',
    'Start and finish markers; fitBounds over the whole track.',
  ],
  sharing: [
    'Geocode `anchor`.',
    'Find real staging spots around it — parking and bicycle parking POIs — so every vehicle lands on tarmac instead of floating in a canal.',
    'Place scooters, bikes and cars on those spots, coloured by mode (`scooterColor` / `bikeColor` / `carColor`).',
    'Popup per vehicle: brand, mode, battery or range. fitBounds over what was placed.',
    'If a real GBFS feed is available, swap the staged positions for live ones and leave the rest of the scene untouched.',
  ],
  heatmap: [
    'Build a coarse lat/lon grid over the chosen `region` — roughly 9° steps worldwide, tighter for a single continent.',
    'Fetch daily maximum temperature for the chosen `period` from Open-Meteo — forecast host for recent dates, archive host for older ones. No TomTom key is involved.',
    'Bilinearly interpolate the grid into a smooth field on a canvas, colour it with the chosen `palette`, and clip it to a land outline so it stops at the coast.',
    'Add it as an `image` source over the field bounds and insert the raster layer BELOW the basemap label layers so borders and names stay readable; `raster-resampling: linear`.',
    'Make zones at or above 30 °C glow on top. `unit` changes labels only — keep the field itself in °C.',
    'Fly to the region; the data underneath stays global, so panning away never hits an edge.',
  ],
};

function recipeSteps(uc) {
  const steps = RECIPES[uc.mapType];
  return steps ? steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : null;
}

/* ---------- prompt sections ------------------------------------------- */

function stackSection(uc) {
  const lines = [
    '- Renderer: MapLibre GL JS (`maplibre-gl`), driven by the TomTom Orbis Maps SDK (`@tomtom-org/maps-sdk`). Install both: `npm i @tomtom-org/maps-sdk maplibre-gl`.',
    '- Vanilla JS in a Vite app unless the project you are in already has a framework. One page, one app file — no UI kit, no state library.',
    '- No Mapbox anywhere: no `mapbox-gl`, no `mapbox://` style, tile, sprite or glyph URL, no Mapbox token or account. MapLibre GL JS renders; TomTom Orbis supplies every style, tile and dataset.',
  ];
  if (wantsMcpNote(uc)) {
    lines.push('- TomTom MCP server, only if this environment already has it connected: use its tools for the geocoding and search lookups below instead of hand-writing fetch calls. If it is not connected, call the REST endpoints directly — do not go install it.');
  }
  return lines.join('\n');
}

function setupSection(v) {
  return `\`\`\`js
import { TomTomMap } from '@tomtom-org/maps-sdk/map';
import { TomTomConfig } from '@tomtom-org/maps-sdk/core';
import maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker?url';
import 'maplibre-gl/dist/maplibre-gl.css';        // the SDK ships no CSS of its own

const KEY = import.meta.env.VITE_TOMTOM_API_KEY;
const API = 'https://api.tomtom.com';

// Wire the worker BEFORE any map is constructed, or GeoJSON-backed layers
// (routes, polygons, heat) silently never render.
maplibregl.setWorkerUrl(workerUrl);
TomTomConfig.instance.put({ apiKey: KEY, apiVersion: 1, commonBaseURL: API });

const map = new TomTomMap({
  key: KEY,
  style: '${v.style}',
  language: 'en-GB',                              // English labels worldwide
  mapLibre: {
    container: 'map',
    center: [${v.lng}, ${v.lat}],
    zoom: ${v.zoom},
    pitch: ${v.pitch},
    bearing: ${v.bearing},
    fadeDuration: 220,
  },
});
const ml = map.mapLibreMap;   // MapLibre map — sources, layers, markers, popups
\`\`\``;
}

/* The house defaults, filtered to the ones this case can actually use. */
function defaultsSection(uc, v) {
  const family = familyOf(v.style);
  const pair = THEME_PAIR[v.style];
  const lines = [
    `- Basemap \`${v.style}\` — the ${family} family: ${FAMILY_NOTE[family]}.${pair ? ` Its counterpart for the other theme is \`${pair}\`.` : ''} Keep it; the case was framed on this basemap.`,
    '- After every style load, scale each symbol layer\'s `text-size` and `icon-size` by 0.7. Tile defaults are tuned for navigation; at 0.7 a dense city reads calmly under an overlay.',
  ];
  if (hasParam(uc, 'lineWidth')) {
    lines.push('- Draw a route or track as two layers: a wide soft casing (~28 px) under the solid line (~10 px), both with `line-cap` and `line-join` set to `round`. A dashed connector line sits at ~4 px.');
  }
  if (anyParam(uc, ['strokeWidth', 'geofenceStyle'])) {
    lines.push('- Polygon outlines run ~3 px, or ~5 px for the selected one, over a fill at low opacity.');
  }
  if (anyParam(uc, ['lineStyle', 'strokeStyle', 'geofenceStyle'])) {
    lines.push('- Line style maps to `line-dasharray`: solid → none, dashed → `[2, 1.5]`, dotted → `[0.1, 1.6]`.');
  }
  lines.push('- Frame computed geometry with `fitBounds(bounds, { padding: 64, duration: 900 })`, never a hard-coded zoom.');
  if (hasColour(uc)) {
    lines.push('- Overlay colour carries state, not branding: one hue per state, taken from the parameters below.');
  }
  if (anyParam(uc, ['fillColor', 'geofenceColor'])) {
    lines.push('- Watch translucent fills against a dark basemap: a light tint there adds glow instead of dimming, so dim with a near-black scrim (~0.6) and keep the coloured tint for light basemaps.');
  }
  if (v.zoom >= 14 || uc.tools.some(t => /3D Landmarks/i.test(t.name))) {
    lines.push('- Keep 3D buildings on via the SDK\'s `BaseMapModule` (layer group `buildings3D`) rather than flipping raw layer visibility; they only render from zoom ~15, so pitch the camera to make them pay off.');
  }
  /* Name the module the case actually needs — a prompt that offers both
     invites an agent to bolt on the overlay the case never asked for. */
  const traffic = [
    uc.tools.some(t => /Traffic Flow/i.test(t.name)) && '`TrafficFlowModule`',
    uc.tools.some(t => /Traffic Incidents/i.test(t.name)) && '`TrafficIncidentsModule`',
  ].filter(Boolean);
  if (traffic.length) {
    lines.push(`- Traffic comes from the SDK: ${traffic.join(' and ')}, styled with the active theme. Do not stack the legacy raster traffic tiles on top.`);
  }
  lines.push('- `setStyle` drops everything you added. Re-apply your sources, layers and the label scale after the `styledata` event so a theme or basemap switch does not empty the map.');
  return lines.join('\n');
}

/* ============================================================== AGENT */

export function agentPrompt(uc, view) {
  const v = viewOf(view);
  const params = paramRows(uc);
  const steps = recipeSteps(uc);
  return `# TomTom Orbis · ${uc.title}

## Build this
${uc.description}
A single working page that opens on the map below and renders that result with no further input. Preview quality, not production: get it on screen, then stop.

## Stack — exactly this
${stackSection(uc)}

## Map setup — copy this init
${setupSection(v)}

## Orbis defaults worth keeping
${defaultsSection(uc, v)}

## Parameters — every one of these is a live control, defaults as shown
${params || '(none)'}
${params ? 'Changing one repaints the map in place: update the source or the paint property, never rebuild the map.\n' : ''}
${steps ? `## Steps
${steps}

` : ''}## TomTom services in this case
${toolRows(uc)}

## API key
- Read \`VITE_TOMTOM_API_KEY\` from the environment. Never inline it, never commit it, never pass it to a third-party host.

## Done when
- The map opens at the camera above and renders the result unattended.
- Every parameter is adjustable at runtime and repaints in place.
- Failures surface — a visible message plus the console. Never silently fall back to mock data or a default location.
- Reply with one line: the TomTom endpoints (or MCP tools) you actually called.`;
}

/* ============================================================== SPECS */

export function plainPrompt(uc, view) {
  const v = viewOf(view);
  const params = paramRows(uc);
  return `# ${uc.title}

## Story
${uc.description}

## Acceptance criteria
- The map opens at style \`${v.style}\`, centred on [${v.lng}, ${v.lat}], zoom ${v.zoom}${v.pitch ? `, pitched ${v.pitch}°` : ''}.
- The result above is rendered on the map itself — markers, lines, areas or popups as the case needs — and is readable without reading a legend first.
- Every parameter below is adjustable while the map is open, and the map updates in place rather than reloading.
- When a data source fails, the map says so instead of showing an empty or invented result.
- The API key is read from environment configuration, never hard-coded.

## Parameters
${params || '(none)'}

## Services involved
${uc.tools.map(t => `- ${t.name}${t.exclusive ? ' (restricted access)' : t.type === 'integration' ? ' (third party)' : ''}`).join('\n')}

## Constraints
- Map data, styling and geocoding come from TomTom Orbis. MapLibre GL JS renders it; no Mapbox products or services.

## Out of scope
- Auth, billing, analytics, error-reporting infrastructure.
- Visual polish beyond what it takes to read the result on the map.
- Multi-user and persistence concerns.`;
}

export function promptFor(uc, style = 'agent', view) {
  return style === 'plain' ? plainPrompt(uc, view) : agentPrompt(uc, view);
}
