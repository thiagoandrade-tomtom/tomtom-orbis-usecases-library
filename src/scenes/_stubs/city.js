/* City planning — click any neighbourhood, anywhere on Earth, and run
   the 15-minute-city test on it.

   Persona: a mobility officer answering one question per click — "Can a
   resident reach the six essentials of daily life on foot in 15 minutes
   from here?" The essentials are baked in:
     1. groceries        4. transit
     2. schools          5. parks
     3. healthcare       6. cafés / restaurants
   The walk radius is fixed at 1.2 km (≈ 15 min at 4.8 km/h).

   How one click works:
     reverseGeocode(point)
       → "you clicked inside Centrum, Amsterdam"
     geocode(subdivision, MunicipalitySubdivision)
       → boundaryId for the neighbourhood polygon
     fetchBoundary(boundaryId)
       → the polygon we draw on top of the basemap
     6 × Nearby/POI search around the centroid in parallel
       → counts per essential → 0-6 score

   Each click pushes a row into a session-local league table (capped at
   five) so the officer builds a ranking by exploring the city — no
   hardcoded list of neighbourhoods, no city-specific data.

   Restyle: the polygon fill / stroke / width / dash are exposed below
   so the area paint can match a city's data-vis palette. */

import { infoCard } from '../../render/popup.js';
import { geocode, fetchBoundary, nearbySearch, poiSearch, reverseGeocode } from '../../map/services.js';
import { paramFor } from '../../state.js';
import { areaParams } from '../_shared.js';

/* The six daily-life essentials. `threshold` is the minimum count inside
   the 1.2 km buffer that earns the category a pass — calibrated for a
   dense European urban core. */
const ESSENTIALS = [
  { key: 'groceries', label: 'Groceries',   threshold: 3, fetch: (c, r) => poiSearch({ query: 'supermarket', center: c, radius: r, limit: 50 }) },
  { key: 'schools',   label: 'Schools',     threshold: 2, fetch: (c, r) => nearbySearch({ center: c, radius: r, categorySet: 7372, limit: 50 }) },
  { key: 'health',    label: 'Healthcare',  threshold: 3, fetch: (c, r) => nearbySearch({ center: c, radius: r, categorySet: 7321, limit: 50 }) },
  { key: 'transit',   label: 'Transit stops', threshold: 6, fetch: (c, r) => nearbySearch({ center: c, radius: r, categorySet: 9942, limit: 100 }) },
  { key: 'parks',     label: 'Parks',       threshold: 1, fetch: (c, r) => nearbySearch({ center: c, radius: r, categorySet: 9362, limit: 30 }) },
  { key: 'social',    label: 'Cafés & food',threshold: 8, fetch: (c, r) => nearbySearch({ center: c, radius: r, categorySet: 7315, limit: 100 }) },
];

const WALK_RADIUS_M = 1200;     // 15 min on foot at 4.8 km/h
const HISTORY_LIMIT = 5;
const truthy = v => v === true || v === 'true';

/* Starting camera presets exposed by the `region` combobox. Each preset
   drops the camera right over a city centre so the first click is a
   short hop, not a pan-and-zoom hunt. The engine itself is region-
   agnostic — these are camera bookmarks, nothing more. The combobox
   also accepts any free-text city name; the scene geocodes those at
   runtime and re-aims the camera once coordinates resolve. */
const REGIONS = {
  amsterdam:  { center: [4.9041,   52.3676], zoom: 11 },
  paris:      { center: [2.3522,   48.8566], zoom: 12 },
  berlin:     { center: [13.4050,  52.5200], zoom: 11 },
  london:     { center: [-0.1276,  51.5072], zoom: 11 },
  barcelona:  { center: [2.1734,   41.3874], zoom: 12 },
  newyork:    { center: [-73.9857, 40.7484], zoom: 12 },
  mexicocity: { center: [-99.1332, 19.4326], zoom: 11 },
  saopaulo:   { center: [-46.6333, -23.5505], zoom: 12 },
  tokyo:      { center: [139.7670, 35.6814], zoom: 12 },
  singapore:  { center: [103.8198,  1.3521], zoom: 12 },
};

