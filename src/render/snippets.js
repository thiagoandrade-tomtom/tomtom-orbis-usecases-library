/* Quickstart snippets shown in the detail panel.

   Snippets are syntax-highlighted (the legacy <span class="k|c|s|f|n">
   wrapping below), and use `{{paramKey}}` placeholders for values
   tunable via the Configure section. Each placeholder is rendered as a
   highlighted, read-only span that reflects the current param value —
   the Configure controls are the canonical edit surface. */

import { paramFor } from '../state.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
}[c]));

const BASE = `<span class="c">// Install: npm i @tomtom-org/maps-sdk maplibre-gl</span>
<span class="k">import</span> { TomTomMap } <span class="k">from</span> <span class="s">'@tomtom-org/maps-sdk/map'</span>;

<span class="k">const</span> map = <span class="k">new</span> <span class="f">TomTomMap</span>({
  key: <span class="n">import.meta.env.VITE_TOMTOM_API_KEY</span>,
  style: <span class="s">'</span>{{__style}}<span class="s">'</span>,
  mapLibre: {
    container: <span class="s">'map'</span>,
    center: [<span class="n">{{__lng}}</span>, <span class="n">{{__lat}}</span>],
    zoom: <span class="n">{{__zoom}}</span>
  }
});`;

/* Per-mapType extension templates. `{{key}}` placeholders correspond to
   the param keys declared in data/use-cases.js → params[]. */
