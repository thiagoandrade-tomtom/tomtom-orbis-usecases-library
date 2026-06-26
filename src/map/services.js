/* Thin wrappers over TomTom REST APIs. Each function:
   - takes a plain options object
   - returns a Promise of normalized data (GeoJSON where it makes sense)
   - throws Error on non-2xx so callers can use try/catch

   Add a new endpoint by following the same shape. Keep wrappers narrow —
   no UI concerns. Retries + a shared response cache live centrally in
   getJson (see below), so every wrapper gets them for free. */

import { API_BASE, API_KEY } from './config.js';

function requireKey() {
  if (!API_KEY) throw new Error('VITE_TOMTOM_API_KEY is not set — see .env.example');
}

function buildUrl(path, params = {}) {
  const url = new URL(API_BASE + path);
  url.searchParams.set('key', API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function fetchJsonRaw(url, init) {
  // Retry transient throttling (429) and gateway hiccups (502/503/504).
  // TomTom returns these under bursty parallel fan-outs; the call itself
  // is fine on a second attempt a beat later.
  const RETRY_STATUSES = new Set([429, 502, 503, 504]);
  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res.json();
    if (RETRY_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get('retry-after')) * 1000;
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter
        : 250 * 2 ** (attempt - 1) + Math.random() * 150;
      await new Promise(r => setTimeout(r, backoff));
      continue;
    }
    const body = await res.text().catch(() => '');
    throw new Error(`TomTom API ${res.status}: ${body.slice(0, 200)}`);
  }
}

/* Shared response cache — every case benefits. The URL already carries
   all the parameters, so a changed input is a different key (refetch) and
   a repeated identical call (re-run, theme/basemap replay, reload within
   the window) is served instantly with zero network. Persisted to
   localStorage; on a fetch failure we fall back to the last good response
   rather than erroring. Only GETs are cached — POSTs depend on their body. */
const CACHE_PREFIX = 'ttq:';
const CACHE_TTL_MS = 15 * 60 * 1000;   // 15 min — "keep it until something newer"
const _mem = new Map();
// Strip the API key so we neither persist the secret nor split the cache
// when the key is set after the first call.
const cacheKeyFor = (url) => CACHE_PREFIX + url.replace(/([?&])key=[^&]*(&?)/, '$1').replace(/[?&]$/, '');
const _lsGet = (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const _lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota — memory cache still serves */ } };

async function getJson(url, init) {
  const cacheable = !init || !init.method || init.method.toUpperCase() === 'GET';
  if (!cacheable) return fetchJsonRaw(url, init);

  const key = cacheKeyFor(url);
  const now = Date.now();
  const mem = _mem.get(key);
  if (mem && now - mem.t < CACHE_TTL_MS) return mem.data;
  const ls = _lsGet(key);
  if (ls && now - ls.t < CACHE_TTL_MS) { _mem.set(key, ls); return ls.data; }

  try {
    const data = await fetchJsonRaw(url, init);
    const rec = { data, t: now };
    _mem.set(key, rec);
    _lsSet(key, rec);
    return data;
  } catch (err) {
    // Live call failed (rate limit / offline) → reuse the last good one.
    const stale = mem || ls || _lsGet(key);
    if (stale) return stale.data;
    throw err;
  }
}

/* ------------------------------------------------------------------
   Routing API — https://developer.tomtom.com/routing-api
   Returns a GeoJSON LineString Feature plus the raw summary.
------------------------------------------------------------------- */
export async function calculateRoute({ origin, dest, travelMode = 'car', traffic = true, maxAlternatives = 0, routeType }) {
  requireKey();
  // TomTom takes "lat,lng:lat,lng" — note lat first.
  const locs = `${origin[1]},${origin[0]}:${dest[1]},${dest[0]}`;
  const params = { travelMode, traffic };
  if (maxAlternatives > 0) params.maxAlternatives = maxAlternatives;
  if (routeType) params.routeType = routeType;
  const url = buildUrl(`/routing/1/calculateRoute/${locs}/json`, params);
  const data = await getJson(url);
  const routes = data.routes || [];
  if (!routes.length) throw new Error('Routing API returned no route');
  const toFeature = (route) => {
    const points = route.legs.flatMap(l => l.points);
    return {
      geojson: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: points.map(p => [p.longitude, p.latitude]) },
        properties: {},
      },
      summary: route.summary,
    };
  };
  const primary = toFeature(routes[0]);
  return {
    ...primary,
    alternatives: routes.slice(1).map(toFeature),
  };
}

