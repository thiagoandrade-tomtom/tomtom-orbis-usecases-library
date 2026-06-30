/* Activity Tracker — replay a recorded activity, or fall back to a live
   computed demo when no file is picked.

   The "activity" param selects between:
   - `demo`        → snapped cycling path Sloterdijk → Zandvoort via Routing API
   - a bundled file under /public/activities/* (GPX, TCX, GeoJSON)

   Both code paths normalise to the same shape ({ geojson, summary, samples })
   so the rendering logic (route line, start/finish pins, per-km splits,
   summary chip) is shared. Splits read REAL telemetry from the recorded
   file when available — HR/speed are interpolated from the trackpoints
   surrounding each kilometre offset rather than synthesised. */

import { infoCard, chip } from '../../render/popup.js';
import { createPin, createDot } from '../../render/marker.js';
import { calculateMultiStopRoute } from '../../map/services.js';
import { cumulative, pointAtDistance } from '../../map/geo.js';
import { loadActivity, toRouteShape, telemetryAt } from '../../map/activities.js';
import { paramFor } from '../../state.js';
import { casingFor, lineParams, HALO, fmtDuration } from '../_shared.js';

// TCS Amsterdam Marathon — Olympic Stadium loop. Hard-coded waypoints
// so the route is deterministic (geocoders sometimes fuzzy-match
// "Olympic Stadium" to far-away venues). The path retraces the real
// October race: Stadium → Vondelpark → Centrum / Magere Brug → Amstel
// turnaround → Amstelpark → back to Stadium. Snapped to actual streets
// at runtime via the Routing API in pedestrian mode.
const DEMO_START = { name: 'Olympisch Stadion, Amsterdam', position: [4.8557, 52.3434] };
const DEMO_VIA = [
  [4.8639, 52.3578],   // Vondelpark west entrance
  [4.8920, 52.3690],   // Leidseplein / Centrum
  [4.9050, 52.3640],   // Magere Brug · Amstel river
  [4.9020, 52.3450],   // Amstelpark turnaround
];
const DEMO_FINISH = { name: 'Olympisch Stadion, Amsterdam', position: [4.8557, 52.3434] };

/* Live mode — snapped marathon loop. */
async function buildDemoTrack(ctx) {
  const points = [DEMO_START.position, ...DEMO_VIA, DEMO_FINISH.position];

  const { geojson, summary } = await calculateMultiStopRoute({
    points, travelMode: 'pedestrian', traffic: false,
  });
  if (ctx.cancelled) return null;
  return {
    geojson, summary,
    activity: null,                                  // no recorded samples
    startName: DEMO_START.name,
    finishName: DEMO_FINISH.name,
    startPosition:  DEMO_START.position,
    finishPosition: DEMO_FINISH.position,
    icon: 'flag',
    eyebrowStart: 'Marathon start',
    eyebrowFinish: 'Marathon finish',
    sourceLabel: 'TCS Amsterdam Marathon · snapped via TomTom Routing API',
  };
}

/* Recorded mode — fetch a file under /activities/, parse, normalise to
   the same shape as the live route. */
async function buildFromFile(url) {
  const activity = await loadActivity(url);
  if (activity.samples.length < 2) throw new Error('activity has no trackpoints');
  const { geojson, summary } = toRouteShape(activity);

  // Pick an icon based on the declared sport, falling back to bike.
  const sport = (activity.meta.sport || '').toLowerCase();
  const icon = sport.includes('run')   ? 'run'
             : sport.includes('hik')   ? 'flag'
             : sport.includes('walk')  ? 'run'
             : 'bike';

  const coords = geojson.geometry.coordinates;
  return {
    geojson, summary, activity,
    startName:  activity.meta.name,
    finishName: 'Finish',
    startPosition:  coords[0],
    finishPosition: coords[coords.length - 1],
    icon,
    eyebrowStart: 'Start',
    eyebrowFinish: 'Finish',
    sourceLabel: `Recorded ${activity.meta.format.toUpperCase()} · ${activity.samples.length} trackpoints`,
  };
}

/* Interpolate between two hex colours. */
function lerpHex(c1, c2, t) {
  const h = s => parseInt(s, 16);
  const r = Math.round(h(c1.slice(1, 3)) + (h(c2.slice(1, 3)) - h(c1.slice(1, 3))) * t);
  const g = Math.round(h(c1.slice(3, 5)) + (h(c2.slice(3, 5)) - h(c1.slice(3, 5))) * t);
  const b = Math.round(h(c1.slice(5, 7)) + (h(c2.slice(5, 7)) - h(c1.slice(5, 7))) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/* HSL helpers — used to derive the light end of the pace duotone from
   whatever Track colour the user picks, so the ramp stays a same-hue
   "airy tint → full colour" pair for any colour, not a hard-coded one. */
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [h, s, l];
}
function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x] : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
/* Lighter, slightly softer same-hue tint — the slow end of the duotone. */
function lighten(hex) {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s * 0.85, l + (1 - l) * 0.45);
}