const EXTRAS = {
  heatmap: `\n\n<span class="c">// 1. Pull live incidents for a bbox</span>
<span class="k">const</span> incidents = <span class="k">await</span> <span class="f">fetch</span>(
  <span class="s">\`https://api.tomtom.com/traffic/services/5/incidentDetails?key=\${key}&bbox=\${bbox}\`</span>
).<span class="f">then</span>(r => r.<span class="f">json</span>());

<span class="c">// 2. Heatmap layer — palette comes from the Configure panel</span>
map.mapLibreMap.<span class="f">addLayer</span>({
  id: <span class="s">'incidents'</span>,
  type: <span class="s">'heatmap'</span>,
  source: <span class="s">'traffic'</span>,
  paint: {
    <span class="s">'heatmap-radius'</span>:    <span class="n">32</span>,
    <span class="s">'heatmap-color'</span>: [
      <span class="s">'interpolate'</span>, [<span class="s">'linear'</span>], [<span class="s">'heatmap-density'</span>],
      <span class="n">0</span>,    <span class="s">'rgba(0,0,0,0)'</span>,
      <span class="n">0.4</span>,  <span class="s">'</span>{{__paletteLow}}<span class="s">'</span>,
      <span class="n">0.8</span>,  <span class="s">'</span>{{__paletteHot}}<span class="s">'</span>
    ]
  }
});`,

  poi: `\n\n<span class="c">// 1. Tilt + zoom so base-style 3D buildings get perspective</span>
<span class="k">const</span> center = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{anchor}}<span class="s">'</span>);
map.mapLibreMap.<span class="f">jumpTo</span>({ center, zoom: <span class="n">16</span>, pitch: <span class="n">45</span>, bearing: -<span class="n">18</span> });

<span class="c">// 2. Click any POI rendered by the basemap itself — no overlay</span>
map.mapLibreMap.<span class="f">on</span>(<span class="s">'click'</span>, <span class="k">async</span> (e) => {
  <span class="k">const</span> hit = map.mapLibreMap.<span class="f">queryRenderedFeatures</span>(e.point)
    .<span class="f">find</span>(f => /poi|place/i.<span class="f">test</span>(f.layer?.id || <span class="s">''</span>));
  <span class="k">if</span> (!hit) <span class="k">return</span>;

  <span class="c">// 3. Enrich the click in parallel — address + full POI record</span>
  <span class="k">const</span> [rev, hits] = <span class="k">await</span> <span class="f">Promise.all</span>([
    <span class="f">reverseGeocode</span>({ point: hit.geometry.coordinates }),
    <span class="f">poiSearch</span>({
      query: hit.properties.name,
      center: hit.geometry.coordinates,
      radius: <span class="n">80</span>,
      openingHours: <span class="k">true</span>,    <span class="c">// → poi.openingHours.timeRanges</span>
    }),
  ]);

  <span class="f">openCard</span>({
    accent:   <span class="s">'</span>{{markerColor}}<span class="s">'</span>,
    title:    hit.properties.name,
    subtitle: rev.address,
    hours:    hits[<span class="n">0</span>]?.openingHours,
    phone:    hits[<span class="n">0</span>]?.phone,
    url:      hits[<span class="n">0</span>]?.url,
    brand:    hits[<span class="n">0</span>]?.brands?.[<span class="n">0</span>],
  });
});`,

  route: `\n\n<span class="c">// 1. Geocode both endpoints, then calculate the route</span>
<span class="k">const</span> from = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{from}}<span class="s">'</span>);
<span class="k">const</span> to   = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{to}}<span class="s">'</span>);
<span class="k">const</span> r = <span class="k">await</span> <span class="f">fetch</span>(
  <span class="s">\`https://api.tomtom.com/routing/1/calculateRoute/\${from}:\${to}/json\`</span> +
  <span class="s">\`?key=\${key}&travelMode=</span>{{travelMode}}<span class="s">&traffic=</span>{{traffic}}<span class="s">\`</span>
).<span class="f">then</span>(r => r.<span class="f">json</span>());

<span class="c">// 2. Paint it — colour, width and dash all come from the Configure panel</span>
map.mapLibreMap.<span class="f">addSource</span>(<span class="s">'route'</span>, { type: <span class="s">'geojson'</span>, data: r.routes[<span class="n">0</span>] });
map.mapLibreMap.<span class="f">addLayer</span>({
  id: <span class="s">'route'</span>,
  type: <span class="s">'line'</span>,
  source: <span class="s">'route'</span>,
  layout: { <span class="s">'line-cap'</span>: <span class="s">'round'</span>, <span class="s">'line-join'</span>: <span class="s">'round'</span> },
  paint: {
    <span class="s">'line-color'</span>:     <span class="s">'</span>{{routeColor}}<span class="s">'</span>,
    <span class="s">'line-width'</span>:     <span class="n">{{lineWidth}}</span>,
    <span class="s">'line-dasharray'</span>: {{__dasharray}}
  }
});`,

  multistop: `\n\n<span class="c">// 1. Long-distance EV trip with auto-inserted charging stops</span>
<span class="k">const</span> from = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{from}}<span class="s">'</span>);
<span class="k">const</span> to   = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{to}}<span class="s">'</span>);
<span class="k">const</span> { routes } = <span class="k">await</span> <span class="f">fetch</span>(
  <span class="s">\`https://api.tomtom.com/routing/1/calculateLongDistanceEVRoute/\${from}:\${to}/json\`</span> +
  <span class="s">\`?key=\${key}&vehicleEngineType=electric&currentChargeInkWh=\`</span> + {{startCharge}}
).<span class="f">then</span>(r => r.<span class="f">json</span>());

<span class="c">// 2. Paint the EV route — colour, width and dash from Configure</span>
map.mapLibreMap.<span class="f">addLayer</span>({
  id: <span class="s">'ev-route'</span>, type: <span class="s">'line'</span>, source: <span class="s">'ev-route'</span>,
  paint: {
    <span class="s">'line-color'</span>:     <span class="s">'</span>{{routeColor}}<span class="s">'</span>,
    <span class="s">'line-width'</span>:     <span class="n">{{lineWidth}}</span>,
    <span class="s">'line-dasharray'</span>: {{__dasharray}}
  }
});`,

  fleet: `\n\n<span class="c">// 1. Geofence — the real Amsterdam municipality polygon</span>
<span class="k">const</span> { boundaryId } = <span class="k">await</span> <span class="f">geocode</span>({ query: <span class="s">'Amsterdam'</span>, entityType: <span class="s">'Municipality'</span> });
<span class="k">const</span> boundary = <span class="k">await</span> <span class="f">fetchBoundary</span>(boundaryId);
map.mapLibreMap.<span class="f">addSource</span>(<span class="s">'geofence'</span>, { type: <span class="s">'geojson'</span>, data: boundary });
map.mapLibreMap.<span class="f">addLayer</span>({
  id: <span class="s">'geofence-fill'</span>, type: <span class="s">'fill'</span>, source: <span class="s">'geofence'</span>,
  paint: { <span class="s">'fill-color'</span>: <span class="s">'</span>{{geofenceColor}}<span class="s">'</span>, <span class="s">'fill-opacity'</span>: <span class="n">0.10</span> }
});
map.mapLibreMap.<span class="f">addLayer</span>({
  id: <span class="s">'geofence-line'</span>, type: <span class="s">'line'</span>, source: <span class="s">'geofence'</span>,
  paint: {
    <span class="s">'line-color'</span>:     <span class="s">'</span>{{geofenceColor}}<span class="s">'</span>,
    <span class="s">'line-width'</span>:     <span class="n">3</span>,
    <span class="s">'line-dasharray'</span>: {{__dasharray}}
  }
});

<span class="c">// 2. Each van → snap-routed between two geocoded points,</span>
<span class="c">//    pin coloured by status (the dispatcher view's narrative).</span>
<span class="k">const</span> palette = {
  <span class="s">'on-route'</span>:     <span class="s">'</span>{{onRouteColor}}<span class="s">'</span>,
  <span class="s">'idle'</span>:         <span class="s">'</span>{{idleColor}}<span class="s">'</span>,
  <span class="s">'delayed'</span>:      <span class="s">'</span>{{alertColor}}<span class="s">'</span>,
  <span class="s">'outside-zone'</span>: <span class="s">'</span>{{alertColor}}<span class="s">'</span>,
};
vehicles.<span class="f">forEach</span>(v => <span class="f">addMarker</span>({
  color: palette[v.status], icon: <span class="s">'truck'</span>,
}, v.position));`,

  package: `\n\n<span class="c">// 1. Hub → recipient route + live ETA</span>
<span class="k">const</span> hub  = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{hub}}<span class="s">'</span>);
<span class="k">const</span> dest = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{dest}}<span class="s">'</span>);
<span class="k">const</span> { geojson } = <span class="k">await</span> <span class="f">fetch</span>(
  <span class="s">\`https://api.tomtom.com/routing/1/calculateRoute/\${hub}:\${dest}/json?key=\${key}&traffic=true\`</span>
).<span class="f">then</span>(r => r.<span class="f">json</span>());

<span class="c">// 2. Paint the courier path — colour / width / dash from Configure</span>
map.mapLibreMap.<span class="f">addLayer</span>({
  id: <span class="s">'parcel'</span>, type: <span class="s">'line'</span>, source: <span class="s">'parcel'</span>,
  paint: {
    <span class="s">'line-color'</span>:     <span class="s">'</span>{{routeColor}}<span class="s">'</span>,
    <span class="s">'line-width'</span>:     <span class="n">{{lineWidth}}</span>,
    <span class="s">'line-dasharray'</span>: {{__dasharray}}
  }
});`,

  delivery: `\n\n<span class="c">// 1. Batch + TSP optimise the day's stops</span>
<span class="k">const</span> { geojson, optimizedWaypoints } = <span class="k">await</span> <span class="f">calculateMultiStopRoute</span>({
  points: [hub, ...stops], computeBestOrder: <span class="k">true</span>,
});

<span class="c">// 2. Render the snapped polyline — style from Configure</span>
map.mapLibreMap.<span class="f">addLayer</span>({
  id: <span class="s">'delivery'</span>, type: <span class="s">'line'</span>, source: <span class="s">'delivery'</span>,
  paint: {
    <span class="s">'line-color'</span>:     <span class="s">'</span>{{routeColor}}<span class="s">'</span>,
    <span class="s">'line-width'</span>:     <span class="n">{{lineWidth}}</span>,
    <span class="s">'line-dasharray'</span>: {{__dasharray}}
  }
});`,

  city: `\n\n<span class="c">// 1. Fetch admin boundary polygon for the focused neighbourhood</span>
<span class="k">const</span> boundary = <span class="k">await</span> <span class="f">fetchBoundary</span>(boundaryId, { zoom: <span class="n">12</span> });

<span class="c">// 2. Render fill + outline — every property comes from Configure</span>
map.mapLibreMap.<span class="f">addSource</span>(<span class="s">'area'</span>, { type: <span class="s">'geojson'</span>, data: boundary });
map.mapLibreMap.<span class="f">addLayer</span>({
  id: <span class="s">'area-fill'</span>, type: <span class="s">'fill'</span>, source: <span class="s">'area'</span>,
  paint: { <span class="s">'fill-color'</span>: <span class="s">'</span>{{fillColor}}<span class="s">'</span>, <span class="s">'fill-opacity'</span>: <span class="n">0.18</span> }
});
map.mapLibreMap.<span class="f">addLayer</span>({
  id: <span class="s">'area-outline'</span>, type: <span class="s">'line'</span>, source: <span class="s">'area'</span>,
  paint: {
    <span class="s">'line-color'</span>:     <span class="s">'</span>{{strokeColor}}<span class="s">'</span>,
    <span class="s">'line-width'</span>:     <span class="n">{{strokeWidth}}</span>,
    <span class="s">'line-dasharray'</span>: {{__dasharray}}
  }
});`,

  realestate: `\n\n<span class="c">// 1. Probe the lens (restaurants / museums / shops / bars / transit)</span>
<span class="k">const</span> { results } = <span class="k">await</span> <span class="f">fetch</span>(
  <span class="s">\`https://api.tomtom.com/search/2/poiSearch/restaurant.json?key=\${key}&lat=\${lat}&lon=\${lon}&radius=3500\`</span>
).<span class="f">then</span>(r => r.<span class="f">json</span>());

<span class="c">// 2. Render heatmap — gradient stops come from the Configure palette</span>
map.mapLibreMap.<span class="f">addLayer</span>({
  id: <span class="s">'heat'</span>, type: <span class="s">'heatmap'</span>, source: <span class="s">'poi'</span>,
  paint: {
    <span class="s">'heatmap-color'</span>: [
      <span class="s">'interpolate'</span>, [<span class="s">'linear'</span>], [<span class="s">'heatmap-density'</span>],
      <span class="n">0</span>,    <span class="s">'rgba(0,0,0,0)'</span>,
      <span class="n">0.2</span>,  <span class="s">'</span>{{__paletteFrom}}<span class="s">'</span>,
      <span class="n">0.45</span>, <span class="s">'</span>{{__paletteMid}}<span class="s">'</span>,
      <span class="n">0.7</span>,  <span class="s">'</span>{{__paletteWarm}}<span class="s">'</span>,
      <span class="n">1.0</span>,  <span class="s">'</span>{{__paletteHot}}<span class="s">'</span>
    ]
  }
});`,

  sport: `\n\n<span class="c">// 1. Load activity (live route OR recorded GPX/TCX/GeoJSON)</span>
<span class="k">const</span> { geojson, samples } = <span class="k">await</span> <span class="f">loadActivity</span>(<span class="s">'</span>{{activity}}<span class="s">'</span>);

<span class="c">// 2. Paint the track — colour / width / dash from Configure</span>
map.mapLibreMap.<span class="f">addSource</span>(<span class="s">'track'</span>, { type: <span class="s">'geojson'</span>, data: geojson });
map.mapLibreMap.<span class="f">addLayer</span>({
  id: <span class="s">'track'</span>, type: <span class="s">'line'</span>, source: <span class="s">'track'</span>,
  paint: {
    <span class="s">'line-color'</span>:     <span class="s">'</span>{{routeColor}}<span class="s">'</span>,
    <span class="s">'line-width'</span>:     <span class="n">{{lineWidth}}</span>,
    <span class="s">'line-dasharray'</span>: {{__dasharray}}
  }
});`,

  sharing: `\n\n<span class="c">// 1. Real anchors — parking + bike-parking POIs around the anchor</span>
<span class="k">const</span> center = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{anchor}}<span class="s">'</span>);
<span class="k">const</span> [parking, bikeParking] = <span class="k">await</span> <span class="f">Promise.all</span>([
  <span class="f">poiSearch</span>({ query: <span class="s">'parking'</span>, center, radius: <span class="n">1500</span> }),
  <span class="f">poiSearch</span>({ query: <span class="s">'bicycle parking'</span>, center, radius: <span class="n">1500</span> }),
]);

<span class="c">// 2. Stage vehicles — per-brand colour from Configure</span>
<span class="f">addMarker</span>({ color: <span class="s">'</span>{{scooterColor}}<span class="s">'</span>, icon: <span class="s">'bike'</span> }, bikeParking[<span class="n">0</span>].position);
<span class="f">addMarker</span>({ color: <span class="s">'</span>{{bikeColor}}<span class="s">'</span>,    icon: <span class="s">'bike'</span> }, bikeParking[<span class="n">1</span>].position);
<span class="f">addMarker</span>({ color: <span class="s">'</span>{{carColor}}<span class="s">'</span>,     icon: <span class="s">'car'</span>  }, parking[<span class="n">0</span>].position);`,

  ev: `\n\n<span class="c">// 1. Pull every EV charger in a 2.5 km radius around the anchor</span>
<span class="k">const</span> center = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{anchor}}<span class="s">'</span>);
<span class="k">const</span> chargers = <span class="k">await</span> <span class="f">fetch</span>(
  <span class="s">\`https://api.tomtom.com/search/2/nearbySearch/.json?key=\${key}&lat=\${center.lat}&lon=\${center.lon}&categorySet=7309&radius=2500\`</span>
).<span class="f">then</span>(r => r.<span class="f">json</span>());

<span class="c">// 2. For each charger, fetch live availability and pick a colour</span>
<span class="k">const</span> palette = {
  available: <span class="s">'</span>{{availableColor}}<span class="s">'</span>,
  occupied:  <span class="s">'</span>{{occupiedColor}}<span class="s">'</span>,
  unknown:   <span class="s">'</span>{{unknownColor}}<span class="s">'</span>,
};
chargers.<span class="f">forEach</span>(c => <span class="f">addMarker</span>({ color: palette[<span class="f">statusOf</span>(c)] }, c.position));`,
};

