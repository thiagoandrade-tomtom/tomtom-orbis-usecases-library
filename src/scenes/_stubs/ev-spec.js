/* Shared by the "Find an EV charger" scene (src/scenes/_stubs/ev.js) and
   its offline bake (scripts/build-ev-snapshots.mjs). Pure JS — no browser
   or map imports — so Node can run it too.

   Why a quadtree at all: a Nearby Search page stops at 100 results and has
   no offset beyond that. Around Museumplein those 100 chargers are all
   within ~560 m, so one call can never show a city. Covering an area means
   asking many small questions: query a square cell; if it comes back full,
   split it into four and ask again; stop once every cell returns fewer
   than a full page. What's left is every charger TomTom lists in the area,
   de-duplicated by id — measured on Amsterdam, a 6 km box is 5,309 chargers
   in 257 calls. */

export const CAT_EV = 7309;
export const PAGE = 100;

/* Preset cities, baked by `node scripts/build-ev-snapshots.mjs`. An anchor
   that falls inside one of these boxes reads the snapshot; anywhere else
   the scene samples a smaller box live. `half` is the half-width of the
   square, in metres. */
export const EV_CITIES = {
  amsterdam: { label: 'Amsterdam', center: [4.8970, 52.3730],  half: 6000 },
  paris:     { label: 'Paris',     center: [2.3470, 48.8590],  half: 6000 },
  berlin:    { label: 'Berlin',    center: [13.4050, 52.5200], half: 7000 },
  london:    { label: 'London',    center: [-0.1180, 51.5100], half: 7000 },
  oslo:      { label: 'Oslo',      center: [10.7520, 59.9140], half: 6000 },
  barcelona: { label: 'Barcelona', center: [2.1700, 41.3870],  half: 5000 },
  // Sparser network over a much larger city: a wide square, still cheap.
  saopaulo:  { label: 'São Paulo', center: [-46.6333, -23.5505], half: 15000 },
};

/* Local metric projection — metres east / north of `center`. */
export function projector([lon0, lat0]) {
  const mx = 111_320 * Math.cos(lat0 * Math.PI / 180), my = 110_540;
  return {
    toXY: ([lon, lat]) => [(lon - lon0) * mx, (lat - lat0) * my],
    toLL: ([x, y]) => [lon0 + x / mx, lat0 + y / my],
  };
}

export function cityFor(point) {
  for (const [key, c] of Object.entries(EV_CITIES)) {
    const [x, y] = projector(c.center).toXY(point);
    if (Math.abs(x) <= c.half && Math.abs(y) <= c.half) return key;
  }
  return null;
}

/* Max rated power across a charger's connectors, in whole kW (0 = unknown). */
export const maxKw = connectors =>
  Math.round((connectors || []).reduce((m, c) => Math.max(m, c.ratedPowerKW || 0), 0));

/* Speed tiers — the same breakpoints the scene's legend reads out. */
export const SPEED_TIERS = [
  { key: 'unknown', label: 'Power unknown', test: kw => kw <= 0 },
  { key: 'slow',    label: 'Slow · ≤ 11 kW',     test: kw => kw <= 11 },
  { key: 'fast',    label: 'Fast · 12–49 kW',    test: kw => kw < 50 },
  { key: 'rapid',   label: 'Rapid · 50–149 kW',  test: kw => kw < 150 },
  { key: 'ultra',   label: 'Ultra · 150 kW +',   test: () => true },
];
export const tierIndex = kw => SPEED_TIERS.findIndex(t => t.test(kw));

/* One compact record per charger — what the bake stores and what the live
   sampler produces, so the scene has a single shape to render. */
export function compact(r) {
  const conns = r.chargingPark?.connectors || [];
  const byType = new Map();
  for (const c of conns) {
    const k = `${c.connectorType}|${Math.round(c.ratedPowerKW || 0)}`;
    byType.set(k, (byType.get(k) || 0) + 1);
  }
  return {
    id: r.id,
    lon: r.position.lon,
    lat: r.position.lat,
    name: r.poi?.name || '',
    addr: r.address?.freeformAddress || '',
    kw: maxKw(conns),
    // "type|kW|count" per distinct connector — static inventory.
    conns: [...byType].map(([k, n]) => `${k}|${n}`),
    avail: r.dataSources?.chargingAvailability?.id || '',
  };
}

/* Cover a square of side 2·half around `center` with Nearby Search.

     fetchPage(center [lon,lat], radiusM) → raw `results` array
     onCell(records)                      → called per finished cell, for
                                            progressive rendering
     budget                               → max calls; unresolved cells
                                            are reported, never guessed
     strict                               → rethrow a failed page instead
                                            of dropping its cell (bakes)

   Cells are visited nearest-first, so a budgeted live run fills in the
   neighbourhood around the anchor before the outskirts. A cell smaller
   than `minCell` that still saturates is kept as-is and counted — in
   practice that never happened on the baked cities. */
export async function coverSquare({
  center, half, fetchPage, onCell, budget = Infinity, minCell = 150, concurrency = 6, strict = false,
}) {
  const proj = projector(center);
  const seen = new Map();
  let calls = 0, saturated = 0;
  let queue = [{ x: 0, y: 0, h: half }];

  while (queue.length && calls < budget) {
    queue.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    const batch = queue.splice(0, Math.min(concurrency, budget - calls));
    calls += batch.length;
    const pages = await Promise.all(batch.map(c =>
      fetchPage(proj.toLL([c.x, c.y]), Math.ceil(c.h * Math.SQRT2))
        .catch(err => { if (strict) throw err; return null; })));

    pages.forEach((results, i) => {
      const c = batch[i];
      if (!results) return;                      // failed call → drop the cell, don't invent
      if (results.length >= PAGE && c.h > minCell) {
        const q = c.h / 2;
        queue.push(
          { x: c.x - q, y: c.y - q, h: q }, { x: c.x + q, y: c.y - q, h: q },
          { x: c.x - q, y: c.y + q, h: q }, { x: c.x + q, y: c.y + q, h: q },
        );
        return;
      }
      if (results.length >= PAGE) saturated++;
      // A cell's search circle overlaps its neighbours — keep only the
      // chargers that fall inside the cell's own square.
      const fresh = [];
      for (const r of results) {
        const [x, y] = proj.toXY([r.position.lon, r.position.lat]);
        if (Math.abs(x - c.x) > c.h || Math.abs(y - c.y) > c.h) continue;
        if (seen.has(r.id)) continue;
        const rec = compact(r);
        seen.set(r.id, rec);
        fresh.push(rec);
      }
      if (fresh.length && onCell) onCell(fresh);
    });
  }
  return { records: [...seen.values()], calls, saturated, unresolved: queue.length };
}
