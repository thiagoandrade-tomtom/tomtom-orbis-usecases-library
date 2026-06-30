/* Activity-file parsers for the Activity Tracker scene.

   GPX, TCX, and GeoJSON all yield the same in-memory shape so the scene
   doesn't need to branch on format:

     { meta: { name, sport, format },
       samples: [{ lng, lat, time?, hr?, ele? }, ...] }

   `time` is a Date instance if the file had timestamps (GPX <time>, TCX
   <Time>), undefined otherwise. `hr`/`ele` are present per-sample when
   the source file carried them in <extensions> / <HeartRateBpm> / <ele>. */

const DOM = typeof DOMParser !== 'undefined' ? new DOMParser() : null;

function asDate(s) { const d = new Date(s); return isNaN(d) ? undefined : d; }
function asNum(s)  { const n = parseFloat(s); return isNaN(n) ? undefined : n; }

/* Walk an XML element and return the first <tag> descendant (any namespace). */
function findFirst(el, tag) {
  return el?.getElementsByTagName(tag)?.[0];
}

export function parseGPX(xmlText) {
  const doc = DOM.parseFromString(xmlText, 'application/xml');
  const trk = findFirst(doc, 'trk');
  const name = findFirst(trk, 'name')?.textContent?.trim() || 'GPX activity';
  const sport = findFirst(trk, 'type')?.textContent?.trim();

  const pts = Array.from(doc.getElementsByTagName('trkpt'));
  const samples = pts.map(p => {
    const lat  = asNum(p.getAttribute('lat'));
    const lng  = asNum(p.getAttribute('lon'));
    const time = asDate(findFirst(p, 'time')?.textContent);
    const ele  = asNum(findFirst(p, 'ele')?.textContent);
    // Garmin/Strava embed HR in <extensions><ns:TrackPointExtension><ns:hr>
    const hr   = asNum(p.getElementsByTagName('hr')?.[0]?.textContent ||
                       p.getElementsByTagName('gpxtpx:hr')?.[0]?.textContent);
    return { lng, lat, time, ele, hr };
  }).filter(s => Number.isFinite(s.lng) && Number.isFinite(s.lat));

  return { meta: { name, sport, format: 'gpx' }, samples };
}

export function parseTCX(xmlText) {
  const doc = DOM.parseFromString(xmlText, 'application/xml');
  const activity = findFirst(doc, 'Activity');
  const sport = activity?.getAttribute('Sport') || undefined;
  const name = findFirst(doc, 'Notes')?.textContent?.trim() || 'TCX activity';

  const pts = Array.from(doc.getElementsByTagName('Trackpoint'));
  const samples = pts.map(p => {
    const pos = findFirst(p, 'Position');
    const lat = asNum(findFirst(pos, 'LatitudeDegrees')?.textContent);
    const lng = asNum(findFirst(pos, 'LongitudeDegrees')?.textContent);
    const time = asDate(findFirst(p, 'Time')?.textContent);
    const ele  = asNum(findFirst(p, 'AltitudeMeters')?.textContent);
    const hr   = asNum(findFirst(findFirst(p, 'HeartRateBpm'), 'Value')?.textContent);
    return { lng, lat, time, ele, hr };
  }).filter(s => Number.isFinite(s.lng) && Number.isFinite(s.lat));

  return { meta: { name, sport, format: 'tcx' }, samples };
}

export function parseGeoJSON(jsonText) {
  const j = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
  const feat = j.type === 'FeatureCollection' ? j.features[0] : j;
  const props = feat?.properties || {};
  const geom  = feat?.geometry || j.geometry || j;

  // Accept LineString or MultiLineString.
  const coords = geom?.type === 'MultiLineString'
    ? geom.coordinates.flat()
    : (geom?.coordinates || []);

  const samples = coords.map(c => ({
    lng: c[0], lat: c[1], ele: c[2],
    // Optional coordTimes parallel array (Mapbox convention).
    time: undefined, hr: undefined,
  })).filter(s => Number.isFinite(s.lng) && Number.isFinite(s.lat));

  return {
    meta: { name: props.name || 'GeoJSON activity', sport: props.sport, format: 'geojson' },
    samples,
  };
}

