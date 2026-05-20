/* Use-case catalog. Each entry has a `mapType` that maps to a scene module
   in src/scenes/<mapType>.js. `status: 'live' | 'stub'` tracks the SDK port.

   `accent` (string) picks one of the 6 semantic ACCENT tokens — drives
   category chip colour and is the fallback for the case's primary map
   colour. Optional `accentColor: { main, dark, soft? }` overrides the map
   colour for that case only (markers, route lines, polygon fills), without
   affecting the semantic palette used for sub-states.

   Optional `mapStyle` picks a basemap family:
   - `'standard'` (default) — full-detail TomTom basemap
   - `'driving'`             — roads emphasised, context muted
   - `'mono'`                — desaturated, lets overlay colours pop
   - `'satellite'`           — TomTom satellite imagery (single theme) */

export const USE_CASES = [
  { id: 1,  title: "Traffic heatmap & hotspots",   category: "Analytics",  complexity: "High",   mapType: "heatmap",   accent: "attention",   mapStyle: "mono",      status: "live", description: "See where traffic incidents cluster. Live density heatmap fed by the Traffic Incidents API, with named hotspots.", tags: ["heatmap", "incidents", "hotspots", "density"],
    tools: [
      { name: "Orbis Maps SDK",    type: "sdk" },
      { name: "Maps Display API",  type: "api", docs: "https://docs.tomtom.com/map-display-api/documentation/tomtom-maps/product-information/introduction" },
      { name: "Vector Tile Service",type: "api", docs: "https://docs.tomtom.com/map-display-api/documentation/tomtom-maps/vector/tile" },
      { name: "Traffic Flow API",  type: "api", docs: "https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-flow/traffic-flow-service" },
    ] },
  { id: 2,  title: "Discover places",             category: "Discovery",  complexity: "Medium", mapType: "poi",       accent: "neutral",     status: "live", description: "Hover a café, click for details. Every point of interest on the map is clickable — the address card is fetched live.", tags: ["POI", "click-to-inspect", "address", "discovery"],
    tools: [
      { name: "Places API",        type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search" },
      { name: "Search API",        type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/nearby-search" },
      { name: "Orbis Maps SDK",    type: "sdk" },
      { name: "POI Categories API",type: "api", docs: "https://docs.tomtom.com/search-api/documentation/poi-categories-service/poi-categories" },
    ],
    params: [
      { key: 'anchor', label: 'Anchor', default: 'Dam Square, Amsterdam' },
    ] },
  { id: 3,  title: "Plan a route",                category: "Navigation", complexity: "Medium", mapType: "route",     accent: "neutral",     mapStyle: "driving",   status: "live", description: "Plan a drive from A to B with live traffic. ETA, distance, and the road conditions you'll actually meet.", tags: ["routing", "navigation", "ETA", "traffic"],
    tools: [
      { name: "Routing API",          type: "api", docs: "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route" },
      { name: "Orbis Maps SDK",       type: "sdk" },
      { name: "Traffic Incidents API",type: "api", docs: "https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-incidents/traffic-incidents-service" },
    ],
    params: [
      { key: 'from', label: 'From', type: 'text', default: 'Amsterdam Centraal' },
      { key: 'to',   label: 'To',   type: 'text', default: 'Rijksmuseum, Amsterdam' },
      { key: 'travelMode', label: 'Travel mode', type: 'select', default: 'car',
        options: [
          { value: 'car',        label: 'Car' },
          { value: 'truck',      label: 'Truck' },
          { value: 'pedestrian', label: 'Walking' },
          { value: 'bicycle',    label: 'Cycling' },
        ] },
      { key: 'traffic', label: 'Live traffic', type: 'toggle', default: true },
    ] },
  { id: 4,  title: "Long-distance EV trip",       category: "Navigation", complexity: "High",   mapType: "multistop", accent: "positive",    mapStyle: "driving",   status: "live", description: "Drive Amsterdam → Paris on one charge plan. TomTom picks the charging stops, the car profile picks the duration.", tags: ["EV", "charging stops", "long distance", "energy"],
    tools: [
      { name: "Long Distance EV Routing API", type: "api", docs: "https://docs.tomtom.com/long-distance-ev-routing-api/documentation/tomtom-maps/product-information/introduction" },
      { name: "Reverse Geocoding API",        type: "api", docs: "https://docs.tomtom.com/reverse-geocoding-api/documentation/product-information/introduction" },
      { name: "Traffic Flow API",             type: "api", docs: "https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-flow/traffic-flow-service" },
      { name: "Orbis Maps SDK",               type: "sdk" },
    ],
    params: [
      { key: 'from', label: 'From', default: 'Amsterdam, NL' },
      { key: 'to',   label: 'To',   default: 'Paris, FR' },
      { key: 'car',  label: 'Vehicle', type: 'select', default: 'tesla-m3-lr',
        options: [
          { value: 'tesla-m3-lr',  label: 'Tesla Model 3 LR · 75 kWh · long range' },
          { value: 'vw-id4',       label: 'VW ID.4 · 77 kWh · mid range' },
          { value: 'ioniq5',       label: 'Hyundai Ioniq 5 · 77 kWh · fast-charging' },
          { value: 'bmw-i4',       label: 'BMW i4 · 84 kWh · long range' },
          { value: 'zoe',          label: 'Renault Zoe · 52 kWh · short range' },
        ] },
      { key: 'startCharge', label: 'Start charge', type: 'select', default: '25',
        options: [
          { value: '15',  label: '15 kWh · low' },
          { value: '25',  label: '25 kWh · default' },
          { value: '50',  label: '50 kWh · plenty' },
          { value: '80',  label: 'Full' },
        ] },
    ] },
  { id: 5,  title: "Track your fleet",            category: "Tracking",   complexity: "High",   mapType: "fleet",     accent: "general",     mapStyle: "driving",   status: "live", description: "Watch your vans move in real time. Each pin walks its own snapped route inside a real city boundary.", tags: ["fleet", "tracking", "geofence", "live"],
    tools: [
      { name: "Orbis Maps SDK",   type: "sdk" },
      { name: "Geofencing API",   type: "api",        docs: "https://docs.tomtom.com/geofencing-api/documentation/product-information/introduction" },
      { name: "Traffic Flow API", type: "api",        docs: "https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-flow/traffic-flow-service" },
      { name: "WebSockets / MQTT",type: "integration" },
    ] },
  { id: 6,  title: "Package tracker",             category: "Tracking",   complexity: "Medium", mapType: "package",   accent: "neutral",     mapStyle: "driving",   status: "live", description: "Show a customer where their parcel is. Snapped courier path from hub to door, with a live ETA window.", tags: ["parcel", "last-mile", "ETA", "customer-facing"],
    tools: [
      { name: "Orbis Maps SDK", type: "sdk" },
      { name: "Routing API",    type: "api", docs: "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route" },
      { name: "ETA API",        type: "api", docs: "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route" },
    ],
    params: [
      { key: 'hub',  label: 'Hub',  default: 'Schiphol Airport, Amsterdam' },
      { key: 'dest', label: 'To',   default: 'Herengracht 286, Amsterdam' },
    ] },
  { id: 7,  title: "Live delivery dispatch",      category: "Logistics",  complexity: "High",   mapType: "delivery",  accent: "neutral",     mapStyle: "driving",   status: "live", description: "Optimise today's drops in one call. TomTom orders the stops, your driver animates the route.", tags: ["delivery", "dispatch", "optimization", "stops"],
    tools: [
      { name: "Waypoint Optimization API", type: "api", docs: "https://docs.tomtom.com/waypoint-optimization/documentation/waypoint-optimization-service" },
      { name: "Batch Routing API",         type: "api", docs: "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/batch-routing/batch-routing-service" },
      { name: "Orbis Maps SDK",            type: "sdk" },
      { name: "Traffic Incidents API",     type: "api", docs: "https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-incidents/traffic-incidents-service" },
    ] },
  { id: 8,  title: "City planning",               category: "Urban",      complexity: "High",   mapType: "city",      accent: "alternative", mapStyle: "mono",      status: "live", description: "Amsterdam stadsdelen drawn from TomTom admin boundaries, layered with live traffic density, transit coverage and activity hotspots — the view a city planner would scan.", tags: ["zoning", "boundaries", "traffic", "transit", "urban"],
    tools: [
      { name: "Orbis Maps SDK",  type: "sdk" },
      { name: "Search API",      type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/nearby-search" },
      { name: "Admin Boundaries",type: "api" },
      { name: "Traffic Flow API",type: "api", docs: "https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-flow/traffic-flow-service" },
    ],
    params: [
      { key: 'place', label: 'Neighbourhood', type: 'select', default: 'Centrum, Amsterdam',
        options: [
          { value: 'Centrum, Amsterdam',     label: 'Centrum' },
          { value: 'Amsterdam-Noord',        label: 'Noord' },
          { value: 'Amsterdam-Oost',         label: 'Oost' },
          { value: 'Amsterdam-West',         label: 'West' },
          { value: 'Nieuw-West, Amsterdam',  label: 'Nieuw-West' },
          { value: 'Amsterdam-Zuid',         label: 'Zuid' },
          { value: 'Amsterdam-Zuidoost',     label: 'Zuidoost' },
          { value: 'Westpoort, Amsterdam',   label: 'Westpoort' },
        ] },
      { key: 'radius', label: 'Search radius', type: 'select', default: '1500',
        options: [
          { value: '1000', label: '1.0 km' },
          { value: '1500', label: '1.5 km' },
          { value: '2500', label: '2.5 km' },
        ] },
      { key: 'traffic', label: 'Traffic flow', type: 'toggle', default: true },
    ] },
  { id: 9,  title: "Where to stay",               category: "Discovery",  complexity: "Medium", mapType: "realestate",accent: "alternative", mapStyle: "mono",      status: "live", description: "See where a city's character clusters. Pick a lens — dining, sights, shopping, nightlife or transit — and the heatmap lights up the neighbourhoods that lead in it.", tags: ["heatmap", "POIs", "where to stay", "neighbourhoods"],
    tools: [
      { name: "Places API",     type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/nearby-search" },
      { name: "Search API",     type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search" },
      { name: "Orbis Maps SDK", type: "sdk" },
      { name: "Routing API",    type: "api", docs: "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route" },
    ],
    params: [
      { key: 'city', label: 'City', type: 'select', default: 'amsterdam',
        options: [
          { value: 'amsterdam', label: 'Amsterdam' },
          { value: 'paris',     label: 'Paris' },
          { value: 'berlin',    label: 'Berlin' },
          { value: 'barcelona', label: 'Barcelona' },
        ] },
      { key: 'category', label: 'Lens', type: 'select', default: 'dining',
        options: [
          { value: 'dining',    label: 'Dining · where to eat' },
          { value: 'sights',    label: 'Sights · museums & attractions' },
          { value: 'shopping',  label: 'Shopping · retail clusters' },
          { value: 'nightlife', label: 'Nightlife · bars & venues' },
          { value: 'transit',   label: 'Transit · stops & stations' },
        ] },
    ] },
  { id: 10, title: "Activity tracker",            category: "Lifestyle",  complexity: "Medium", mapType: "sport",     accent: "negative",    mapStyle: "mono", status: "live", description: "Replay a recorded ride, run or hike — load a GPX, TCX, or GeoJSON file, or fall back to a live-routed Amsterdam → Zandvoort cycling demo.", tags: ["activity", "cycling", "splits", "fitness", "GPX", "TCX"],
    tools: [
      { name: "Orbis Maps SDK",  type: "sdk" },
      { name: "Maps Display API",type: "api", docs: "https://docs.tomtom.com/map-display-api/documentation/tomtom-maps/vector/tile" },
      { name: "Elevation API",   type: "api" },
    ],
    params: [
      { key: 'activity', label: 'Activity', type: 'select', default: 'demo',
        options: [
          { value: 'demo',                          label: 'Live demo — Amsterdam → Zandvoort' },
          { value: 'amsterdam-zandvoort.gpx',       label: 'Recorded · Sloterdijk → Zandvoort (GPX, 22 km cycling)' },
          { value: 'vondelpark-run.tcx',            label: 'Recorded · Vondelpark loop (TCX, 5 km running)' },
          { value: 'zandvoort-dunes-hike.geojson',  label: 'Recorded · Zandvoort dunes (GeoJSON, hike)' },
        ] },
    ] },
  { id: 11, title: "Shared mobility",             category: "Mobility",   complexity: "High",   mapType: "sharing",   accent: "neutral",     status: "live", description: "One map, every shared ride. Bikes, scooters and cars staged at the real parking they live in.", tags: ["sharing", "multi-brand", "scooters", "cars"],
    tools: [
      { name: "Orbis Maps SDK",         type: "sdk" },
      { name: "Places API",             type: "api",        docs: "https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search" },
      { name: "Routing API",            type: "api",        docs: "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route" },
      { name: "3rd Party Provider APIs",type: "integration" },
    ],
    params: [
      { key: 'anchor', label: 'Anchor', default: 'Leidseplein, Amsterdam' },
    ] },
  { id: 12, title: "Find an EV charger",          category: "Mobility",   complexity: "Medium", mapType: "ev",        accent: "positive",    status: "live", description: "Find a plug that's free right now. Pin colour shows live availability; bolt count shows speed.", tags: ["EV", "charging", "availability", "connectors"],
    tools: [
      { name: "Search API",                   type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/nearby-search" },
      { name: "EV Charging Availability API", type: "api", docs: "https://docs.tomtom.com/ev-search-api/documentation/product-information/introduction" },
      { name: "Orbis Maps SDK",               type: "sdk" },
    ],
    params: [
      { key: 'anchor', label: 'Anchor', default: 'Museumplein, Amsterdam' },
    ] },
];

/* Semantic palette — see tokens.css `--c-*`. Every map render reads from
   here, so the colour of a marker / line / polygon carries meaning
   (state) rather than branding.

   `main` is the value used on light basemaps; `dark` is the lighter
   counterpart used when the map is in dark theme so the marker keeps
   enough luminance contrast against the near-black surface. Tokens that
   already have enough contrast on dark (saffron, coral) reuse `main`. */
export const ACCENT = {
  positive:    { main: "#4CA262", dark: "#A5C94E", soft: "rgba(76,162,98,0.55)"  },
  attention:   { main: "#DBA43A", dark: "#EDC15D", soft: "rgba(219,164,58,0.55)" },
  negative:    { main: "#EE6748", dark: "#EE6748", soft: "rgba(238,103,72,0.55)" },
  neutral:     { main: "#3C5C98", dark: "#56BDB7", soft: "rgba(86,189,183,0.55)" },
  general:     { main: "#646E7B", dark: "#9AA3B0", soft: "rgba(154,163,176,0.55)"},
  alternative: { main: "#6443A1", dark: "#AF79BE", soft: "rgba(175,121,190,0.55)"},
};

export const accentClass = a => `cx-${a}`;

/* Estimated time to a running demo. Single, non-judgemental signal
   used by both the list cards and the detail panel — no intensity
   dots, no colour scale. Keyed by the `complexity` field. */
export const AGENT_ETA = {
  Low:    '~30s',
  Medium: '~2 min',
  High:   '~5 min',
};
export const etaFor = uc => AGENT_ETA[uc.complexity] || AGENT_ETA.Medium;

/* Docs URLs for each tool surfaced in `tools[]`. Keyed by exact tool
   name. Detail panel renders the row as a link when there's a match.
   Add entries here when introducing a new tool. */
/* Canonical docs.tomtom.com landing pages — used as the default link
   for a tool when the case-specific endpoint isn't overridden inline
   via `tools[].docs`. Prefer the per-case override: it lets the panel
   point at the exact endpoint the case incorporates (e.g. Routing API
   → calculate-route vs. batch-routing) rather than the generic root. */
export const TOOL_DOCS = {
  // SDKs
  "Orbis Maps SDK":                 "https://docs.tomtom.com/maps-sdk-js/introduction/overview",
  "Custom Layer Support":           "https://docs.tomtom.com/maps-sdk-js/introduction/overview",
  // Maps
  "Maps Display API":               "https://docs.tomtom.com/map-display-api/documentation/tomtom-maps/product-information/introduction",
  "Vector Tile Service":            "https://docs.tomtom.com/map-display-api/documentation/tomtom-maps/vector/tile",
  // Traffic
  "Traffic Flow API":               "https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-flow/traffic-flow-service",
  "Traffic Incidents API":          "https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-incidents/traffic-incidents-service",
  // Search / Places
  "Places API":                     "https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search",
  "Search API":                     "https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search",
  "POI Categories API":             "https://docs.tomtom.com/search-api/documentation/poi-categories-service/poi-categories",
  "Reverse Geocoding API":          "https://docs.tomtom.com/reverse-geocoding-api/documentation/product-information/introduction",
  "EV Charging Availability API":   "https://docs.tomtom.com/ev-search-api/documentation/product-information/introduction",
  // Routing
  "Routing API":                    "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route",
  "ETA API":                        "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route",
  "Batch Routing API":              "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/batch-routing/batch-routing-service",
  "Long Distance EV Routing API":   "https://docs.tomtom.com/long-distance-ev-routing-api/documentation/tomtom-maps/product-information/introduction",
  "Waypoint Optimization API":      "https://docs.tomtom.com/waypoint-optimization/documentation/waypoint-optimization-service",
  // Other
  "Geofencing API":                 "https://docs.tomtom.com/geofencing-api/documentation/product-information/introduction",
  // No public docs page — rendered without a link.
  "Elevation API":                  null,
  "Admin Boundaries":               null,
  "WebSockets / MQTT":              null,
  "3rd Party Provider APIs":        null,
};