/* Pace colour ramp — a two-stop duotone DERIVED from the track colour:
   a light same-hue tint for the slowest pace, the full colour for the
   fastest. Building it from the picked colour (rather than hard-coding
   the stops) is what makes the Track colour control actually repaint the
   speed-graded line, not just the pins. t is normalised speed: 0 =
   slowest, 1 = fastest. */
function rampFor(accent) {
  return [[0.0, lighten(accent)], [1.0, accent]];
}
function sampleRamp(ramp, t) {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < ramp.length; i++) {
    const [p0, c0] = ramp[i - 1], [p1, c1] = ramp[i];
    if (x <= p1) return lerpHex(c0, c1, (x - p0) / (p1 - p0));
  }
  return ramp[ramp.length - 1][1];
}

/* Add a chevron icon (once) and a symbol layer that places it along the
   'track' source. symbol-placement: 'line' rotates each glyph to the
   line's forward direction (coordinate order = start → finish), so the
   arrows read as travel direction. White fill + dark outline so they sit
   on any pace colour and either theme. */
function addDirectionArrows(ctx) {
  if (!ctx.ml.hasImage('pace-arrow')) {
    const s = 24, c = document.createElement('canvas');
    c.width = s; c.height = s;
    const g = c.getContext('2d');
    g.beginPath();
    g.moveTo(7, 5); g.lineTo(18, 12); g.lineTo(7, 19);
    g.lineWidth = 4; g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = 2.2; g.stroke();
    ctx.ml.addImage('pace-arrow', g.getImageData(0, 0, s, s), { pixelRatio: 2 });
  }
  ctx.addLayer({
    id: 'track-arrows', type: 'symbol', source: 'track',
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 80,
      'icon-image': 'pace-arrow',
      'icon-size': 0.85,
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
}

/* Build a MapLibre line-progress interpolate expression from activity
   timestamps, colouring by speed via the pace ramp. Samples every ~150
   points to keep the expression compact. Returns null without timestamps. */
const PACE_WINDOW_S = 90;   // smoothing window — pace trend, not GPS jitter
function buildPaceExpression(activity, ramp) {
  const s = activity.samples;
  if (!s.some(p => p.time)) return null;

  const R = 6371000;
  const rad = d => (d * Math.PI) / 180;

  // Cumulative distance + elapsed time per point.
  const t0 = s.find(p => p.time)?.time;
  if (!t0) return null;
  let acc = 0;
  const pts = [{ dist: 0, t: 0 }];
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    acc += 2 * R * Math.asin(Math.sqrt(h));
    pts.push({ dist: acc, t: b.time ? (b.time - t0) / 1000 : pts[i - 1].t });
  }
  const total = acc;
  if (total === 0) return null;

  // Speed at each point = distance covered over a ±PACE_WINDOW_S/2 time
  // window centred on it. Smooths out per-second GPS noise so the colour
  // reflects real pace trends (climbs, surges, rests) not jitter.
  const half = PACE_WINDOW_S / 2;
  let lo2 = 0, hi2 = 0;   // window edge pointers (monotone)
  for (let i = 0; i < pts.length; i++) {
    const tc = pts[i].t;
    while (lo2 < i && pts[lo2].t < tc - half) lo2++;
    while (hi2 < pts.length - 1 && pts[hi2].t < tc + half) hi2++;
    const dt = pts[hi2].t - pts[lo2].t;
    const dd = pts[hi2].dist - pts[lo2].dist;
    pts[i].speed = dt > 0 ? (dd / 1000) / (dt / 3600) : 0;
  }

  const sorted = pts.map(p => p.speed).filter(v => v > 0).sort((a, b) => a - b);
  if (sorted.length < 2) return null;

  /* Linear normalisation between the 10th and 90th percentile. Rank-based
     mapping over-amplified the mid-band jitter (steady pace → adjacent
     points swung between light and dark, a salt-and-pepper mush). Heavy
     smoothing above + linear mapping here gives a clean low-frequency
     gradient: the typical pace band spreads across the full shade range,
     outliers clip to the ends. */
  const lo = sorted[Math.floor(sorted.length * 0.10)];
  const hi = sorted[Math.floor(sorted.length * 0.90)];
  const range = hi - lo;

  // Downsample to ≤150 stops, enforcing strictly-ascending progress —
  // MapLibre rejects an interpolate expression with duplicate inputs.
  const step = Math.max(1, Math.floor(pts.length / 150));
  const stops = [];
  let lastProgress = -1;
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    if (p.speed == null) continue;
    let progress = Math.max(0, Math.min(1, p.dist / total));
    if (progress <= lastProgress) progress = lastProgress + 1e-6;
    if (progress > 1) break;
    const t = range > 0 ? Math.max(0, Math.min(1, (p.speed - lo) / range)) : 0.5;
    stops.push(progress, sampleRamp(ramp, t));
    lastProgress = progress;
  }
  if (stops.length < 4) return null;
  // Guarantee endpoints at 0 and 1.
  if (stops[0] > 0) stops.unshift(0, stops[1]);
  if (stops[stops.length - 2] < 1) stops.push(1, stops[stops.length - 1]);

  return ['interpolate', ['linear'], ['line-progress'], ...stops];
}