/* ------------------------------------------------------------------
   Long Distance EV Routing — https://developer.tomtom.com/long-distance-ev-routing-api
   Plans a trip that's longer than the vehicle's range by inserting
   optimal charging stops along the way. Returns one big route where
   each leg ends either at a charging stop (with chargingInformationAtEndOfLeg)
   or at the destination.
------------------------------------------------------------------- */
export async function calculateLongDistanceEVRoute({
  origin, dest,
  // Either pass `vehicleModelId` for a calibrated profile, or supply an
  // explicit consumption curve via `constantSpeedConsumptionInkWhPerHundredkm`
  // (colon-separated "speed,kWh" pairs) + `maxChargeInkWh`. The latter is
  // the only way to differentiate between specific consumer-grade cars,
  // since the model-id catalog isn't publicly enumerated.
  vehicleModelId,
  constantSpeedConsumptionInkWhPerHundredkm,
  maxChargeInkWh = 75,
  currentChargeInkWh         = 25,
  auxiliaryPowerInkW,
  vehicleWeight,
  minChargeAtDestinationInkWh = 5,
  minChargeAtChargingStopsInkWh = 5,
}) {
  requireKey();
  const locs = `${origin[1]},${origin[0]}:${dest[1]},${dest[0]}`;
  const params = {
    vehicleEngineType: 'electric',
    currentChargeInkWh,
    maxChargeInkWh,
    minChargeAtDestinationInkWh,
    minChargeAtChargingStopsInkWh,
  };
  if (vehicleModelId) params.vehicleModelId = vehicleModelId;
  if (constantSpeedConsumptionInkWhPerHundredkm) params.constantSpeedConsumptionInkWhPerHundredkm = constantSpeedConsumptionInkWhPerHundredkm;
  if (auxiliaryPowerInkW != null) params.auxiliaryPowerInkW = auxiliaryPowerInkW;
  if (vehicleWeight != null)    params.vehicleWeight = vehicleWeight;

  // LDEVR requires a POST with a non-empty `chargingModes` body — the
  // curve's last point must match maxChargeInkWh, so we scale the docs
  // example to whichever battery size the caller picked.
  const chargingCurve = [
    { chargeInkWh: Math.round(maxChargeInkWh * 0.10 * 10) / 10, timeToChargeInSeconds:  400 },
    { chargeInkWh: Math.round(maxChargeInkWh * 0.40 * 10) / 10, timeToChargeInSeconds: 1500 },
    { chargeInkWh: Math.round(maxChargeInkWh * 0.80 * 10) / 10, timeToChargeInSeconds: 3000 },
    { chargeInkWh: maxChargeInkWh,                              timeToChargeInSeconds: 4500 },
  ];
  const body = {
    chargingModes: [
      {
        chargingConnections: [
          { facilityType: 'Charge_Direct_Current_at_50kW',                          plugType: 'Combo_to_IEC_62196_Type_2_Base' },
          { facilityType: 'Charge_200_to_450V_Direct_Current_at_200A_90kW',         plugType: 'Combo_to_IEC_62196_Type_2_Base' },
          { facilityType: 'Charge_200_to_480V_Direct_Current_at_255A_120kW',        plugType: 'Combo_to_IEC_62196_Type_2_Base' },
        ],
        chargingCurve,
      },
    ],
  };

  const url = buildUrl(`/routing/1/calculateLongDistanceEVRoute/${locs}/json`, params);
  const data = await getJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const route = data.routes?.[0];
  if (!route) throw new Error('Long-Distance EV Routing returned no route');
  const allPoints = route.legs.flatMap(l => l.points);
  return {
    geojson: {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: allPoints.map(p => [p.longitude, p.latitude]) },
      properties: {},
    },
    legs: route.legs.map(l => ({
      summary: l.summary,
      points: l.points.map(p => [p.longitude, p.latitude]),
    })),
    summary: route.summary,
  };
}

