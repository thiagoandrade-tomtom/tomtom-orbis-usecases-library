/* Package Tracker — the last stretch, as a recipient sees it live.

   The courier's current spot and the recipient address go through the
   TomTom Geocoding API; the path is a single Routing API call. No depot:
   only the route still ahead of the van, a few streets from the door.
   The courier moves along the returned polyline in GPS-style fixes, the
   road behind it drops off, and the ETA chip counts down with each fix. */

import { infoCard, chip } from '../../render/popup.js';
import { createPin, createMovingMarker } from '../../render/marker.js';
import { geocode, calculateRoute } from '../../map/services.js';
import { cumulative, pointAtDistance } from '../../map/geo.js';
import { paramFor } from '../../state.js';
import { ACCENT } from '../../data/use-cases.js';
import { casingFor, lineParams, HALO } from '../_shared.js';

export default async function packageScn(ctx, uc) {
  const { color: accent, width: lineWidth, dashArray } = lineParams(uc, { defaultColor: ctx.caseColor(uc) });
  const STROKE_COLOR = casingFor(accent);
  const FROM_QUERY = paramFor(uc, 'from');
  const DEST_QUERY = paramFor(uc, 'dest');

  const [fromHits, destHits] = await Promise.all([
    geocode({ query: FROM_QUERY, countrySet: 'NL', limit: 1 }),
    geocode({ query: DEST_QUERY, countrySet: 'NL', limit: 1 }),
  ]);
  if (ctx.cancelled) return;
  const from = fromHits[0];
  const dest = destHits[0];
  if (!from || !dest) return;

  /* A light tilt so the canal houses stand up around the route, and a
     margin past the panels so the pins, the chip and the route ends
     never sit on the edge of the frame. */
  const TILT = 45;
  const MARGIN = 48;
  ctx.setView({
    center: [(from.position[0] + dest.position[0]) / 2, (from.position[1] + dest.position[1]) / 2],
    zoom: 14, pitch: TILT, animate: false,
  });
  ctx.enable3DBuildings();

  /* MapLibre's fitBounds under-fits a tilted camera: the near side
     stretches past the bottom and the far side slides under the topbar.
     So the frame is solved here instead: project each point through the
     tilted camera (MapLibre's 36.87° fov puts the eye 1.5 × height from
     the centre) and take the closest zoom that keeps everything inside
     the safe area, less MARGIN. Bearing stays north-up. */
  const MAX_ZOOM = 16.5;
  const PIN_PX = 44;  // the ETA chip above the van, the house pin above the door
  const merc = ([lng, lat]) => {
    const s = Math.sin(lat * Math.PI / 180);
    return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
  };
  const unmerc = ([x, y]) => [x * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI];
  const frame = (coords, duration) => {
    const W = ctx.ml.getContainer().clientWidth;
    const H = ctx.ml.getContainer().clientHeight;
    const safe = ctx.safePadding();
    // A small map (split layout on a phone) gets the safe insets alone.
    const m = (safe.top + safe.bottom + 2 * MARGIN < H * 0.8 && safe.left + safe.right + 2 * MARGIN < W * 0.8) ? MARGIN : 0;
    // Screen positions are relative to the padded centre, where MapLibre
    // puts the camera's focal point.
    const px = (safe.left + W - safe.right) / 2, py = (safe.top + H - safe.bottom) / 2;
    const box = { l: safe.left + m - px, r: W - safe.right - m - px, t: safe.top + m - py, b: H - safe.bottom - m - py };
    const D = 1.5 * H, sin = Math.sin(TILT * Math.PI / 180), cos = Math.cos(TILT * Math.PI / 180);
    const pts = coords.map(merc);
    const last = pts.length - 1;

    // Extents on screen for a ground centre (cx, cy) at scale k.
    const extents = (cx, cy, k) => {
      let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
      for (let i = 0; i <= last; i++) {
        const X = (pts[i][0] - cx) * k, Y = (pts[i][1] - cy) * k;
        const depth = D - Y * sin;
        if (depth <= D * 0.1) return null;              // behind or at the horizon
        const sx = X * D / depth, sy = Y * cos * D / depth;
        const top = (i === 0 || i === last) ? sy - PIN_PX : sy;
        if (sx < l) l = sx; if (sx > r) r = sx;
        if (top < t) t = top; if (sy > b) b = sy;
      }
      return { l, r, t, b };
    };
    // For a scale, slide the centre until the slack is even on both axes.
    const solve = k => {
      let cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      let lo = Math.min(...pts.map(p => p[1])) - 1 / k * H, hi = Math.max(...pts.map(p => p[1])) + 1 / k * H;
      let e = null;
      for (let n = 0; n < 30; n++) {
        const cy = (lo + hi) / 2;
        e = extents(cx, cy, k);
        if (!e) lo = cy;                                  // a point behind the eye → centre south
        else if ((e.t - box.t) < (box.b - e.b)) hi = cy;  // too high on screen → centre north
        else lo = cy;
      }
      const cy = (lo + hi) / 2;
      e = extents(cx, cy, k);
      if (e) {
        let l2 = cx - W / k, r2 = cx + W / k;
        for (let n = 0; n < 30; n++) {
          cx = (l2 + r2) / 2;
          const ex = extents(cx, cy, k);
          if (!ex) break;
          if ((ex.l - box.l) < (box.r - ex.r)) r2 = cx; else l2 = cx;
        }
        e = extents(cx, cy, k);
      }
      const fits = !!e && e.l >= box.l && e.r <= box.r && e.t >= box.t && e.b <= box.b;
      return { fits, center: [cx, cy] };
    };
    let zLo = 10, zHi = MAX_ZOOM, best = solve(512 * 2 ** zLo);
    const top = solve(512 * 2 ** zHi);
    if (top.fits) { zLo = zHi; best = top; }
    else for (let n = 0; n < 16; n++) {
      const z = (zLo + zHi) / 2, r = solve(512 * 2 ** z);
      if (r.fits) { zLo = z; best = r; } else zHi = z;
    }
    const cam = { center: unmerc(best.center), zoom: zLo, pitch: TILT, bearing: 0 };
    ctx.markHome(cam);
    ctx.ml.easeTo({ ...cam, padding: safe, duration });
  };

  const { geojson, summary } = await calculateRoute({
    origin: from.position, dest: dest.position,
  });
  if (ctx.cancelled) return;

  // Frame the neighbourhood the van is crossing — the whole remaining
  // path, close enough to read the streets.
  frame(geojson.geometry.coordinates, 700);

  const line = geojson.geometry.coordinates;
  const cum = cumulative(line);
  const total = cum[cum.length - 1];

  /* Only the road ahead of the courier is drawn: each tick re-slices the
     polyline from the van to the door, so the line shrinks as it drives. */
  const aheadOf = (lngLat, distance) => {
    let i = 0;
    while (i < cum.length - 1 && cum[i] <= distance) i++;
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: [lngLat, ...line.slice(i)] } };
  };

  /* A real tracker doesn't stream the van: the GPS reports every few
     seconds and the marker glides to the new fix, then waits. */
  const PING_MS = 4000;   // time between position updates
  const GLIDE_MS = 900;   // how long the marker takes to reach the new fix
  // Real time: each fix covers what the route's average speed would in one
  // ping, so the van's pace and the ETA countdown match the clock.
  const AVG_MPS = summary.lengthInMeters / summary.travelTimeInSeconds;
  const STEP_M = AVG_MPS * PING_MS / 1000;
  const startFraction = 0.12;
  const startDist = startFraction * total;
  const startAt = pointAtDistance(line, cum, startDist).lngLat;

  ctx.addSource('parcel-path', { type: 'geojson', data: aheadOf(startAt, startDist) });
  ctx.addLayer({
    id: 'parcel-casing', type: 'line', source: 'parcel-path',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': STROKE_COLOR, 'line-width': lineWidth + HALO, 'line-opacity': 0.80 },
  });
  const parcelLinePaint = { 'line-color': accent, 'line-width': lineWidth, 'line-opacity': 0.95 };
  if (dashArray) parcelLinePaint['line-dasharray'] = dashArray;
  ctx.addLayer({
    id: 'parcel-line', type: 'line', source: 'parcel-path',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: parcelLinePaint,
  });

  const clock = secs => new Date(Date.now() + secs * 1000)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const secsLeft = distance => summary.travelTimeInSeconds * (1 - distance / total);
  const eta = clock(secsLeft(startDist));
  const window2 = clock(secsLeft(startDist) + 10 * 60);

  ctx.addMarker({
    element: createPin(accent, 'house'), anchor: 'bottom',
    popupHTML: infoCard({
      accent, eyebrow: 'Delivery Address', title: dest.address || DEST_QUERY,
      rows: [
        ['Parcel', '#NL-9921-7733'],
        ['Recipient', 'M. Visser'],
        ['Estimated arrival', eta],
        ['Window', `${eta} – ${window2}`],
        ['Signature', 'Required'],
      ],
      footer: 'Out for delivery · you’re next',
    }),
  }, dest.position);

  // Courier — moves along the real polyline, one GPS fix at a time.
  // The main green in both themes: the dark theme's lighter variant
  // would wash out the white parcel icon.
  const courierColor = ACCENT.positive.main;
  const courier = ctx.addMarker({
    element: createMovingMarker(courierColor, 'pkg', { fg: '#FFFFFF' }),
    anchor: 'center',
    popupHTML: infoCard({
      accent: courierColor, eyebrow: 'Courier · live', title: 'Van #07 · J. Hendriks',
      rows: [
        ['Route to you', `${(total / 1000).toFixed(1)} km`],
        ['Avg speed', `${Math.round(AVG_MPS * 3.6)} km/h`],
        ['Stops before you', 'None'],
      ],
      footer: 'Live tracking · snapped to route',
    }),
  }, startAt);

  // Countdown chip rides with the van; text only changes when the minute
  // or the distance readout does.
  const chipText = distance => {
    const mins = Math.max(1, Math.round(secsLeft(distance) / 60));
    const km = ((total - distance) / 1000).toFixed(1);
    return `Arriving in ${mins} min · ${km} km away`;
  };
  let lastText = chipText(startDist);
  const label = ctx.addPopup(
    { offset: 14, anchor: 'bottom', closeOnClick: false },  // a label: stays put, never pans the map
    startAt,
    chip({ accent: courierColor, text: lastText })
  );

  const source = ctx.ml.getSource('parcel-path');
  const placeAt = distance => {
    const { lngLat } = pointAtDistance(line, cum, Math.min(distance, total - 0.01));
    courier.setLngLat(lngLat);
    label.setLngLat(lngLat);
    source?.setData(aheadOf(lngLat, distance));
  };
  const ease = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  // Glide along the road (not a straight hop) from one fix to the next.
  const glide = (from, to) => {
    const t0 = performance.now();
    const step = now => {
      if (ctx.cancelled) return;
      const t = Math.min(1, (now - t0) / GLIDE_MS);
      placeAt(from + (to - from) * ease(t));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* The camera follows the road still ahead: each fix reframes van → door,
     so the route stays centred and the view tightens as the van closes in.
     A pan or zoom by hand pauses it; it picks up again after a short idle. */
  const FOLLOW_IDLE_MS = 8000;
  let heldUntil = 0;
  ctx.on('movestart', e => { if (e.originalEvent) heldUntil = Infinity; });
  ctx.on('moveend',   () => { if (heldUntil === Infinity) heldUntil = performance.now() + FOLLOW_IDLE_MS; });
  const follow = distance => {
    if (performance.now() < heldUntil) return;
    const at = pointAtDistance(line, cum, Math.min(distance, total - 0.01)).lngLat;
    frame(aheadOf(at, distance).geometry.coordinates, GLIDE_MS);
  };

  // At the door the van holds for one ping, then the demo starts over.
  let dist = startDist;
  const ping = () => {
    if (ctx.cancelled) return;
    if (dist >= total) {
      dist = startDist;
      placeAt(dist);
    } else {
      const next = Math.min(total, dist + STEP_M);
      glide(dist, next);
      dist = next;
    }
    follow(dist);
    const text = chipText(dist);
    if (text !== lastText) {
      lastText = text;
      label.setHTML(chip({ accent: courierColor, text }));
    }
    setTimeout(ping, PING_MS);
  };
  setTimeout(ping, PING_MS);
}