/** Render the full snippet HTML with `{{key}}` placeholders replaced by
    a highlighted, read-only token reflecting the current param value.
    The reserved `__style`, `__lng`, `__lat`, `__zoom` keys carry the
    live map view so the developer copies what they see — not a stale
    Amsterdam default. */
/* Named heatmap palettes mirrored from the runtime scenes so the
   snippet can show concrete hex values for whichever palette the user
   picked in Configure. Keep keys in sync with realestate.js / heatmap.js. */
const SNIPPET_PALETTES = {
  'amber-red':   { from: '#DBA43A', mid: '#E8842F', warm: '#EE6748', hot: '#EE6748', low: '#DBA43A' },
  'blue-red':    { from: '#3B82F6', mid: '#A78BFA', warm: '#F472B6', hot: '#EF4444', low: '#3B82F6' },
  'green-red':   { from: '#7AC74F', mid: '#E8D24A', warm: '#E8842F', hot: '#E94B3C', low: '#7AC74F' },
  'violet-pink': { from: '#6443A1', mid: '#9333EA', warm: '#DB2777', hot: '#F472B6', low: '#6443A1' },
  'teal-coral':  { from: '#0EA5B7', mid: '#4ECDC4', warm: '#F08A5D', hot: '#EE6748', low: '#0EA5B7' },
};

