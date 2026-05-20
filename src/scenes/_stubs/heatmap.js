/* Data Visualization — real traffic-incident density.

   Points come from the TomTom Traffic Incident Details API for a bounding
   box around central Amsterdam. Each incident contributes one heatmap
   point weighted by magnitudeOfDelay AND renders as a clickable circle
   on top, so a user can read both the overall pattern and the individual
   events behind it.

   Hotspots are computed from the live data — the three densest 500 m
   cells in view — not hand-picked landmarks. Each gets a numbered pin
   showing its rank, real incident count, dominant cause, and the street
   name resolved by reverse geocoding. */

import { infoCard } from '../../render/popup.js';
import { createNumberPin } from '../../render/marker.js';
import { trafficIncidents, reverseGeocode } from '../../map/services.js';

const BBOX = '4.830,52.330,4.965,52.405';   // central Amsterdam

// iconCategory enum from the Traffic Incidents API.
const CAUSE = {
  0: 'Unknown',     1: 'Accident',         2: 'Fog',          3: 'Dangerous conditions',
  4: 'Rain',        5: 'Ice',              6: 'Jam',          7: 'Lane closed',
  8: 'Road closed', 9: 'Road works',      10: 'Wind',        11: 'Flooding',
  14: 'Broken-down vehicle',
};
// magnitudeOfDelay: 0 unknown · 1 minor · 2 moderate · 3 major · 4 undefined-major
const MAG_LABEL = { 0: 'Unknown', 1: 'Minor', 2: 'Moderate', 3: 'Major', 4: 'Severe' };

// Grid cell size for hotspot detection (~500 m at Amsterdam latitude).
const CELL_DEG_LON = 0.007;   // ≈ 475 m
const CELL_DEG_LAT = 0.0045;  // ≈ 500 m
const TOP_N        = 3;

function cellKey(lon, lat) {
  return `${Math.floor(lon / CELL_DEG_LON)}_${Math.floor(lat / CELL_DEG_LAT)}`;
}