/* ------------------------------------------------------------------
   Search API — POI Search
   https://developer.tomtom.com/search-api
------------------------------------------------------------------- */
export async function poiSearch({ query, center, radius = 5000, limit = 10, openingHours = false }) {
  requireKey();
  const params = { lat: center[1], lon: center[0], radius, limit };
  // Opt-in so heatmap / sharing callers don't pay for hours they ignore.
  if (openingHours) params.openingHours = 'nextSevenDays';
  const url = buildUrl(`/search/2/poiSearch/${encodeURIComponent(query)}.json`, params);
  const data = await getJson(url);
  return (data.results || []).map(r => ({
    id: r.id,
    name: r.poi?.name,
    category: r.poi?.categories?.[0],
    categories: r.poi?.categories || [],
    classifications: r.poi?.classifications || [],
    brands: r.poi?.brands?.map(b => b.name) || [],
    phone: r.poi?.phone || null,
    url: r.poi?.url || null,
    openingHours: r.poi?.openingHours || null,
    position: [r.position.lon, r.position.lat],
    address: r.address?.freeformAddress,
  }));
}

/* ------------------------------------------------------------------
   Traffic Incident Details — https://developer.tomtom.com/traffic-api
   Returns a GeoJSON FeatureCollection of incidents inside a bounding box.
   bbox is "minLon,minLat,maxLon,maxLat".
------------------------------------------------------------------- */
export async function trafficIncidents({ bbox, language = 'en-GB' }) {
  requireKey();
  const fields = '{incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,delay,length,events{description,code}}}}';
  const url = buildUrl(`/traffic/services/5/incidentDetails`, { bbox, fields, language });
  const data = await getJson(url);
  return data.incidents || [];
}

/* ------------------------------------------------------------------
   Geocoding — https://developer.tomtom.com/search-api
   Resolves a free-form query (address, landmark, admin area) to a real
   position. When entityType is supplied, results carry a dataSources
   geometry id that can be fed to fetchBoundary() to retrieve the polygon.
------------------------------------------------------------------- */
export async function geocode({ query, limit = 1, countrySet, entityType }) {
  requireKey();
  const params = { limit };
  if (countrySet) params.countrySet = countrySet;
  // The strict geocode endpoint only returns geographies — it collapses
  // POI queries like "Amsterdam Centraal" or "Rijksmuseum, Amsterdam"
  // to the surrounding municipality (same id, same coords for both).
  // Fall back to the fuzzy /search endpoint whenever the caller hasn't
  // asked for a specific entityType — it resolves POIs, addresses, and
  // geographies in one shot.
  const path = entityType
    ? `/search/2/geocode/${encodeURIComponent(query)}.json`
    : `/search/2/search/${encodeURIComponent(query)}.json`;
  if (entityType) params.entityType = entityType;
  const url = buildUrl(path, params);
  const data = await getJson(url);
  return (data.results || []).map(r => ({
    position: [r.position.lon, r.position.lat],
    address: r.address?.freeformAddress,
    name: r.poi?.name || r.address?.municipalitySubdivision || r.address?.municipality || r.address?.freeformAddress,
    entityType: r.entityType,
    boundaryId: r.dataSources?.geometry?.id || null,
    viewport: r.viewport || null,
  }));
}

/* ------------------------------------------------------------------
   EV Charging Availability — real-time connector status for a charger.
   Pass the POI id returned by nearbySearch / poiSearch. Returns the raw
   connectors array with current available / occupied / outOfService.
------------------------------------------------------------------- */
export async function chargingAvailability({ chargingAvailabilityId }) {
  requireKey();
  const url = buildUrl(`/search/2/chargingAvailability.json`, {
    chargingAvailability: chargingAvailabilityId,
  });
  const data = await getJson(url);
  return data.connectors || [];
}

