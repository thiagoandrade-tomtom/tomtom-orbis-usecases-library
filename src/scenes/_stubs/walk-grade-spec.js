/* Shared by the Neighbourhood analysis scene and the snapshot builder
   (scripts/build-walk-snapshots.mjs), so a baked city and a live one are
   sampled and scored the same way. Plain data + pure helpers, no imports
   — the builder runs under Node, outside Vite.

   FOUR SIGNALS, ON PURPOSE
   The question is "can I live here without a car", asked at the scale of
   a whole city. That comes down to: is there a bus stop at the corner, a
   metro or train station within a walk, a supermarket, a park. Restaurants,
   bars and cafés were tried and dropped — they flood the POI field
   (100 restaurants inside 260 m in central Paris) without changing which
   neighbourhoods need a car.

   Codes verified against the live API. 7380 is railway station and in
   São Paulo returns the metro and CPTM stations (Sé Metrô, Júlio Prestes
   CPTM); 9942 is public transport stop and returns bus stops. Groceries is
   a free-text search — the market category (7332) returns telecom shops.
   `reject` matches TomTom's own sub-category names; `rejectName` the POI
   name, for entries whose category is right but whose place isn't.

   Scoring per signal: walked metres ≈ 1.3 × straight line; score 1 up to
   `full`, then exp(-(m - full) / tau). `k` averages the k nearest, so one
   bus stop is not a bus network. `withinMin` is the budget the
   neighbourhood card reports coverage against ("62% of Moema is within a
   15-minute walk of metro or rail"). Tuned strict: a supermarket five
   minutes away is already an errand. */
export const CATEGORY_SPECS = {
  bus:       { label: 'Bus',            k: 3, cat: 9942, full: 150, tau: 300, withinMin: 5 },
  rail:      { label: 'Metro & rail',   k: 1, cat: 7380, full: 400, tau: 700, withinMin: 15, names: true,
               // 7380 also carries companies and infrastructure filed as
               // "railway station" — a haulier, a parts shop, the airport
               // authority, a ventilation shaft. Dropped by name.
               rejectName: /transportes|soluç|peças|infra-?estrutura|controle do espaço|poço de ventila|pátio|locomotive/i },
  groceries: { label: 'Groceries',      k: 1, query: 'supermarket', full: 150, tau: 360, withinMin: 10 },
  parks:     { label: 'Parks',          k: 1, cat: 9362, full: 200, tau: 500, withinMin: 10, reject: /cemetery|historic site/i },
};

export const DETOUR = 1.3;              // street metres per straight-line metre
export const WALK_M_PER_MIN = 80;
export const decayFor = spec => m => m <= spec.full ? 1 : Math.exp(-(m - spec.full) / spec.tau);

/* The curated cities — one or two per continent, each checked to have
   neighbourhood polygons in TomTom's admin data. `query` geocodes the
   municipality whose outline bounds the map. `level` is the admin level
   that means "neighbourhood" there: São Paulo's Neighbourhood level is
   sparse ("Vila Lageado" for Jaguaré) while MunicipalitySubdivision is its
   96 distritos; Paris is the other way round (80 quartiers at
   Neighbourhood, 20 arrondissements above). `hex` is the cell radius that
   suits the neighbourhoods' size. `clipKm` keeps only neighbourhoods
   within that distance of `center`, for a municipality far larger than
   the city people mean (Sydney's is 82 × 85 km).

   Probed and left out: Tokyo (the municipality is the whole prefecture,
   225 × 249 km, with no subdivision polygons) and Cape Town (no
   neighbourhood level at all). */
export const REGIONS = {
  saopaulo:  { query: 'São Paulo, Brazil',      level: 'MunicipalitySubdivision', center: [-46.6333, -23.5505], hex: 700 },
  berlin:    { query: 'Berlin, Germany',        level: 'MunicipalitySubdivision', center: [13.4050, 52.5200],   hex: 600 },
  paris:     { query: 'Paris, France',          level: 'Neighbourhood',           center: [2.3470, 48.8590],    hex: 300 },
  amsterdam: { query: 'Amsterdam, Netherlands', level: 'Neighbourhood',           center: [4.8970, 52.3730],    hex: 400 },
  barcelona: { query: 'Barcelona, Spain',       level: 'Neighbourhood',           center: [2.1700, 41.3870],    hex: 300 },
  seattle:   { query: 'Seattle, WA, USA',       level: 'Neighbourhood',           center: [-122.3320, 47.6060], hex: 450 },
  singapore: { query: 'Singapore',              level: 'MunicipalitySubdivision', center: [103.8500, 1.3000],   hex: 600 },
  sydney:    { query: 'Sydney, Australia',      level: 'MunicipalitySubdivision', center: [151.2093, -33.8688], hex: 450, clipKm: 12 },
  nairobi:   { query: 'Nairobi, Kenya',         level: 'MunicipalitySubdivision', center: [36.8219, -1.2921],   hex: 600 },
};

/* Search pages cap at 100; an anchor that returns ~100 has saturated. */
export const PAGE = 100;
export const isSaturated = n => n >= PAGE * 0.95;

/* Local metric projection — metres east / north of the city centre.
   Equirectangular: under 0.3% error across a 40 km city. */
export function projector([lon0, lat0]) {
  const mx = 111_320 * Math.cos(lat0 * Math.PI / 180), my = 110_540;
  return {
    toXY: ([lon, lat]) => [(lon - lon0) * mx, (lat - lat0) * my],
    toLL: ([x, y]) => [lon0 + x / mx, lat0 + y / my],
  };
}

/* Even-odd point-in-polygon over a GeoJSON Polygon / MultiPolygon's
   coordinates (any consistent planar coordinates — lon/lat or metres). */
export function inRings(pt, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
export function inGeometry(pt, geom) {
  if (!geom) return false;
  if (geom.type === 'Polygon') return inRings(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(p => inRings(pt, p));
  return false;
}