/* Map a 0-6 essential count to a 5-star walkability rating plus a
   plain-English verdict. The thresholds are tuned so each band reads
   as a distinct urban-planning verdict — "1-2 essentials" is genuinely
   car-dependent, "6/6" is the rare textbook 15-min city. */
function walkabilityFor(score) {
  if (score >= 6) return { stars: 5, label: 'Excellent walkability' };
  if (score === 5) return { stars: 4, label: 'Very walkable' };
  if (score === 4) return { stars: 3, label: 'Walkable' };
  if (score === 3) return { stars: 2, label: 'Somewhat walkable' };
  if (score >= 1) return { stars: 1, label: 'Car-dependent' };
  return { stars: 0, label: 'Not walkable' };
}

/* Walk a polygon to grow a bbox — used to frame the clicked neighbourhood. */
function growBbox(coords, bbox) {
  for (const c of coords) {
    if (typeof c[0] === 'number') {
      if (c[0] < bbox[0]) bbox[0] = c[0]; if (c[0] > bbox[2]) bbox[2] = c[0];
      if (c[1] < bbox[1]) bbox[1] = c[1]; if (c[1] > bbox[3]) bbox[3] = c[1];
    } else growBbox(c, bbox);
  }
}

/* Run the six essential fetches in parallel at the given centroid and
   compute the 0-6 pass score against thresholds. Returns the per-key
   arrays too so callers can plot the gap markers. */
async function scorePoint(center) {
  const results = await Promise.all(
    ESSENTIALS.map(e => e.fetch(center, WALK_RADIUS_M).catch(() => []))
  );
  const byKey = {};
  let score = 0;
  ESSENTIALS.forEach((e, i) => {
    byKey[e.key] = results[i];
    if (results[i].length >= e.threshold) score += 1;
  });
  return { byKey, score };
}

