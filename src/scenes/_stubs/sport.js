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
import { OVERLAY_ROUTE_CASING_WIDTH, OVERLAY_ROUTE_LINE_WIDTH } from '../../map/config.js';
import { cumulative, pointAtDistance } from '../../map/geo.js';
import { loadActivity, toRouteShape, telemetryAt } from '../../map/activities.js';
import { paramFor } from '../../state.js';

// Hard-coded so the demo is deterministic — geocoding "Zandvoort aan Zee"
// has been known to fuzzy-match unrelated southern hits.
const DEMO_START  = { name: 'Sloterdijk, Amsterdam', position: [4.8366, 52.3886] };
const DEMO_FINISH = { name: 'Zandvoort aan Zee',     position: [4.5326, 52.3712] };

/* Live mode — pull a snapped cycling route between the two fixed waypoints. */
async function buildDemoTrack(ctx) {
  const points = [DEMO_START.position, DEMO_FINISH.position];

  const { geojson, summary } = await calculateMultiStopRoute({
    points, travelMode: 'bicycle', traffic: false,
  });
  if (ctx.cancelled) return null;
  return {
    geojson, summary,
    activity: null,                                  // no recorded samples
    startName: DEMO_START.name,
    finishName: DEMO_FINISH.name,
    startPosition:  DEMO_START.position,
    finishPosition: DEMO_FINISH.position,
    icon: 'bike',
    eyebrowStart: 'Start',
    eyebrowFinish: 'Finish · Beach',
    sourceLabel: 'Snapped cycling path · TomTom Routing API',
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
  const accent  = ctx.caseColor(uc);
  const choice  = paramFor(uc, 'activity') || 'demo';

  // Anchor the camera over the Netherlands while async work resolves.
  ctx.setView({ center: [4.68, 52.38], zoom: 9.5, animate: true });

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
  ctx.fitBounds([[minLng, minLat], [maxLng, maxLat]], { duration: 700 });

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
    paint: { 'line-color': accent, 'line-width': OVERLAY_ROUTE_CASING_WIDTH, 'line-opacity': 0.18 },
  });
  ctx.addLayer({
    id: 'track-line', type: 'line', source: 'track',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': accent, 'line-width': OVERLAY_ROUTE_LINE_WIDTH },
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
    finishRows.push(['Duration', `${Math.round(totalMin)} min`]);
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
    ? `${totalKm.toFixed(1)} km · ${Math.round(totalMin)} min · ${avgSpeed.toFixed(1)} km/h`
    : `${totalKm.toFixed(1)} km`;
  ctx.addPopup(
    { offset: 14, anchor: 'bottom' },
    mid,
    chip({ accent, text: chipText })
  );
}