/* Auto-pick parser by file extension. Returns the normalized object above. */
export async function loadActivity(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`activity fetch failed: ${res.status}`);
  const text = await res.text();
  if (/\.gpx($|\?)/i.test(url))      return parseGPX(text);
  if (/\.tcx($|\?)/i.test(url))      return parseTCX(text);
  if (/\.geojson($|\?)/i.test(url) ||
      /\.json($|\?)/i.test(url))     return parseGeoJSON(text);
  throw new Error(`unknown activity format: ${url}`);
}

/* Turn the normalized samples into the same GeoJSON LineString our route
   scenes already render — plus a summary block matching what the live
   Routing API returns (lengthInMeters, travelTimeInSeconds) so the rest
   of the scene code stays format-agnostic. */
export function toRouteShape(activity) {
  const coords = activity.samples.map(s => [s.lng, s.lat]);
  const t0 = activity.samples.find(s => s.time)?.time;
  const tN = [...activity.samples].reverse().find(s => s.time)?.time;
  const travelTimeInSeconds = (t0 && tN) ? Math.round((tN - t0) / 1000) : 0;

  // Haversine summed along the polyline — same metric as the Routing API.
  const R = 6371000;
  const rad = d => (d * Math.PI) / 180;
  let lengthInMeters = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    lengthInMeters += 2 * R * Math.asin(Math.sqrt(a));
  }

  return {
    geojson: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } },
    summary: { lengthInMeters, travelTimeInSeconds },
  };
}

/* Build a per-segment speed dataset for gradient line rendering.
   Returns null when the activity has no timestamp data (GeoJSON files
   typically have none). Each segment is a consecutive trackpoint pair
   with a computed speed in km/h — the caller maps this to colour. */
export function speedSegments(activity) {
  const s = activity.samples;
  if (s.length < 2 || !s.some(p => p.time)) return null;
  const R = 6371000;
  const rad = d => (d * Math.PI) / 180;
  const segments = [];
  let minSpeed = Infinity, maxSpeed = 0;
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    if (!a.time || !b.time) continue;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    const dist = 2 * R * Math.asin(Math.sqrt(h));
    const dt = (b.time - a.time) / 1000;
    if (dt <= 0 || dist < 0.5) continue;   // skip paused/duplicate points
    const speed = (dist / 1000) / (dt / 3600);
    segments.push({ coords: [[a.lng, a.lat], [b.lng, b.lat]], speed });
    if (speed < minSpeed) minSpeed = speed;
    if (speed > maxSpeed) maxSpeed = speed;
  }
  if (segments.length < 2) return null;
  return { segments, minSpeed, maxSpeed };
}

/* Given the parsed samples and a target distance-from-start (m), return
   the interpolated HR / time at that point along the polyline. Used to
   colour per-km split popups with REAL telemetry rather than synthetic. */
export function telemetryAt(activity, distanceM) {
  const samples = activity.samples;
  if (samples.length < 2) return {};
  const R = 6371000;
  const rad = d => (d * Math.PI) / 180;

  let acc = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
              Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    const seg = 2 * R * Math.asin(Math.sqrt(h));
    if (acc + seg >= distanceM) {
      const t = seg === 0 ? 0 : (distanceM - acc) / seg;
      return {
        hr:   a.hr  != null && b.hr  != null ? Math.round(a.hr  + (b.hr  - a.hr)  * t) : a.hr ?? b.hr,
        ele:  a.ele != null && b.ele != null ? a.ele + (b.ele - a.ele) * t : a.ele ?? b.ele,
        time: (a.time && b.time) ? new Date(a.time.getTime() + (b.time - a.time) * t) : a.time || b.time,
      };
    }
    acc += seg;
  }
  return {};
}
