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
  style: <span class="s">'standardDark'</span>,
  mapLibre: {
    container: <span class="s">'map'</span>,
    center: [<span class="n">4.9041</span>, <span class="n">52.3676</span>],
    zoom: <span class="n">11</span>
  }
});`;

/* Per-mapType extension templates. `{{key}}` placeholders correspond to
   the param keys declared in data/use-cases.js → params[]. */
const EXTRAS = {
  heatmap: `\n\n<span class="c">// Add heatmap layer via MapLibre</span>
map.mapLibreMap.<span class="f">addLayer</span>({
  id: <span class="s">'incidents'</span>,
  type: <span class="s">'heatmap'</span>,
  source: <span class="s">'traffic'</span>,
  paint: { <span class="s">'heatmap-radius'</span>: <span class="n">28</span> }
});`,

  poi: `\n\n<span class="c">// Anchor + nearby POIs via Search API</span>
<span class="k">const</span> center = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{anchor}}<span class="s">'</span>);
<span class="k">const</span> { results } = <span class="k">await</span> <span class="f">fetch</span>(
  <span class="s">\`https://api.tomtom.com/search/2/poiSearch/cafe.json?key=\${key}&lat=\${center.lat}&lon=\${center.lon}\`</span>
).<span class="f">then</span>(r => r.<span class="f">json</span>());`,

  route: `\n\n<span class="c">// Calculate A→B using Routing API</span>
<span class="k">const</span> from = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{from}}<span class="s">'</span>);
<span class="k">const</span> to   = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{to}}<span class="s">'</span>);
<span class="k">const</span> r = <span class="k">await</span> <span class="f">fetch</span>(
  <span class="s">\`https://api.tomtom.com/routing/1/calculateRoute/\${from}:\${to}/json\`</span> +
  <span class="s">\`?key=\${key}&travelMode=</span>{{travelMode}}<span class="s">&traffic=</span>{{traffic}}<span class="s">\`</span>
);`,

  multistop: `\n\n<span class="c">// Long-distance EV trip with auto-inserted charging stops</span>
<span class="k">const</span> from = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{from}}<span class="s">'</span>);
<span class="k">const</span> to   = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{to}}<span class="s">'</span>);
<span class="k">const</span> r = <span class="k">await</span> <span class="f">fetch</span>(
  <span class="s">\`https://api.tomtom.com/routing/1/calculateLongDistanceEVRoute/\${from}:\${to}/json\`</span> +
  <span class="s">\`?key=\${key}&vehicleEngineType=electric&currentChargeInkWh=35&maxChargeInkWh=75\`</span>
);
<span class="k">const</span> { routes } = <span class="k">await</span> r.<span class="f">json</span>();
<span class="c">// routes[0].legs[].summary.chargingInformationAtEndOfLeg → charge plan</span>`,

  fleet: `\n\n<span class="c">// Live telemetry stream</span>
<span class="k">const</span> ws = <span class="k">new</span> <span class="f">WebSocket</span>(<span class="s">'wss://fleet/stream'</span>);
ws.onmessage = (e) => <span class="f">updateMarker</span>(map, <span class="f">JSON.parse</span>(e.data));`,

  package: `\n\n<span class="c">// Hub → recipient route + live ETA</span>
<span class="k">const</span> hub  = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{hub}}<span class="s">'</span>);
<span class="k">const</span> dest = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{dest}}<span class="s">'</span>);
<span class="k">const</span> eta = <span class="k">await</span> <span class="f">fetch</span>(
  <span class="s">\`https://api.tomtom.com/routing/1/calculateRoute/\${hub}:\${dest}/json?key=\${key}&traffic=true\`</span>
);`,

  delivery: `\n\n<span class="c">// Batch optimize day's stops</span>
<span class="k">const</span> r = <span class="k">await</span> <span class="f">fetch</span>(
  <span class="s">\`https://api.tomtom.com/routing/3/batch/sync/json?key=\${key}\`</span>,
  { method: <span class="s">'POST'</span>, body: <span class="f">JSON.stringify</span>({ batchItems }) }
);`,

  city: `\n\n<span class="c">// Add 3D building extrusions via MapLibre</span>
map.mapLibreMap.<span class="f">addLayer</span>({
  id: <span class="s">'bldgs-3d'</span>,
  type: <span class="s">'fill-extrusion'</span>,
  source: <span class="s">'buildings'</span>,
  paint: { <span class="s">'fill-extrusion-height'</span>: [<span class="s">'get'</span>, <span class="s">'h'</span>] }
});`,

  realestate: `\n\n<span class="c">// Neighborhood overlays + listings</span>
listings.<span class="f">forEach</span>(l => <span class="f">addPricePin</span>(map, l));
map.mapLibreMap.<span class="f">addSource</span>(<span class="s">'walk'</span>, { type: <span class="s">'geojson'</span>, data: walkScores });`,

  sport: `\n\n<span class="c">// Render activity track from GeoJSON</span>
map.mapLibreMap.<span class="f">addSource</span>(<span class="s">'track'</span>, { type: <span class="s">'geojson'</span>, data: gpxGeoJSON });
map.mapLibreMap.<span class="f">addLayer</span>({ id: <span class="s">'track'</span>, type: <span class="s">'line'</span>, source: <span class="s">'track'</span> });`,

  sharing: `\n\n<span class="c">// Stage vehicles around a real anchor</span>
<span class="k">const</span> center = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{anchor}}<span class="s">'</span>);
<span class="k">const</span> v = <span class="k">await</span> <span class="f">Promise.all</span>([lime.<span class="f">nearby</span>(center), bolt.<span class="f">nearby</span>(center)]);
v.flat().<span class="f">forEach</span>(x => <span class="f">addVehicleMarker</span>(map, x));`,

  ev: `\n\n<span class="c">// EV chargers + live availability around an anchor</span>
<span class="k">const</span> center = <span class="k">await</span> <span class="f">geocode</span>(<span class="s">'</span>{{anchor}}<span class="s">'</span>);
<span class="k">const</span> chargers = <span class="k">await</span> <span class="f">fetch</span>(
  <span class="s">\`https://api.tomtom.com/search/2/nearbySearch/.json?key=\${key}&lat=\${center.lat}&lon=\${center.lon}&categorySet=7309\`</span>
).<span class="f">then</span>(r => r.<span class="f">json</span>());`,
};

/** Render the full snippet HTML with `{{key}}` placeholders replaced by
    a highlighted, read-only token reflecting the current param value. */
export function snippetFor(uc) {
  const tpl = BASE + (EXTRAS[uc.mapType] || '');
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = paramFor(uc, key);
    const display = value === undefined || value === null ? '' : String(value);
    return `<span class="dd-snip-val" data-key="${key}">${esc(display)}</span>`;
  });
}