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
import { cssVar, lineParams, HALO, fmtDuration } from '../_shared.js';

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

export default async function sport(ctx, uc) {
  const { color: accent, width: lineWidth, dashArray } = lineParams(uc, { defaultColor: ctx.caseColor(uc) });
  const STROKE_COLOR = cssVar('--s0', '#0C0C12');
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
  /* Fixed zoom 13 over the route centroid — fitBounds picks a zoom
     based on the bbox aspect ratio, which for a marathon loop ends up
     too zoomed out to recognise the streets. 13 reads as "neighbourhood
     scale" — street names visible, the whole loop still legible. */
  const center = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
  ctx.setView({ center, zoom: 13, bearing: 0, pitch: 0, animate: true });
  ctx.markHome({ center, zoom: 13 });

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

  ctx.addSource('track', { type: 'geojson', data: geojson });
  ctx.addLayer({
    id: 'track-casing', type: 'line', source: 'track',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': STROKE_COLOR, 'line-width': lineWidth + HALO, 'line-opacity': 0.80 },
  });
  const trackLinePaint = { 'line-color': accent, 'line-width': lineWidth };
  if (dashArray) trackLinePaint['line-dasharray'] = dashArray;
  ctx.addLayer({
    id: 'track-line', type: 'line', source: 'track',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: trackLinePaint,
  });

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
