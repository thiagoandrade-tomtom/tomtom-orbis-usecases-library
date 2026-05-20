/* Geometry helpers for scenes that need to walk markers along a snapped
   polyline (fleet vehicles, parcel couriers, delivery driver).

   Everything assumes [lng, lat] order (GeoJSON convention). */

const R_EARTH = 6371000;
const toRad = d => d * Math.PI / 180;

export function haversine(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]), lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

export function bearing(a, b) {
  const φ1 = toRad(a[1]), φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function cumulative(line) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversine(line[i - 1], line[i]));
  return cum;
}

/** Position + bearing at a given distance along a LineString. */
export function pointAtDistance(line, cum, dist) {
  const total = cum[cum.length - 1];
  const d = ((dist % total) + total) % total;          // wrap negative / overflow
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const segLen = cum[hi] - cum[lo] || 1;
  const t = (d - cum[lo]) / segLen;
  const a = line[lo], b = line[hi];
  return {
    lngLat: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    bearing: bearing(a, b),
  };
}

/** RAF loop that advances `meters` per second along `line`, calling
    onTick({ lngLat, bearing, distance }). Stops when ctx.cancelled. */
export function animateAlong({ ctx, line, speedMps = 15, startFraction = 0, loop = true, onTick }) {
  const cum = cumulative(line);
  const total = cum[cum.length - 1];
  let last = performance.now();
  let dist = startFraction * total;

  function tick(now) {
    if (ctx.cancelled) return;
    const dt = (now - last) / 1000;
    last = now;
    dist += speedMps * dt;
    if (!loop && dist >= total) {
      onTick(pointAtDistance(line, cum, total));
      return;
    }
    onTick(pointAtDistance(line, cum, dist));
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