export function snippetFor(uc, view) {
  const v = view || {};
  const lineStyle = paramFor(uc, 'lineStyle') || paramFor(uc, 'strokeStyle') || paramFor(uc, 'geofenceStyle');
  const dasharray =
    lineStyle === 'dashed' ? '[2, 1.5]' :
    lineStyle === 'dotted' ? '[0.1, 1.6]' :
    'null';
  const paletteKey = paramFor(uc, 'palette');
  const pal = (paletteKey && SNIPPET_PALETTES[paletteKey]) || SNIPPET_PALETTES['amber-red'];
  const liveTokens = {
    __style:        v.style ?? 'standardDark',
    __lng:          v.center?.[0] ?? 4.9041,
    __lat:          v.center?.[1] ?? 52.3676,
    __zoom:         v.zoom ?? 11,
    __dasharray:    dasharray,
    __paletteFrom:  pal.from,
    __paletteMid:   pal.mid,
    __paletteWarm:  pal.warm,
    __paletteHot:   pal.hot,
    __paletteLow:   pal.low,
  };
  const tpl = BASE + (EXTRAS[uc.mapType] || '');
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key in liveTokens) {
      return `<span class="dd-snip-val" data-key="${key}">${esc(liveTokens[key])}</span>`;
    }
    const value = paramFor(uc, key);
    const display = value === undefined || value === null ? '' : String(value);
    return `<span class="dd-snip-val" data-key="${key}">${esc(display)}</span>`;
  });
}