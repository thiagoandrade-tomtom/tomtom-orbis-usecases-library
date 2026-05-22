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
  { id: 1,  title: "Traffic heatmap & hotspots",   category: "Analytics",  complexity: "High",   mapType: "heatmap",   accent: "attention",   mapStyle: "mono",      status: "live", description: "Build a live traffic-incident heatmap with the TomTom Traffic Incidents API and Orbis Maps SDK. Pull incidents for a bounding box, weight each by delay severity, and render them as a MapLibre heatmap layer. The three densest cells are promoted to numbered hotspot pins, each enriched live with reverse-geocoded street names. Pick a palette below to retheme the density gradient.", tags: ["heatmap", "incidents", "hotspots", "density"],
    tools: [
      { name: "Orbis Maps SDK",    type: "sdk" },
      { name: "Maps Display API",  type: "api", docs: "https://docs.tomtom.com/map-display-api/documentation/tomtom-maps/product-information/introduction" },
      { name: "Vector Tile Service",type: "api", docs: "https://docs.tomtom.com/map-display-api/documentation/tomtom-maps/vector/tile" },
      { name: "Traffic Flow API",  type: "api", docs: "https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-flow/traffic-flow-service" },
    ],
    params: [
      { key: 'palette', label: 'Density palette', type: 'select', default: 'amber-red',
        options: [
          { value: 'amber-red',  label: 'Amber → Red · default' },
          { value: 'blue-red',   label: 'Blue → Red · classic heatmap' },
          { value: 'green-red',  label: 'Green → Red · risk' },
          { value: 'violet-pink',label: 'Violet → Pink · brand' },
          { value: 'teal-coral', label: 'Teal → Coral · soft' },
        ] },
    ] },
  { id: 2,  title: "Discover places",             category: "Discovery",  complexity: "Medium", mapType: "poi",       accent: "neutral",     status: "live", description: "Build a click-to-inspect POI experience on top of TomTom's vector tiles. The basemap itself carries the POIs — no overlay duplicates — and a click runs queryRenderedFeatures + Reverse Geocoding + POI Search in parallel to enrich the popup with everything TomTom knows: address, category, phone, website, weekly opening hours and brand. The map opens tilted so the base-style 3D buildings give the scene depth.", tags: ["POI", "click-to-inspect", "address", "discovery", "opening hours"],
    tools: [
      { name: "Places API",        type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search" },
      { name: "Search API",        type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/nearby-search" },
      { name: "Reverse Geocoding API", type: "api", docs: "https://docs.tomtom.com/reverse-geocoding-api/documentation/product-information/introduction" },
      { name: "Orbis Maps SDK",    type: "sdk" },
    ],
    params: [
      { key: 'anchor',     label: 'Anchor', default: 'Dam Square, Amsterdam' },
      { key: 'categories', label: 'Categories in view', type: 'chips' },
    ] },
  { id: 3,  title: "Plan a route",                category: "Navigation", complexity: "Medium", mapType: "route",     accent: "neutral",     mapStyle: "driving",   status: "live", description: "Build a turn-by-turn route planner with the TomTom Routing API and Orbis Maps SDK. Geocode two addresses, ask Routing for the primary plus alternatives, and render them as styled polylines you can click to promote. Tweak the colour, thickness and dash pattern below to see how the same response renders under your brand.", tags: ["routing", "navigation", "ETA", "traffic"],
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
      { key: 'traffic',    label: 'Live traffic', type: 'toggle', default: true },
      { key: 'routeColor', label: 'Route colour', type: 'color',  default: '#3C5C98' },
      { key: 'lineWidth',  label: 'Line width',   type: 'select', default: '8',
        options: [
          { value: '4',  label: 'Thin · 4 px' },
          { value: '8',  label: 'Default · 8 px' },
          { value: '12', label: 'Bold · 12 px' },
        ] },
      { key: 'lineStyle',  label: 'Line style',   type: 'select', default: 'solid',
        options: [
          { value: 'solid',  label: 'Solid' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' },
        ] },
    ] },
  { id: 4,  title: "Long-distance EV trip",       category: "Navigation", complexity: "High",   mapType: "multistop", accent: "positive",    mapStyle: "driving",   status: "live", description: "Build a long-distance EV trip planner with the TomTom Long-Distance EV Routing API and Orbis Maps SDK. Send a real vehicle consumption curve and battery profile — TomTom returns the route with charging stops already inserted, each enriched live with availability, connector mix and reverse-geocoded street names. Tune the route's colour, thickness and dash pattern below to brand it.", tags: ["EV", "charging stops", "long distance", "energy"],
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
      { key: 'routeColor', label: 'Route colour', type: 'color',  default: '#4CA262' },
      { key: 'lineWidth',  label: 'Line width',   type: 'select', default: '8',
        options: [
          { value: '4',  label: 'Thin · 4 px' },
          { value: '8',  label: 'Default · 8 px' },
          { value: '12', label: 'Bold · 12 px' },
        ] },
      { key: 'lineStyle',  label: 'Line style',   type: 'select', default: 'solid',
        options: [
          { value: 'solid',  label: 'Solid' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' },
        ] },
    ] },
  { id: 5,  title: "Track your fleet",            category: "Tracking",   complexity: "High",   mapType: "fleet",     accent: "general",     mapStyle: "driving",   status: "live", description: "Build a dispatcher-style fleet view with TomTom Routing API, Admin Boundaries and the Geofencing API. Each van is snapped to a real route between two geocoded points and tagged by status — on-route, idle, delayed by a traffic incident, or violating the geofence by leaving the Amsterdam municipality polygon. Pin colour encodes the state at a glance; click any van for live telemetry. The geofence styling and each status colour are exposed below so the dispatcher view can be rebranded without touching the data flow.", tags: ["fleet", "tracking", "geofence", "live", "dispatcher"],
    tools: [
      { name: "Orbis Maps SDK",   type: "sdk" },
      { name: "Routing API",      type: "api",        docs: "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route" },
      { name: "Geofencing API",   type: "api",        docs: "https://docs.tomtom.com/geofencing-api/documentation/product-information/introduction" },
      { name: "Traffic Flow API", type: "api",        docs: "https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-flow/traffic-flow-service" },
      { name: "Admin Boundaries", type: "api" },
    ],
    params: [
      { key: 'geofenceColor', label: 'Geofence colour',  type: 'color', default: '#3C5C98' },
      { key: 'onRouteColor',  label: 'On-route colour',  type: 'color', default: '#4CA262' },
      { key: 'idleColor',     label: 'Idle colour',      type: 'color', default: '#646E7B' },
      { key: 'alertColor',    label: 'Alert colour',     type: 'color', default: '#EE6748' },
      { key: 'geofenceStyle', label: 'Geofence style',   type: 'select', default: 'solid',
        options: [
          { value: 'solid',  label: 'Solid' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' },
        ] },
    ] },
  { id: 6,  title: "Package tracker",             category: "Tracking",   complexity: "Medium", mapType: "package",   accent: "neutral",     mapStyle: "driving",   status: "live", description: "Build a customer-facing parcel tracker with the TomTom Routing API and Orbis Maps SDK. Geocode the hub and recipient address, draw the snapped courier path between them, and animate a courier marker along the polyline with a live ETA window. The route colour, thickness and dash style are exposed below — brand it for your last-mile UX.", tags: ["parcel", "last-mile", "ETA", "customer-facing"],
    tools: [
      { name: "Orbis Maps SDK", type: "sdk" },
      { name: "Routing API",    type: "api", docs: "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route" },
      { name: "ETA API",        type: "api", docs: "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route" },
    ],
    params: [
      { key: 'hub',         label: 'Hub',          default: 'Schiphol Airport, Amsterdam' },
      { key: 'dest',        label: 'To',           default: 'Herengracht 286, Amsterdam' },
      { key: 'routeColor',  label: 'Route colour', type: 'color',  default: '#3C5C98' },
      { key: 'lineWidth',   label: 'Line width',   type: 'select', default: '8',
        options: [
          { value: '4',  label: 'Thin · 4 px' },
          { value: '8',  label: 'Default · 8 px' },
          { value: '12', label: 'Bold · 12 px' },
        ] },
      { key: 'lineStyle',   label: 'Line style',   type: 'select', default: 'solid',
        options: [
          { value: 'solid',  label: 'Solid' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' },
        ] },
    ] },
  { id: 7,  title: "Live delivery dispatch",      category: "Logistics",  complexity: "High",   mapType: "delivery",  accent: "neutral",     mapStyle: "driving",   status: "live", description: "Build a multi-stop dispatch view with the TomTom Routing API's batch + TSP optimisation. Hand a hub plus a list of customer addresses; TomTom resolves the optimal order, returns the snapped polyline, and you render the legs with sequenced number pins and per-stop ETAs. Tune route colour, thickness and style below to differentiate dispatch from driver views.", tags: ["delivery", "dispatch", "optimization", "stops"],
    tools: [
      { name: "Waypoint Optimization API", type: "api", docs: "https://docs.tomtom.com/waypoint-optimization/documentation/waypoint-optimization-service" },
      { name: "Batch Routing API",         type: "api", docs: "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/batch-routing/batch-routing-service" },
      { name: "Orbis Maps SDK",            type: "sdk" },
      { name: "Traffic Incidents API",     type: "api", docs: "https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-incidents/traffic-incidents-service" },
    ],
    params: [
      { key: 'routeColor', label: 'Route colour', type: 'color',  default: '#3C5C98' },
      { key: 'lineWidth',  label: 'Line width',   type: 'select', default: '8',
        options: [
          { value: '4',  label: 'Thin · 4 px' },
          { value: '8',  label: 'Default · 8 px' },
          { value: '12', label: 'Bold · 12 px' },
        ] },
      { key: 'lineStyle',  label: 'Line style',   type: 'select', default: 'solid',
        options: [
          { value: 'solid',  label: 'Solid' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' },
        ] },
    ] },
  { id: 8,  title: "City planning",               category: "Urban",      complexity: "High",   mapType: "city",      accent: "alternative", mapStyle: "mono",      status: "live", description: "Build a neighbourhood analytics view with TomTom Admin Boundaries and Nearby Search. Fetch real stadsdeel polygons, sweep five POI categories inside the focused one, and surface counts, density and top names in a single stats card. The polygon's fill colour, outline colour, width and dash style are exposed below — restyle the area to fit your urban-data brand.", tags: ["zoning", "boundaries", "traffic", "transit", "urban"],
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
      { key: 'traffic',     label: 'Traffic flow',   type: 'toggle', default: true },
      { key: 'fillColor',   label: 'Fill colour',    type: 'color',  default: '#6443A1' },
      { key: 'strokeColor', label: 'Outline colour', type: 'color',  default: '#6443A1' },
      { key: 'strokeWidth', label: 'Outline width',  type: 'select', default: '3',
        options: [
          { value: '1', label: 'Thin · 1 px' },
          { value: '3', label: 'Default · 3 px' },
          { value: '5', label: 'Bold · 5 px' },
        ] },
      { key: 'strokeStyle', label: 'Outline style',  type: 'select', default: 'solid',
        options: [
          { value: 'solid',  label: 'Solid' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' },
        ] },
    ] },
  { id: 9,  title: "Where to stay",               category: "Discovery",  complexity: "Medium", mapType: "realestate",accent: "alternative", mapStyle: "mono",      status: "live", description: "Build a category-density heatmap with the TomTom Search API across four European cities. Probe restaurants, museums, shops, bars or transit stops in a 3.5 km radius around a city anchor, then render the result as a MapLibre heatmap weighted by POI count. Swap the gradient palette below to retheme the legend for your brand.", tags: ["heatmap", "POIs", "where to stay", "neighbourhoods"],
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
      { key: 'palette', label: 'Density palette', type: 'select', default: 'green-red',
        options: [
          { value: 'green-red',  label: 'Green → Red · default' },
          { value: 'blue-red',   label: 'Blue → Red · classic' },
          { value: 'violet-pink',label: 'Violet → Pink · brand' },
          { value: 'teal-coral', label: 'Teal → Coral · soft' },
          { value: 'amber-red',  label: 'Amber → Red · warm' },
        ] },
    ] },
  { id: 10, title: "Activity tracker",            category: "Lifestyle",  complexity: "Medium", mapType: "sport",     accent: "negative",    mapStyle: "mono", status: "live", description: "Build an activity replay view with the TomTom Routing API (live mode) or a recorded GPX/TCX/GeoJSON file (file mode). Both paths normalise to the same shape: a snapped polyline, per-km splits enriched with HR/elevation from the file when available, plus start/finish pins with summary stats. The track colour, thickness and dash pattern are exposed below — brand it for your fitness UI.", tags: ["activity", "cycling", "splits", "fitness", "GPX", "TCX"],
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
      { key: 'routeColor', label: 'Track colour', type: 'color',  default: '#EE6748' },
      { key: 'lineWidth',  label: 'Line width',   type: 'select', default: '8',
        options: [
          { value: '4',  label: 'Thin · 4 px' },
          { value: '8',  label: 'Default · 8 px' },
          { value: '12', label: 'Bold · 12 px' },
        ] },
      { key: 'lineStyle',  label: 'Line style',   type: 'select', default: 'solid',
        options: [
          { value: 'solid',  label: 'Solid' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' },
        ] },
    ] },
  { id: 11, title: "Shared mobility",             category: "Mobility",   complexity: "High",   mapType: "sharing",   accent: "neutral",     status: "live", description: "Build a multi-brand vehicle-sharing map with the TomTom Search API. Query real parking lots and bicycle parking around an anchor, then stage scooters, bikes and cars on those positions — every vehicle ends up on a real parking spot, not floating mid-canal. Customise each brand's pin colour below to see how the legend retunes live.", tags: ["sharing", "multi-brand", "scooters", "cars"],
    tools: [
      { name: "Orbis Maps SDK",         type: "sdk" },
      { name: "Places API",             type: "api",        docs: "https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search" },
      { name: "Routing API",            type: "api",        docs: "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route" },
      { name: "3rd Party Provider APIs",type: "integration" },
    ],
    params: [
      { key: 'anchor',       label: 'Anchor',          default: 'Leidseplein, Amsterdam' },
      { key: 'scooterColor', label: 'Scooter colour',  type: 'color', default: '#DBA43A' },
      { key: 'bikeColor',    label: 'Bike colour',     type: 'color', default: '#3C5C98' },
      { key: 'carColor',     label: 'Car colour',      type: 'color', default: '#4CA262' },
    ] },
  { id: 12, title: "Find an EV charger",          category: "Mobility",   complexity: "Medium", mapType: "ev",        accent: "positive",    status: "live", description: "Build a live EV-charger availability map with TomTom Search + EV Charging Availability. Pull every charger in a 2.5 km radius around an anchor, fetch real-time connector status, and render each pin coloured by availability and sized by speed tier (slow, fast, rapid). The available / occupied / unknown colours are exposed below — re-theme the legend without touching the data flow.", tags: ["EV", "charging", "availability", "connectors"],
    tools: [
      { name: "Search API",                   type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/nearby-search" },
      { name: "EV Charging Availability API", type: "api", docs: "https://docs.tomtom.com/ev-search-api/documentation/product-information/introduction" },
      { name: "Orbis Maps SDK",               type: "sdk" },
    ],
    params: [
      { key: 'anchor',          label: 'Anchor',           default: 'Museumplein, Amsterdam' },
      { key: 'availableColor',  label: 'Available colour', type: 'color', default: '#4CA262' },
      { key: 'occupiedColor',   label: 'Occupied colour',  type: 'color', default: '#DBA43A' },
      { key: 'unknownColor',    label: 'Unknown colour',   type: 'color', default: '#646E7B' },
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