/* ------------------------------------------------------------------
   Nearby Search — POI lookup by category code(s), no free-text query.
   categorySet examples: 7309 = Electric Vehicle Station,
                         7311 = Parking, 9942 = Public Transport Stop.
------------------------------------------------------------------- */
export async function nearbySearch({ center, radius = 500, categorySet, limit = 100, openingHours = false }) {
  requireKey();
  const params = { lat: center[1], lon: center[0], radius, limit };
  if (categorySet) params.categorySet = categorySet;
  // `openingHours=nextSevenDays` makes TomTom include the weekly schedule
  // in each POI's poi.openingHours block. Cheap to request — keep off when
  // the caller doesn't render it (heatmaps, EV bolt grid, etc).
  if (openingHours) params.openingHours = 'nextSevenDays';
  // Same unified Orbis Places search endpoint, just with an empty query
  // path segment + a categorySet filter.
  const url = buildUrl(`/search/2/nearbySearch/.json`, params);
  const data = await getJson(url);
  return (data.results || []).map(r => ({
    id: r.id,
    name: r.poi?.name,
    category: r.poi?.categories?.[0],
    categories: r.poi?.categories || [],
    classifications: r.poi?.classifications || [],
    brands: r.poi?.brands?.map(b => b.name) || [],
    phone: r.poi?.phone || null,
    url: r.poi?.url || null,
    openingHours: r.poi?.openingHours || null,
    position: [r.position.lon, r.position.lat],
    address: r.address?.freeformAddress,
    chargingPark: r.chargingPark || null,
  }));
}

/* ------------------------------------------------------------------
   Reverse Geocoding — coords → address.
------------------------------------------------------------------- */
export async function reverseGeocode({ point }) {
  requireKey();
  const url = buildUrl(`/search/2/reverseGeocode/${point[1]},${point[0]}.json`, {});
  const data = await getJson(url);
  const a = data.addresses?.[0];
  if (!a) return null;
  return {
    address: a.address?.freeformAddress,
    streetName: a.address?.streetName,
    municipality: a.address?.municipality,
    municipalitySubdivision: a.address?.municipalitySubdivision,
    neighbourhood: a.address?.neighbourhood,
    countrySubdivision: a.address?.countrySubdivision,
    country: a.address?.country,
    position: a.position ? [parseFloat(a.position.split(',')[1]), parseFloat(a.position.split(',')[0])] : point,
  };
}

/* ------------------------------------------------------------------
   Additional Data — admin / postcode boundary polygons.
   Pass a geometryId returned by geocode (entityType=Municipality,
   MunicipalitySubdivision, Neighbourhood, CountrySubdivision, ...).
   Returns the raw geometryData (a GeoJSON FeatureCollection).
------------------------------------------------------------------- */
export async function fetchBoundary(geometryId, { zoom = 12 } = {}) {
  requireKey();
  const url = buildUrl(`/search/2/additionalData.json`, {
    geometries: geometryId,
    geometriesZoom: zoom,
  });
  const data = await getJson(url);
  const item = data.additionalData?.[0];
  if (!item?.geometryData) throw new Error('additionalData returned no geometryData');
  return item.geometryData;
}

/* ------------------------------------------------------------------
   Multi-stop routing — hub → s1 → s2 → ... → sN as a single call.
   Pass computeBestOrder:true to let TomTom solve the TSP ordering.
   Returns a LineString geojson plus per-leg arrays (each leg is the
   snapped polyline between consecutive waypoints).
------------------------------------------------------------------- */
export async function calculateMultiStopRoute({ points, travelMode = 'car', traffic = true, computeBestOrder = false }) {
  requireKey();
  if (points.length < 2) throw new Error('Need at least two points');
  const locs = points.map(p => `${p[1]},${p[0]}`).join(':');
  const params = { travelMode, traffic };
  if (computeBestOrder) params.computeBestOrder = 'true';
  const url = buildUrl(`/routing/1/calculateRoute/${locs}/json`, params);
  const data = await getJson(url);
  const route = data.routes?.[0];
  if (!route) throw new Error('Routing API returned no route');
  const allPoints = route.legs.flatMap(l => l.points);
  return {
    geojson: {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: allPoints.map(p => [p.longitude, p.latitude]) },
      properties: {},
    },
    legs: route.legs.map(l => ({
      summary: l.summary,
      points: l.points.map(p => [p.longitude, p.latitude]),
    })),
    summary: route.summary,
    optimizedWaypoints: data.optimizedWaypoints,
  };
}
