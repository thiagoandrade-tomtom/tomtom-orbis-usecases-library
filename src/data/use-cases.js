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
   - `'satellite'`           — TomTom satellite imagery (single theme)

   Entries are kept in alphabetical order by `title` so this source file
   matches the order rendered in the picker (`filteredCases()` sorts the
   same way). IDs are renumbered 1..N on every reordering. */

export const USE_CASES = [
  { id: 1,  title: "Activity tracker",            category: "Urban",      complexity: "Medium", mapType: "sport",     accent: "negative",    mapStyle: "mono", status: "live", description: "Build an activity replay view with the TomTom Routing API (live mode) or a recorded GPX/TCX/GeoJSON file (file mode). Both paths normalise to the same shape: a snapped polyline, per-km splits enriched with HR/elevation from the file when available, plus start/finish pins with summary stats. The track colour, thickness and dash pattern are exposed below — brand it for your fitness UI.", tags: ["activity", "fitness", "running", "cycling", "hiking", "splits", "GPX", "TCX"],
    tools: [
      { name: "Orbis Maps SDK",  type: "sdk" },
      { name: "Maps Display API",type: "api", docs: "https://docs.tomtom.com/map-display-api/documentation/tomtom-maps/vector/tile" },
      { name: "Elevation API",   type: "api" },
    ],
    params: [
      { key: 'activity', label: 'Activity', type: 'select', default: 'tcs-amsterdam-marathon.gpx',
        options: [
          { value: 'tcs-amsterdam-marathon.gpx',    label: 'TCS Amsterdam Marathon · 42 km running' },
          { value: 'amsterdam-zandvoort.gpx',       label: 'Sloterdijk → Zandvoort · 22 km cycling' },
        ] },
      { key: 'routeColor', label: 'Track colour', type: 'color',  default: '#F05A0A' },
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
  { id: 2,  title: "Discover places",             category: "Urban",      complexity: "Medium", mapType: "poi",       accent: "neutral",     status: "live", description: "Build a click-to-inspect POI experience on TomTom's vector tiles — the basemap carries the POIs, no overlay duplicates. A click runs queryRenderedFeatures + Reverse Geocoding + POI Search in parallel to enrich the popup with address, category, phone, website, opening hours and brand. Opens tilted, so the base-style 3D buildings and landmarks add depth.", tags: ["POI", "click-to-inspect", "address", "discovery", "opening hours"],
    tools: [
      { name: "Places API",        type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search" },
      { name: "Search API",        type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/nearby-search" },
      { name: "Reverse Geocoding API", type: "api", docs: "https://docs.tomtom.com/reverse-geocoding-api/documentation/product-information/introduction" },
      { name: "Orbis 3D Landmarks API", type: "api", docs: "https://developer.tomtom.com/map-display-api/documentation/tomtom-orbis-maps/3d/landmarks" },
      { name: "Orbis Maps SDK",    type: "sdk" },
    ],
    params: [
      { key: 'anchor',     label: 'Anchor', default: 'Eiffel Tower, Paris' },
      // Start with a lean, high-signal subset active so the map isn't
      // flooded with every POI category. The rest still appear in the
      // chip rail (populated from the tiles in view) — they just begin
      // unchecked and the user can toggle them on.
      { key: 'categories', label: 'Categories in view', type: 'chips',
        default: ['eat_and_drink', 'leisure', 'outdoor', 'public', 'shopping', 'transport'] },
    ] },
  { id: 3,  title: "Find an EV charger",          category: "Mobility",   complexity: "Medium", mapType: "ev",        accent: "positive",    status: "live", description: "Build a live EV-charger availability map with TomTom Search + EV Charging Availability. Pull every charger in a 2.5 km radius around an anchor, fetch real-time connector status, and render each pin coloured by availability and sized by speed tier (slow, fast, rapid). The available / occupied / unknown colours are exposed below — re-theme the legend without touching the data flow.", tags: ["EV", "charging", "availability", "connectors"],
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
  { id: 4,  title: "Live delivery dispatch",      category: "Logistics",  complexity: "High",   mapType: "delivery",  accent: "neutral",     mapStyle: "driving",   status: "live", description: "Build a multi-stop dispatch view with the TomTom Routing API's multi-point optimisation. Hand a depot plus a list of customer addresses with computeBestOrder enabled; TomTom resolves the optimal visit order, returns the snapped polyline, and you render the legs with sequenced number pins and per-stop ETAs. Tune route colour, thickness and style below to differentiate dispatch from driver views.", tags: ["delivery", "dispatch", "optimization", "stops"],
    tools: [
      { name: "Routing API",           type: "api", docs: "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route" },
      { name: "Orbis Maps SDK",        type: "sdk" },
      { name: "Traffic Incidents API", type: "api", docs: "https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-incidents/traffic-incidents-service" },
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
  { id: 5,  title: "Temperature map",              category: "Climate",    complexity: "Medium", mapType: "heatmap",   accent: "negative",    mapStyle: "satellite", status: "live", description: "Build a temperature heatmap from open data. Daily-high air temperature from Open-Meteo — a free, no-key weather API — is interpolated into one fluid heat field clipped to the chosen continent's countries on the TomTom Orbis basemap, with the critical zones (≥ 30 °C) glowing on top. Pick a continent and a moment — yesterday, a year ago, or a notable heatwave — and toggle °C/°F.", tags: ["heatmap", "temperature", "weather", "open data", "historical", "climate", "critical zones"],
    tools: [
      { name: "Orbis Maps SDK",  type: "sdk" },
      { name: "Maps Display API", type: "api",         docs: "https://docs.tomtom.com/map-display-api/documentation/tomtom-maps/vector/tile" },
      { name: "Open-Meteo API",   type: "integration", docs: "https://open-meteo.com/en/docs" },
    ],
    params: [
      { key: 'region', label: 'Region', type: 'select', default: 'europe',
        options: [
          { value: 'world',         label: 'World' },
          { value: 'europe',        label: 'Europe' },
          { value: 'north-america', label: 'North America' },
          { value: 'south-america', label: 'South America' },
          { value: 'africa',        label: 'Africa' },
          { value: 'asia',          label: 'Asia' },
          { value: 'oceania',       label: 'Oceania' },
        ] },
      { key: 'period', label: 'When', type: 'select', default: 'yesterday',
        options: [
          { value: 'yesterday',  label: 'Yesterday' },
          { value: 'last-year',  label: 'A year ago' },
          { value: '2023-07-18', label: 'Jul 2023 · Cerberus heatwave' },
          { value: '2021-06-29', label: 'Jun 2021 · Pacific NW dome' },
        ] },
      { key: 'palette', label: 'Colour tones', type: 'select', default: 'classic',
        options: [
          { value: 'classic',  label: 'Classic · blue → red' },
          { value: 'spectral', label: 'Spectral · meteo' },
          { value: 'inferno',  label: 'Inferno · warm' },
          { value: 'viridis',  label: 'Viridis · perceptual' },
        ] },
      { key: 'unit', label: 'Units', type: 'select', default: 'c',
        options: [
          { value: 'c', label: 'Celsius · °C' },
          { value: 'f', label: 'Fahrenheit · °F' },
        ] },
    ] },
  { id: 6,  title: "Long-distance EV trip",       category: "Routing",    complexity: "High",   mapType: "multistop", accent: "positive",    mapStyle: "driving",   status: "live", description: "Build a long-distance EV trip planner with the TomTom Long-Distance EV Routing API and Orbis Maps SDK. Send a real vehicle consumption curve and battery profile — TomTom returns the route with charging stops already inserted, each enriched live with availability, connector mix and reverse-geocoded street names. Tune the route's colour, thickness and dash pattern below to brand it.", tags: ["EV", "charging stops", "long distance", "energy"],
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
  { id: 7,  title: "Neighbourhood analysis",      category: "Urban",      complexity: "High",   mapType: "city",      accent: "general",     mapStyle: "mono",      status: "live", description: "Build a neighbourhood walkability analyser with TomTom Reverse Geocoding, Search and Admin Boundaries. Any click on the map resolves the underlying subdivision, pulls its admin polygon, and sweeps six daily-life essentials — groceries, schools, healthcare, transit, parks, cafés — inside a 1.2 km walk buffer. Render a 5-star walkability rating, per-category counts, and a session-local ranking that grows as the user explores. The polygon's fill, outline, width and dash are exposed below — restyle the area to fit your urban-data brand.", tags: ["walkability", "boundaries", "neighbourhoods", "transit", "urban"],
    tools: [
      { name: "Orbis Maps SDK",  type: "sdk" },
      { name: "Search API",      type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/nearby-search" },
      { name: "Admin Boundaries",type: "api" },
      { name: "Traffic Flow API",type: "api", docs: "https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-flow/traffic-flow-service" },
    ],
    params: [
      { key: 'region', label: 'Region', type: 'combobox', default: 'paris',
        search: 'city', placeholder: 'Search any city',
        options: [
          { value: 'amsterdam', label: 'Amsterdam' },
          { value: 'paris',     label: 'Paris' },
          { value: 'berlin',    label: 'Berlin' },
          { value: 'newyork',   label: 'New York' },
          { value: 'saopaulo',  label: 'São Paulo' },
          { value: 'tokyo',     label: 'Tokyo' },
        ] },
      { key: 'traffic',     label: 'Traffic flow',   type: 'toggle', default: true },
      { key: 'fillColor',   label: 'Fill colour',    type: 'color',  default: '#646E7B' },
      { key: 'strokeColor', label: 'Outline colour', type: 'color',  default: '#646E7B' },
      { key: 'strokeWidth', label: 'Outline width',  type: 'select', default: '4',
        options: [
          { value: '4',  label: 'Default · 4 px' },
          { value: '8',  label: 'Bold · 8 px' },
          { value: '12', label: 'Extra · 12 px' },
        ] },
      { key: 'strokeStyle', label: 'Outline style',  type: 'select', default: 'solid',
        options: [
          { value: 'solid',  label: 'Solid' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' },
        ] },
    ] },
  { id: 8,  title: "Package tracker",             category: "Logistics",  complexity: "Medium", mapType: "package",   accent: "neutral",     mapStyle: "driving",   status: "live", description: "Build a customer-facing parcel tracker with the TomTom Routing API and Orbis Maps SDK. Geocode the hub and recipient address, draw the snapped courier path between them, and animate a courier marker along the polyline with a live ETA window. The route colour, thickness and dash style are exposed below — brand it for your last-mile UX.", tags: ["parcel", "last-mile", "ETA", "customer-facing"],
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
  { id: 9,  title: "Plan a route",                category: "Routing",    complexity: "Medium", mapType: "route",     accent: "neutral",     mapStyle: "driving",   status: "live", description: "Build a turn-by-turn route planner with the TomTom Routing API and Orbis Maps SDK. Geocode two addresses, ask Routing for the primary plus alternatives, and render them as styled polylines you can click to promote. Tweak the colour, thickness and dash pattern below to see how the same response renders under your brand.", tags: ["routing", "navigation", "ETA", "traffic"],
    tools: [
      { name: "Routing API",          type: "api", docs: "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route" },
      { name: "Orbis Maps SDK",       type: "sdk" },
      { name: "Traffic Incidents API",type: "api", docs: "https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-incidents/traffic-incidents-service" },
    ],
    params: [
      { key: 'from', label: 'From', type: 'text', default: 'Schiphol Airport, Amsterdam' },
      { key: 'to',   label: 'To',   type: 'text', default: 'Conservatorium Hotel, Amsterdam' },
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
  { id: 10, title: "Shared mobility",             category: "Mobility",   complexity: "High",   mapType: "sharing",   accent: "neutral",     status: "live", description: "Build a multi-brand vehicle-sharing map with the TomTom Search API. Query real parking lots and bicycle parking around an anchor, then stage scooters, bikes and cars on those positions — every vehicle ends up on a real parking spot, not floating mid-canal. Customise each brand's pin colour below to see how the legend retunes live.", tags: ["sharing", "multi-brand", "scooters", "bikes", "cars", "parking"],
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
  { id: 11, title: "Track your fleet",            category: "Logistics",  complexity: "High",   mapType: "fleet",     accent: "general",     mapStyle: "driving",   status: "live", description: "Build a dispatcher-style fleet view with TomTom Routing API, Admin Boundaries and the Geofencing API. Each van is snapped to a real route between two geocoded points and tagged by status — on-route, idle, delayed by a traffic incident, or violating the geofence by leaving the Amsterdam municipality polygon. Pin colour encodes the state at a glance; click any van for live telemetry. The geofence styling and each status colour are exposed below so the dispatcher view can be rebranded without touching the data flow.", tags: ["fleet", "tracking", "geofence", "live", "dispatcher"],
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
  { id: 12, title: "Vibe density",                category: "Urban",      complexity: "Medium", mapType: "density",   accent: "alternative", mapStyle: "mono",      status: "live", description: "Build a city-scale density heatmap with the TomTom Search API across four European cities. Pick the vibes you care about — dining, cafés, nightlife, sights, parks, transit and more — and the map renders where that mix concentrates as a live density layer. POIs are sampled from six to seven anchors per city so the heatmap covers the whole metro footprint, not just a disc around one point.", tags: ["heatmap", "density", "POIs", "vibes", "multi-criteria"],
    tools: [
      { name: "Places API",     type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/nearby-search" },
      { name: "Search API",     type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search" },
      { name: "Orbis Maps SDK", type: "sdk" },
    ],
    params: [
      { key: 'city', label: 'City', type: 'select', default: 'amsterdam',
        options: [
          { value: 'amsterdam', label: 'Amsterdam' },
          { value: 'paris',     label: 'Paris' },
          { value: 'berlin',    label: 'Berlin' },
          { value: 'barcelona', label: 'Barcelona' },
        ] },
      { key: 'vibes', label: 'Your vibes', type: 'chips',
        default: ['dining', 'cafes', 'parks'],
        options: [
          { value: 'dining',    label: 'Dining' },
          { value: 'cafes',     label: 'Cafés' },
          { value: 'nightlife', label: 'Nightlife' },
          { value: 'sights',    label: 'Sights' },
          { value: 'shopping',  label: 'Shopping' },
          { value: 'parks',     label: 'Parks' },
          { value: 'transit',   label: 'Transit' },
          { value: 'markets',   label: 'Markets' },
        ] },
      { key: 'radius', label: 'Anchor radius', type: 'select', default: '3000',
        options: [
          { value: '2000', label: '2 km · per anchor' },
          { value: '3000', label: '3 km · default' },
          { value: '4000', label: '4 km · wide overlap' },
        ] },
      { key: 'palette', label: 'Density palette', type: 'select', default: 'sunset',
        options: [
          { value: 'sunset',     label: 'Sunset · yellow → purple' },
          { value: 'tropic',     label: 'Tropic · aqua → magenta' },
          { value: 'peach',      label: 'Peach · pastel → purple' },
          { value: 'violet-pink',label: 'Violet → Pink · brand' },
          { value: 'teal-coral', label: 'Teal → Coral · soft' },
          { value: 'amber-red',  label: 'Amber → Red · warm' },
        ] },
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