export default async function heatmap(ctx, uc) {
  const accent = ctx.caseColor(uc);
  const hotEnd = ctx.color('negative');   // peak density = problem
  ctx.setView({ center: [4.8975, 52.3700], zoom: 11.5, animate: true });

  const incidents = await trafficIncidents({ bbox: BBOX });
  if (ctx.cancelled) return;

  // Flatten each incident to a single representative Point. LineString /
  // MultiLineString incidents take their first vertex.
  const features = incidents.flatMap((inc, idx) => {
    const g = inc.geometry;
    const props = inc.properties || {};
    const coord = g?.type === 'Point'
      ? g.coordinates
      : g?.type === 'LineString'
        ? g.coordinates[0]
        : g?.type === 'MultiLineString'
          ? g.coordinates[0]?.[0]
          : null;
    if (!coord) return [];
    const mag    = props.magnitudeOfDelay ?? 0;
    const weight = Math.max(0.2, mag / 4);
    const event  = props.events?.[0];
    return [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coord },
      properties: {
        id: idx,
        weight,
        magnitude: mag,
        magLabel: MAG_LABEL[mag] || 'Unknown',
        cause: CAUSE[props.iconCategory ?? 0] || 'Incident',
        description: event?.description || '',
        delaySec: props.delay ?? 0,
        lengthM: props.length ?? 0,
      },
    }];
  });

  // ---- Heatmap layer (density pattern) ----------------------------------
  ctx.addSource('heat-pts', { type: 'geojson', data: { type: 'FeatureCollection', features } });
  ctx.addLayer({
    id: 'heat', type: 'heatmap', source: 'heat-pts',
    paint: {
      'heatmap-weight': ['get', 'weight'],
      'heatmap-radius': 32,
      'heatmap-intensity': 1,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(0,0,0,0)',
        0.4, accent,
        0.8, hotEnd,
      ],
      'heatmap-opacity': 0.7,
    },
  });

  // ---- Individual incidents (clickable circles) -------------------------
  // Slightly larger hit halo (invisible) + visible dot — pure circle layers
  // can be hard to hit if rendered at 4 px. The halo doubles the touch area
  // without bloating the visual size.
  ctx.addLayer({
    id: 'incident-hit', type: 'circle', source: 'heat-pts',
    paint: {
      'circle-radius': 14,
      'circle-color': '#000', 'circle-opacity': 0.001,   // invisible but interactive
    },
  });
  ctx.addLayer({
    id: 'incident-dots', type: 'circle', source: 'heat-pts',
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['get', 'magnitude'],
        0, 4, 2, 5, 4, 7,
      ],
      'circle-color': [
        'interpolate', ['linear'], ['get', 'magnitude'],
        0, accent, 2, accent, 4, hotEnd,
      ],
      'circle-opacity': 0.95,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': 'rgba(255,255,255,0.9)',
    },
  });

  const openIncident = (f) => {
    if (!f) return;
    const p = f.properties || {};
    const delaySec = Number(p.delaySec) || 0;
    const lengthM  = Number(p.lengthM)  || 0;
    const delayMin = delaySec > 0 ? `${Math.round(delaySec / 60)} min` : '—';
    const lenStr   = lengthM > 0
      ? (lengthM >= 1000 ? `${(lengthM / 1000).toFixed(1)} km` : `${Math.round(lengthM)} m`)
      : '—';
    new maplibregl.Popup({ closeButton: true, offset: 8 })
      .setLngLat(f.geometry.coordinates)
      .setHTML(infoCard({
        accent: Number(p.magnitude) >= 3 ? hotEnd : accent,
        eyebrow: p.cause || 'Incident',
        title: p.description || p.cause || 'Traffic incident',
        rows: [
          ['Severity', p.magLabel],
          ['Delay',    delayMin],
          ['Length',   lenStr],
        ],
        footer: 'Live · TomTom Traffic Incidents API',
      }))
      .addTo(ctx.ml);
  };

  ctx.on('mouseenter', 'incident-hit', () => { ctx.ml.getCanvas().style.cursor = 'pointer'; });
  ctx.on('mouseleave', 'incident-hit', () => { ctx.ml.getCanvas().style.cursor = ''; });

  // Single map-level click that queries both incident layers — this is more
  // forgiving than layer-scoped click bindings, which can silently miss
  // events when an overlay layer eats the hit test.
  ctx.on('click', (e) => {
    const hits = ctx.ml.queryRenderedFeatures(e.point, {
      layers: ['incident-hit', 'incident-dots'],
    });
    if (hits.length) openIncident(hits[0]);
  });

  // ---- Hotspots: top-N densest cells from the live data ------------------
  // Bucket every incident into a coarse grid cell, weight by magnitude.
  const cells = new Map();
  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates;
    const k = cellKey(lon, lat);
    const c = cells.get(k) || { count: 0, weight: 0, lonSum: 0, latSum: 0, causes: {} };
    const w = Math.max(1, f.properties.magnitude);
    c.count  += 1;
    c.weight += w;
    c.lonSum += lon * w;
    c.latSum += lat * w;
    c.causes[f.properties.cause] = (c.causes[f.properties.cause] || 0) + 1;
    cells.set(k, c);
  }

  const topCells = [...cells.values()]
    .filter(c => c.count >= 2)                            // ignore singletons
    .sort((a, b) => b.weight - a.weight || b.count - a.count)
    .slice(0, TOP_N)
    .map(c => ({
      position: [c.lonSum / c.weight, c.latSum / c.weight],
      count:    c.count,
      cause:    Object.entries(c.causes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Mixed',
    }));

  // Resolve a real street name for each hotspot in parallel.
  const addresses = await Promise.all(
    topCells.map(c => reverseGeocode({ point: c.position }).catch(() => null))
  );
  if (ctx.cancelled) return;

  topCells.forEach((c, i) => {
    const addr = addresses[i];
    const label = addr?.streetName
      || addr?.municipalitySubdivision
      || addr?.address
      || 'Hotspot';
    const pinEl = createNumberPin(hotEnd, i + 1);
    const html  = infoCard({
      accent: hotEnd,
      eyebrow: `Hotspot #${i + 1}`,
      title: label,
      rows: [
        ['Incidents here', String(c.count)],
        ['Top cause',      c.cause],
        ['Area',           addr?.municipalitySubdivision || addr?.municipality || '—'],
      ],
      footer: 'Computed live from incident density',
    });
    const marker = ctx.addMarker({ element: pinEl, anchor: 'bottom' }, c.position);
    // Bind click directly to the pin element — bypasses the marker's internal
    // popup toggle which can miss synthesized / Playwright clicks.
    pinEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      new maplibregl.Popup({ closeButton: true, offset: 18 })
        .setLngLat(c.position)
        .setHTML(html)
        .addTo(ctx.ml);
    });
  });

  // ---- Legend (shared bottom-of-map element) ----------------------------
  ctx.setLegend({
    title: 'Incident density',
    items: [
      { gradient: [accent, hotEnd], label: 'Low → High' },
      { color: accent, shape: 'dot', label: '1 incident · click' },
      { color: hotEnd, shape: 'dot', label: `Top ${TOP_N} clusters` },
      { color: 'transparent', shape: 'dot', label: `${features.length} live` },
    ],
  });
}
