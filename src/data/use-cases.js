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

   `blurb` (string) is the one-line promise shown on the list card — the
   *result*, not the method. Keep it under 40 characters: the card
   truncates rather than wraps, and 40 is what fits at the rail's default
   width. `description` stays the long form for the detail panel.

   `primaryTool` (string) names the one API the card advertises. It must
   match an entry in this case's `tools[]` by name. Pick the most
   *distinctive* API rather than the most used one — Admin Boundaries
   over Search API for the neighbourhood case — since the card only gets
   one. Two hard rules, enforced by `primaryToolFor`:
   - always a TomTom API, never a third-party `integration` (the
     Temperature map advertises Maps Display, not Open-Meteo);
   - never an `exclusive` one — the card should not sell an API the
     reader may not be able to call. Gating stays visible in the detail
     panel's Tools & APIs list, where the full stack is shown.

   Entries are kept in alphabetical order by `title` so this source file
   matches the order rendered in the picker (`filteredCases()` sorts the
   same way). IDs are renumbered 1..N on every reordering. */

export const USE_CASES = [
  { id: 1,  title: "Activity tracker",            category: "Urban",      complexity: "Medium", mapType: "sport",     accent: "negative",    mapStyle: "mono", status: "live", blurb: "Replay a run or ride with per-km splits", primaryTool: "Maps Display API", description: "Replay a recorded GPX, TCX or GeoJSON track — per-km splits, a pace gradient, plus real HR and elevation read from the file.", tags: ["activity", "fitness", "running", "cycling", "hiking", "splits", "GPX", "TCX", "GeoJSON", "pace", "heart rate", "elevation"],
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
  { id: 2,  title: "Discover places",             category: "Urban",      complexity: "Medium", mapType: "poi",       accent: "neutral",     status: "live", blurb: "Click a POI for address and hours", primaryTool: "Places API", description: "Click a POI on TomTom's vector tiles: queryRenderedFeatures, Reverse Geocoding and POI Search run in parallel to fill the popup.", tags: ["POI", "click-to-inspect", "address", "discovery", "opening hours", "phone", "website", "3D landmarks", "reverse geocoding"],
    tools: [
      { name: "Places API",        type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search" },
      { name: "Search API",        type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/nearby-search" },
      { name: "Reverse Geocoding API", type: "api", docs: "https://docs.tomtom.com/reverse-geocoding-api/documentation/product-information/introduction" },
      { name: "Orbis 3D Landmarks API", type: "api", exclusive: true, docs: "https://docs.tomtom.com/private/map-display-api/documentation/tomtom-orbis-maps/v1/3d/landmarks" },
      { name: "Orbis Maps SDK",    type: "sdk" },
    ],
    params: [
      // Dropdown of famous landmarks that also happen to sit in dense POI
      // areas (so the chip rail has something to show), but free-text too:
      // `search: 'place'` runs the fuzzy endpoint, so any landmark, POI or
      // address worldwide resolves. Preset `value` IS the label — the scene
      // just geocodes the stored string either way.
      { key: 'anchor', label: 'Anchor', type: 'combobox', default: 'Eiffel Tower, Paris',
        search: 'place', placeholder: 'Search any place or address',
        options: [
          { value: 'Eiffel Tower, Paris',              label: 'Eiffel Tower · Paris' },
          { value: 'Colosseum, Rome',                  label: 'Colosseum · Rome' },
          { value: 'Sagrada Família, Barcelona',       label: 'Sagrada Família · Barcelona' },
          { value: 'Big Ben, London',                  label: 'Big Ben · London' },
          { value: 'Brandenburg Gate, Berlin',         label: 'Brandenburg Gate · Berlin' },
          { value: 'Dam Square, Amsterdam',            label: 'Dam Square · Amsterdam' },
          { value: 'Times Square, New York',           label: 'Times Square · New York' },
          { value: 'Shibuya Crossing, Tokyo',          label: 'Shibuya Crossing · Tokyo' },
          { value: 'Burj Khalifa, Dubai',              label: 'Burj Khalifa · Dubai' },
          { value: 'Sydney Opera House, Sydney',       label: 'Sydney Opera House · Sydney' },
        ] },
      // Start with a lean, high-signal subset active so the map isn't
      // flooded with every POI category. The rest still appear in the
      // chip rail (populated from the tiles in view) — they just begin
      // unchecked and the user can toggle them on.
      { key: 'categories', label: 'Categories in view', type: 'chips',
        default: ['eat_and_drink', 'leisure', 'outdoor', 'public', 'shopping', 'transport'] },
    ] },
  { id: 3,  title: "Find an EV charger",          category: "Mobility",   complexity: "Medium", mapType: "ev",        accent: "positive",    status: "live", blurb: "Live charger availability nearby", primaryTool: "EV Charging Availability API", description: "Every charger within 2.5 km, coloured by real-time connector status and sized by speed tier — slow, fast or rapid.", tags: ["EV", "charging", "availability", "connectors", "speed tier", "occupied", "real-time"],
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
  { id: 4,  title: "Live delivery dispatch",      category: "Logistics",  complexity: "High",   mapType: "delivery",  accent: "neutral",     mapStyle: "driving",   status: "live", blurb: "Optimal stop order with per-stop ETAs", primaryTool: "Routing API", description: "Hand TomTom a depot and a list of addresses with computeBestOrder on — it returns the optimal visit order and per-stop ETAs.", tags: ["delivery", "dispatch", "optimization", "stops", "multi-stop", "computeBestOrder", "route optimisation"],
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
  { id: 5,  title: "Temperature map",              category: "Climate",    complexity: "Medium", mapType: "heatmap",   accent: "negative",    mapStyle: "satellite", status: "live", blurb: "Heat field of daily highs, any date", primaryTool: "Maps Display API", description: "Daily-high temperatures from Open-Meteo, interpolated into one heat field clipped to a continent. Zones at 30 °C and up glow on top.", tags: ["heatmap", "temperature", "weather", "open data", "historical", "climate", "critical zones", "heatwave", "Open-Meteo", "continents"],
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
  { id: 6,  title: "Long-distance EV trip",       category: "Routing",    complexity: "High",   mapType: "multistop", accent: "positive",    mapStyle: "driving",   status: "live", blurb: "Charging stops from a battery curve", primaryTool: "Long Distance EV Routing API", description: "Send a real consumption curve and battery profile — TomTom returns the route with charging stops already inserted and live availability.", tags: ["EV", "charging stops", "long distance", "energy", "connectors", "battery", "consumption curve"],
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
  { id: 7,  title: "Neighbourhood analysis",      category: "Urban",      complexity: "High",   mapType: "city",      accent: "general",     mapStyle: "mono",      status: "live", blurb: "Score any area on daily essentials", primaryTool: "Admin Boundaries", description: "Click any area to pull its admin polygon, then sweep six daily essentials inside a 1.2 km walk buffer for a 5-star walkability score.", tags: ["walkability", "boundaries", "neighbourhoods", "transit", "urban", "groceries", "schools", "healthcare", "parks", "cafés", "admin boundaries", "reverse geocoding"],
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
          { value: 'amsterdam',  label: 'Amsterdam' },
          { value: 'paris',      label: 'Paris' },
          { value: 'berlin',     label: 'Berlin' },
          { value: 'london',     label: 'London' },
          { value: 'barcelona',  label: 'Barcelona' },
          { value: 'newyork',    label: 'New York' },
          { value: 'mexicocity', label: 'Mexico City' },
          { value: 'saopaulo',   label: 'São Paulo' },
          { value: 'tokyo',      label: 'Tokyo' },
          { value: 'singapore',  label: 'Singapore' },
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
  { id: 8,  title: "Package tracker",             category: "Logistics",  complexity: "Medium", mapType: "package",   accent: "neutral",     mapStyle: "driving",   status: "live", blurb: "Track a courier to the door, live ETA", primaryTool: "Routing API", description: "Geocode hub and recipient, draw the snapped courier path, then animate the courier along it with a live ETA window.", tags: ["parcel", "last-mile", "ETA", "customer-facing", "courier", "geocoding", "address"],
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
  { id: 9,  title: "Plan a route",                category: "Routing",    complexity: "Medium", mapType: "route",     accent: "neutral",     mapStyle: "driving",   status: "live", blurb: "Turn-by-turn with alternatives", primaryTool: "Routing API", description: "Geocode two addresses, ask Routing for the primary plus alternatives, and click any polyline to promote it.", tags: ["routing", "navigation", "ETA", "traffic", "turn-by-turn", "alternatives", "geocoding"],
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
  { id: 10, title: "Shared mobility",             category: "Mobility",   complexity: "High",   mapType: "sharing",   accent: "neutral",     status: "live", blurb: "Scooters, bikes and cars in one map", primaryTool: "Places API", description: "Scooters, bikes and cars staged on real parking spots from TomTom Search — every vehicle on tarmac, none floating mid-canal.", tags: ["sharing", "multi-brand", "scooters", "bikes", "cars", "parking", "bicycle parking", "vehicle sharing"],
    tools: [
      { name: "Orbis Maps SDK",         type: "sdk" },
      { name: "Places API",             type: "api",        docs: "https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search" },
      { name: "Routing API",            type: "api",        docs: "https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route" },
      { name: "Provider feed (GBFS)",  type: "integration", docs: "https://gbfs.org/documentation/reference/" },
    ],
    params: [
      // Central squares and transport hubs rather than landmarks: this
      // scene stages vehicles on real parking / bike-parking positions,
      // so the anchor has to sit where a provider would actually park
      // them. Free text still resolves any address worldwide.
      { key: 'anchor', label: 'Anchor', type: 'combobox', default: 'Leidseplein, Amsterdam',
        search: 'place', placeholder: 'Search any place or address',
        options: [
          { value: 'Leidseplein, Amsterdam',          label: 'Leidseplein · Amsterdam' },
          { value: 'Alexanderplatz, Berlin',          label: 'Alexanderplatz · Berlin' },
          { value: 'Place de la République, Paris',   label: 'Place de la République · Paris' },
          { value: 'Plaça de Catalunya, Barcelona',   label: 'Plaça de Catalunya · Barcelona' },
          { value: 'Rådhuspladsen, Copenhagen',       label: 'Rådhuspladsen · Copenhagen' },
          { value: 'Praça do Comércio, Lisbon',       label: 'Praça do Comércio · Lisbon' },
          { value: 'Piazza del Duomo, Milan',         label: 'Piazza del Duomo · Milan' },
          { value: 'Stephansplatz, Vienna',           label: 'Stephansplatz · Vienna' },
          { value: 'Grand Place, Brussels',           label: 'Grand Place · Brussels' },
          { value: 'Union Square, San Francisco',     label: 'Union Square · San Francisco' },
        ] },
      { key: 'scooterColor', label: 'Scooter colour',  type: 'color', default: '#DBA43A' },
      { key: 'bikeColor',    label: 'Bike colour',     type: 'color', default: '#3C5C98' },
      { key: 'carColor',     label: 'Car colour',      type: 'color', default: '#4CA262' },
    ] },
  { id: 11, title: "Track your fleet",            category: "Logistics",  complexity: "High",   mapType: "fleet",     accent: "general",     mapStyle: "driving",   status: "live", blurb: "Vans by status, geofence alerts", primaryTool: "Geofencing API", description: "Vans snapped to real routes and tagged on-route, idle, delayed by traffic or breaching the Amsterdam geofence.", tags: ["fleet", "tracking", "geofence", "live", "dispatcher", "geofencing", "telemetry", "traffic incidents", "municipality"],
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
  { id: 12, title: "Vibe density",                category: "Urban",      complexity: "Medium", mapType: "density",   accent: "alternative", mapStyle: "mono",      status: "live", blurb: "Where your chosen vibes concentrate", primaryTool: "Search API", description: "Pick your vibes — dining, nightlife, sights, parks — and see where they concentrate, sampled from seven anchors per city.", tags: ["heatmap", "density", "POIs", "vibes", "multi-criteria", "nightlife", "dining", "cities", "sights", "transit"],
    tools: [
      { name: "Places API",     type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/nearby-search" },
      { name: "Search API",     type: "api", docs: "https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search" },
      { name: "Orbis Maps SDK", type: "sdk" },
    ],
    params: [
      // Amsterdam / Paris / Berlin / Barcelona carry hand-tuned district
      // anchor sets in the scene; the other six sample a generated ring
      // around the city centre, and so does any city the user types.
      { key: 'city', label: 'City', type: 'combobox', default: 'amsterdam',
        search: 'city', placeholder: 'Search any city',
        options: [
          { value: 'amsterdam',  label: 'Amsterdam' },
          { value: 'paris',      label: 'Paris' },
          { value: 'berlin',     label: 'Berlin' },
          { value: 'barcelona',  label: 'Barcelona' },
          { value: 'london',     label: 'London' },
          { value: 'madrid',     label: 'Madrid' },
          { value: 'lisbon',     label: 'Lisbon' },
          { value: 'milan',      label: 'Milan' },
          { value: 'copenhagen', label: 'Copenhagen' },
          { value: 'vienna',     label: 'Vienna' },
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

/* The single API a list card advertises. Resolved against `tools[]` so
   the card and the detail panel can never disagree about the name.
   Anything gated or third-party is rejected here rather than trusted
   from the data, so a later catalog edit can't quietly put a padlocked
   or non-TomTom name on a card; the fallback is the first plain TomTom
   API, and null only if the case ships none. */
const advertisable = t => t.type === 'api' && !t.exclusive;
export function primaryToolFor(uc) {
  const tools = (uc.tools || []).filter(advertisable);
  return tools.find(t => t.name === uc.primaryTool) || tools[0] || null;
}

/* Card-only display names. A couple of API names are too long for the
   pill and would ellipsize into nothing readable ("EV Charging Availabi…").
   The detail panel and the docs links always use the full name — this is
   a label, not a rename. */
const TOOL_SHORT = {
  "EV Charging Availability API": "EV Charging API",
  "Long Distance EV Routing API": "EV Routing API",
  "Admin Boundaries":             "Boundaries API",
};
export const toolLabel = name => TOOL_SHORT[name] || name;


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
  // Admin polygons come from the Orbis Search API "Additional Data" service.
  "Admin Boundaries":               "https://developer.tomtom.com/search-api/documentation/tomtom-orbis-maps/additional-data-service/additional-data",
  // No public docs page — rendered without a link. Elevation in the
  // Activity tracker comes from the uploaded GPX/TCX file, not a TomTom
  // API (TomTom has no public Elevation API), so it stays link-less.
  "Elevation API":                  null,
  "WebSockets / MQTT":              null,
};