export default async function sport(ctx, uc) {
  const { color: accent, width: lineWidth, dashArray } = lineParams(uc, { defaultColor: ctx.caseColor(uc) });
  const STROKE_COLOR = casingFor(accent);
  const choice  = paramFor(uc, 'activity') || 'demo';

  /* No placeholder setView: the route fitBounds below is the only
     framing we want recorded as "home" so the recenter button always
     returns to the full track. The map keeps the previous scene's
     camera until the route resolves — a soft transition rather than a
     country-scale flash. */

  let track;
  try {
    track = choice === 'demo'
      ? await buildDemoTrack(ctx)
      : await buildFromFile(`${import.meta.env.BASE_URL}activities/${choice}`);
  } catch (err) {
    console.warn('[sport] activity load failed:', err.message);
    return;
  }
  if (ctx.cancelled || !track) return;

  const { geojson, summary, activity, startName, finishName, icon,
          startPosition, finishPosition,
          eyebrowStart, eyebrowFinish, sourceLabel } = track;
  const line = geojson.geometry.coordinates;

  // Fit the camera to the actual track bounds — recorded activities can be
  // anywhere, and the demo route spans ~22 km.
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of line) {
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  }
  ctx.fitBounds([[minLng, minLat], [maxLng, maxLat]]);
  ctx.markHomeBounds([[minLng, minLat], [maxLng, maxLat]]);

  // Hillshade terrain underlay — gives the mono basemap a sense of
  // elevation so trails through dunes / hills read as more than flat lines.
  // AWS terrarium-encoded DEM tiles are CORS-enabled and globally cached.
  ctx.addSource('dem', {
    type: 'raster-dem',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    tileSize: 256,
    encoding: 'terrarium',
    maxzoom: 15,
  });
  const darkTheme = document.documentElement.getAttribute('data-theme') === 'dark';
  ctx.addLayer({
    id: 'hillshade', type: 'hillshade', source: 'dem',
    paint: {
      'hillshade-exaggeration': 0.55,
      'hillshade-shadow-color':    darkTheme ? '#000000' : '#3a3f4a',
      'hillshade-highlight-color': darkTheme ? '#2a3340' : '#ffffff',
      'hillshade-accent-color':    darkTheme ? '#0a0d12' : '#c8ccd2',
    },
  });

  const ramp = rampFor(accent);
  const paceExpr = activity ? buildPaceExpression(activity, ramp) : null;

  // lineMetrics: true is required for line-progress expressions.
  ctx.addSource('track', { type: 'geojson', data: geojson, lineMetrics: !!paceExpr });
  ctx.addLayer({
    id: 'track-casing', type: 'line', source: 'track',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': STROKE_COLOR, 'line-width': lineWidth + HALO, 'line-opacity': 0.80 },
  });

  if (paceExpr) {
    // `line-progress` is only valid inside the `line-gradient` paint
    // property (not `line-color`), and requires lineMetrics on the source.
    ctx.addLayer({
      id: 'pace-line', type: 'line', source: 'track',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-gradient': paceExpr, 'line-width': lineWidth },
    });
    // Direction arrows — a pace gradient shows speed but not which way the
    // run went, and this marathon starts/finishes at the same stadium so
    // the two pins overlap. Chevrons along the line (symbol-placement:
    // 'line') orient to the coordinate order, i.e. start → finish.
    addDirectionArrows(ctx);

    // Legend so the colour coding reads at a glance — the full pace ramp,
    // labelled by what it means.
    const rampCss = ramp.map(([p, c]) => `${c} ${Math.round(p * 100)}%`).join(', ');
    ctx.setLegend({
      title: 'Pace',
      items: [{
        html: `<span class="map-legend-swatch bar" style="background:linear-gradient(90deg, ${rampCss});color:transparent;"></span>`,
        label: 'Slower → Faster',
      }],
    });
  } else {
    const trackLinePaint = { 'line-color': accent, 'line-width': lineWidth };
    if (dashArray) trackLinePaint['line-dasharray'] = dashArray;
    ctx.addLayer({
      id: 'track-line', type: 'line', source: 'track',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: trackLinePaint,
    });
  }

  const totalKm  = summary.lengthInMeters / 1000;
  const totalMin = summary.travelTimeInSeconds / 60;
  const avgSpeed = totalMin > 0 ? totalKm / (totalMin / 60) : 0;

  // Real start telemetry if available, else synthetic placeholder.
  const startHR = activity?.samples?.[0]?.hr;
  const startTime = activity?.samples?.find(s => s.time)?.time;
  const fmtTime = t => t ? t.toISOString().slice(11, 16) : '09:15';

  ctx.addMarker({
    element: createPin(accent, icon), anchor: 'bottom',
    popupHTML: infoCard({
      accent, eyebrow: eyebrowStart, title: startName,
      rows: [
        ['Time', fmtTime(startTime)],
        ['HR (start)', startHR != null ? `${startHR} bpm` : '92 bpm'],
      ],
    }),
  }, startPosition || line[0]);

  // Finish summary — only show speed / HR rows that actually make sense
  // (recorded GeoJSON has no time, so we skip duration/speed there).
  const finishRows = [['Distance', `${totalKm.toFixed(1)} km`]];
  if (totalMin > 0) {
    finishRows.push(['Duration', fmtDuration(totalMin)]);
    finishRows.push(['Avg speed', `${avgSpeed.toFixed(1)} km/h`]);
  }
  if (activity?.samples?.some(s => s.hr != null)) {
    const hrs = activity.samples.map(s => s.hr).filter(Boolean);
    const avgHR = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
    finishRows.push(['Avg HR', `${avgHR} bpm`]);
  } else if (!activity) {
    finishRows.push(['Avg HR', '138 bpm']);   // demo placeholder
  }
  finishRows.push(['Calories', `${Math.round(totalKm * 40)} kcal`]);

  ctx.addMarker({
    element: createPin(accent, 'flag'), anchor: 'bottom',
    popupHTML: infoCard({
      accent, eyebrow: eyebrowFinish, title: finishName,
      rows: finishRows, footer: sourceLabel,
    }),
  }, finishPosition || line[line.length - 1]);

  // Per-km splits at exact distance offsets along the polyline. Long
  // tracks get a wider step (every 5 km) so the map stays readable.
  const cum = cumulative(line);
  const wholeKm = Math.floor(totalKm);
  const splitStep = wholeKm > 12 ? 5 : 1;

  for (let k = splitStep; k <= wholeKm; k += splitStep) {
    const { lngLat } = pointAtDistance(line, cum, k * 1000);
    const rows = [];

    if (activity) {
      // Real telemetry interpolated from the file's nearest trackpoints.
      const t = telemetryAt(activity, k * 1000);
      const tPrev = telemetryAt(activity, (k - splitStep) * 1000);
      // Pace over this split — the value the line colour encodes. Leads the
      // row list so the click reads as "this colour = this speed".
      if (t.time && tPrev.time) {
        const dtH = (t.time - tPrev.time) / 3600000;
        if (dtH > 0) rows.push(['Pace', `${(splitStep / dtH).toFixed(1)} km/h`]);
      }
      if (t.hr  != null) rows.push(['HR', `${Math.round(t.hr)} bpm`]);
      if (t.ele != null) rows.push(['Elevation', `${Math.round(t.ele)} m`]);
      if (t.time)        rows.push(['Time', fmtTime(t.time)]);
    } else {
      // Demo mode — synthetic but plausible variation per km.
      const hr = 130 + ((k * 7) % 18);
      const splitSpeed = avgSpeed + ((k * 13) % 8) - 4;
      rows.push(['Speed', `${splitSpeed.toFixed(1)} km/h`]);
      rows.push(['HR', `${hr} bpm`]);
    }

    ctx.addMarker({
      element: createDot(accent, 14),
      popupHTML: infoCard({
        accent, eyebrow: `Km ${k}`, title: 'Split', rows,
      }),
    }, lngLat);
  }

  // Summary chip at midpoint — duration/speed only when meaningful.
  const { lngLat: mid } = pointAtDistance(line, cum, cum[cum.length - 1] / 2);
  const chipText = totalMin > 0
    ? `${totalKm.toFixed(1)} km · ${fmtDuration(totalMin)} · ${avgSpeed.toFixed(1)} km/h`
    : `${totalKm.toFixed(1)} km`;
  ctx.addPopup(
    { offset: 14, anchor: 'bottom' },
    mid,
    chip({ accent, text: chipText })
  );
}