export default async function city(ctx, uc) {
  const showTraffic = truthy(paramFor(uc, 'traffic'));
  const region      = paramFor(uc, 'region') || 'paris';
  // Region resolution: the combobox stores either a preset key
  // (REGIONS keys) or a freeform string the user typed/picked from
  // search results. We resolve presets synchronously and geocode the
  // freeform string in the background — first paint always shows the
  // Paris fallback so the map isn't blank while the API call lands.
  let startView = REGIONS[region] || REGIONS.paris;
  const needsGeocode = !REGIONS[region] && typeof region === 'string' && region.trim();

  // Theme-aware default for fill / outline. The light-mode default
  // (#646E7B slate) reads correctly against the mono basemap but fades
  // away on the dark variant — so we brighten to a luminous slate when
  // dark mode is on AND the user hasn't customised the picker. The
  // explicit hex picker keeps full control when the user wants it.
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const STATIC_DEFAULT = '#646E7B';
  const DARK_DEFAULT   = '#C8D0DA';
  const themedDefault  = isDark ? DARK_DEFAULT : STATIC_DEFAULT;
  const rawFill   = (paramFor(uc, 'fillColor')   || STATIC_DEFAULT).toUpperCase();
  const rawStroke = (paramFor(uc, 'strokeColor') || STATIC_DEFAULT).toUpperCase();
  const effectiveDefault = baseColor => baseColor === STATIC_DEFAULT ? themedDefault : baseColor;
  const area = areaParams(uc, {
    defaultFill: effectiveDefault(rawFill),
    defaultStroke: effectiveDefault(rawStroke),
    defaultWidth: 3,
  });
  // Override the resolved fill / stroke when the user is still on the
  // static default — areaParams uses paramFor first, which returns the
  // unthemed hex; we substitute the dark-friendly slate here.
  area.fill   = effectiveDefault(rawFill);
  area.stroke = effectiveDefault(rawStroke);
  // Dark basemap eats low-opacity fills. Bump opacity in dark mode so
  // the polygon registers without bleeding into a coloured wash.
  const fillOpacity = isDark ? 0.28 : 0.18;

  const accent = area.fill;
  const passColor = ctx.color('positive');
  const failColor = ctx.color('negative');

  // Camera lands wherever the Region param points — presets jump
  // straight to a city centre so the first click is a short hop. The
  // engine is fully global; this is camera bookmark only.
  ctx.setView({ center: startView.center, zoom: startView.zoom, pitch: 0, bearing: 0, animate: false });

  // Quiet the basemap so the neighbourhood labels read. The TomTom
  // standard style packs in POI icons, road shields, house numbers,
  // building footprints, hillshade — all noise for a city-planning
  // task where the only labels that matter are place names. We keep
  // roads (orientation skeleton) + boundaries + every `Places - *`
  // label layer and drop the rest. Originals restore on scene teardown.
  ctx.hideLayers(lyr => {
    const id = lyr.id;
    if (id.startsWith('POI')) return true;
    if (id.startsWith('TransitLabels')) return true;
    if (id.startsWith('NatureLabels')) return true;
    if (id.startsWith('Buildings')) return true;
    if (id === '3D - Building') return true;
    if (id === 'Hillshade') return true;
    if (id === 'House Number') return true;
    if (id === 'LULC - Parking & Driving') return true;
    if (id.endsWith('Road arrow')) return true;
    return false;
  });

  if (showTraffic) ctx.enableTrafficFlow();

  // Hint popup — sits at the camera centre until the first click. The
  // region picker in the config panel is the way to jump cities now; the
  // popup just states the interaction model and clears on first click.
  let hintPopup = ctx.addPopup(
    { offset: 0, anchor: 'center', closeButton: false, closeOnClick: false },
    startView.center,
    `<div class="pop">
       <div class="pop-head">
         <div class="pop-eyebrow">15-minute city test</div>
         <div class="pop-title">Click any neighbourhood on Earth</div>
         <div class="pop-sub">Score how walkable it is — six daily-life essentials inside a 1.2 km walk.</div>
       </div>
     </div>`
  );

  // Freeform region from the combobox — geocode in the background and
  // re-aim the camera once coordinates resolve. The initial view above
  // is the Paris fallback so the map never blanks on a typed query.
  if (needsGeocode) {
    geocode({ query: region, limit: 1, entityType: 'Municipality' })
      .then(hits => {
        if (ctx.cancelled || !hits[0]) return;
        ctx.setView({ center: hits[0].position, zoom: 12, animate: true });
        if (hintPopup) hintPopup.setLngLat(hits[0].position);
      })
      .catch(() => {});
  }

  // Session-local league table. Each click prepends a row; we cap at 5
  // so the card stays scannable. Identity = "name | municipality" so
  // re-clicking the same area updates instead of duplicating.
  const history = [];
  let resultPopup = null;
  let boundarySourceAdded = false;
  let pendingClick = 0;       // dedup token — only the latest click wins

  // Cursor affordance — make it obvious every basemap pixel is clickable.
  ctx.ml.getCanvas().style.cursor = 'crosshair';

  function pushHistory(entry) {
    const i = history.findIndex(h => h.id === entry.id);
    if (i >= 0) history.splice(i, 1);
    history.unshift(entry);
    while (history.length > HISTORY_LIMIT) history.pop();
  }

  async function handleClick(point) {
    const token = ++pendingClick;
    if (hintPopup) { try { hintPopup.remove(); } catch {} hintPopup = null; }

    // Surface progress immediately — the full sweep takes 2-5 s and a
    // silent map between click and result reads as broken. The loading
    // popup gets replaced in-place by renderCard / showNoCoverage.
    showLoading(point, 'Identifying neighbourhood…');

    // 1. Reverse geocode the click to identify what neighbourhood (if any)
    //    sits under it. Anything with no municipality means open water /
    //    no-coverage area — surface that instead of a fake score.
    let rev;
    try { rev = await reverseGeocode({ point }); } catch { rev = null; }
    if (token !== pendingClick || ctx.cancelled) return;

    const subdivision = rev?.municipalitySubdivision || rev?.neighbourhood;
    const municipality = rev?.municipality;
    const country = rev?.country;
    if (!municipality) {
      showNoCoverage(point);
      return;
    }

    // 2. Resolve the subdivision (if any) to a real boundary polygon. If
    //    the reverse geocode only gave us a municipality, we fall back to
    //    that and just score the click point — the polygon just won't
    //    draw, but the 15-min test still answers the question.
    let sub = null;
    if (subdivision) {
      const subHits = await geocode({
        query: `${subdivision}, ${municipality}`,
        entityType: 'MunicipalitySubdivision',
        limit: 1,
      }).catch(() => []);
      sub = subHits[0] || null;
    }
    if (token !== pendingClick || ctx.cancelled) return;

    // 3. Centroid for the essentials sweep: prefer the subdivision's
    //    geocoded centroid (sits inside the polygon), fall back to the
    //    raw click point.
    const center = sub?.position || point;

    // Now that we know the name, sharpen the loading message — the user
    // can tell which neighbourhood is being scored vs. which click landed.
    showLoading(center, `Scoring ${subdivision || municipality}…`);

    // 4. Boundary fetch + the six essentials sweep in parallel. The 6
    //    Search calls + 1 boundary fetch fan out without straining the
    //    rate limit (vs. the 48-call full-city sweep we used to do).
    const [boundary, { byKey, score }] = await Promise.all([
      sub?.boundaryId ? fetchBoundary(sub.boundaryId, { zoom: 12 }).catch(() => null) : Promise.resolve(null),
      scorePoint(center),
    ]);
    if (token !== pendingClick || ctx.cancelled) return;

    // 5. Replace the previous polygon (if any) with the new one. We keep
    //    the source / layer pair alive across clicks and mutate its data
    //    so the basemap doesn't blink between selections.
    if (boundary) {
      if (!boundarySourceAdded) {
        ctx.addSource('focus', { type: 'geojson', data: boundary });
        ctx.addLayer({
          id: 'focus-fill', type: 'fill', source: 'focus',
          paint: { 'fill-color': area.fill, 'fill-opacity': fillOpacity },
        });
        const outlinePaint = {
          'line-color': area.stroke,
          'line-width': area.width,
          'line-opacity': 1.0,
        };
        if (area.dashArray) outlinePaint['line-dasharray'] = area.dashArray;
        ctx.addLayer({
          id: 'focus-outline', type: 'line', source: 'focus',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: outlinePaint,
        });
        boundarySourceAdded = true;
      } else {
        ctx.ml.getSource('focus').setData(boundary);
      }
    }

    // 6. Record in history and render the league-table card.
    const displayName = subdivision || municipality;
    pushHistory({
      id: `${displayName}|${municipality}`,
      name: displayName,
      municipality,
      country,
      score,
      center,
    });

    renderCard({ center, displayName, municipality, country, byKey, score });

    // 7. Frame the polygon (or zoom in on the centroid when there isn't one).
    if (boundary) {
      const bbox = [Infinity, Infinity, -Infinity, -Infinity];
      growBbox(boundary.geometry?.coordinates || [], bbox);
      if (bbox[0] !== Infinity) {
        ctx.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { duration: 700 });
      }
    } else {
      ctx.setView({ center, zoom: 14, animate: true });
    }
  }

  function replaceResultPopup(lngLat, html, opts = {}) {
    if (resultPopup) { try { resultPopup.remove(); } catch {} }
    resultPopup = ctx.addPopup(
      { offset: 18, anchor: 'top', closeButton: true, closeOnClick: false, ...opts },
      lngLat, html,
    );
  }

  function showLoading(lngLat, label) {
    // Closebutton off — the popup is short-lived and a stray close mid-fetch
    // would leave the user staring at nothing while results are still arriving.
    replaceResultPopup(lngLat, `
      <div class="pop" style="--pop-accent:${accent}">
        <div class="pop-head">
          <div class="pop-eyebrow">15-minute city test</div>
          <div class="pop-title"><span class="city-spinner" aria-hidden="true"></span>${escapeHtml(label)}</div>
        </div>
      </div>`, { closeButton: false });
  }

  function showNoCoverage(point) {
    replaceResultPopup(point, `
      <div class="pop">
        <div class="pop-head">
          <div class="pop-eyebrow">No coverage</div>
          <div class="pop-title">Not a neighbourhood</div>
          <div class="pop-sub">TomTom doesn't know a municipality at this point. Try clicking on land inside a city.</div>
        </div>
      </div>`, { anchor: 'bottom', offset: 8 });
  }

  /* Score-aware semantic colour for the hero number — green ≥5, amber 3-4,
     red <3. Same scale the league table inherits visually via dot colour. */
  function scoreTone(s) {
    if (s >= 5) return passColor;
    if (s >= 3) return ctx.color('attention');
    return failColor;
  }

  function renderCard({ center, displayName, municipality, country, byKey, score }) {
    // Hero: a 5-star walkability rating + plain-English verdict. The
    // stars are the universal language for "how good is this place" —
    // walkability indices like Walk Score use the same vocabulary. The
    // raw "X of 6 essentials" sits as small attribution underneath so
    // the methodology is still discoverable.
    const tone = scoreTone(score);
    const { stars, label } = walkabilityFor(score);
    const starsHtml = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    const heroBlock = `
      <div class="city-hero" style="--c-hero:${tone}">
        <div class="city-hero-stars" aria-label="${stars} out of 5">${starsHtml}</div>
        <div class="city-hero-label">${escapeHtml(label)}</div>
        <div class="city-hero-cap">${score} of 6 essentials reachable on foot in 15 min</div>
      </div>`;

    // 2×3 essentials grid. Each tile: ✓/✗ glyph, category label, the
    // live count as the big number, and a tiny "min N" line so the
    // threshold reads as context — not a fraction grade. This kills
    // the "50 / 2" confusion where the slash was reading as a ratio.
    const tiles = ESSENTIALS.map(e => {
      const count = byKey[e.key].length;
      const passed = count >= e.threshold;
      const glyph = passed ? '✓' : '✗';
      const tileColor = passed ? passColor : failColor;
      return `
        <div class="city-tile" style="--c-tile:${tileColor}">
          <span class="city-tile-glyph">${glyph}</span>
          <span class="city-tile-body">
            <span class="city-tile-label">${escapeHtml(e.label)}</span>
            <span class="city-tile-count">${count}</span>
            <span class="city-tile-th">target: ${e.threshold}</span>
          </span>
        </div>`;
    }).join('');
    const gridBlock = `<div class="city-grid">${tiles}</div>`;

    // Session ranking — same star scale as the hero so a row visually
    // matches its full card. Coloured dot stays as a fast pass / partial /
    // fail tell when the user is scanning across rows.
    const leagueRows = history.map((h, i) => {
      const isFocus = h.id === `${displayName}|${municipality}`;
      const dot = scoreTone(h.score);
      const rowStars = walkabilityFor(h.score).stars;
      return `
        <div class="city-league-row${isFocus ? ' is-focus' : ''}">
          <span class="city-league-rank">${i + 1}</span>
          <span class="city-league-dot" style="background:${dot}"></span>
          <span class="city-league-name">${escapeHtml(h.name)}</span>
          <span class="city-league-score">${'★'.repeat(rowStars)}${'☆'.repeat(5 - rowStars)}</span>
        </div>`;
    }).join('');
    const leagueBlock = history.length > 1
      ? `<div class="city-league"><div class="city-league-head">This session</div>${leagueRows}</div>`
      : '';

    // Subtitle: "City, Country · 1.2 km walk · 6 essentials". Country
    // is only appended when reverseGeocode actually returned one — some
    // edge points (open water, disputed regions) come back without it.
    const locale = [municipality, country].filter(Boolean).join(', ');
    replaceResultPopup(center, infoCard({
      eyebrow: '15-minute city test',
      title: displayName,
      subtitle: `${locale} · 1.2 km walk · ${ESSENTIALS.length} essentials`,
      blocks: [heroBlock, gridBlock, leagueBlock].filter(Boolean),
      footer: 'Reverse geocode · TomTom Search · TomTom Admin Boundaries',
    }));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // The whole interaction surface is a single map-level click. No layer
  // filter — we want every pixel of land to be a candidate.
  ctx.on('click', (e) => {
    handleClick([e.lngLat.lng, e.lngLat.lat]);
  });
}
