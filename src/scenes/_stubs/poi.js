/* Discover Places — click the base-style POIs themselves, no overlay.
   Hover changes the cursor, click resolves the POI to a real record via
   the TomTom Search API so the popup shows everything TomTom knows:
   address, category, phone, website, weekly opening hours and brand. */

import { infoCard } from '../../render/popup.js';
import { geocode, poiSearch, reverseGeocode } from '../../map/services.js';
import { paramFor, setDynamicOptions } from '../../state.js';

/* Pretty labels for the TomTom POI group property. The keys are the
   exact strings that appear on the `group` attribute of every base-style
   POI vector tile feature. */
const GROUP_LABELS = {
  business:      'Business',
  eat_and_drink: 'Eat & Drink',
  shopping:      'Shopping',
  transport:     'Transport',
  lodging:       'Lodging',
  cultural:      'Culture',
  outdoor:       'Outdoor',
  leisure:       'Leisure',
  healthcare:    'Healthcare',
  education:     'Education',
  finance:       'Finance',
  sport:         'Sport',
  religion:      'Religion',
  public:        'Public',
  driving:       'Driving',
  parking:       'Parking',
  protected:     'Protected',
};

/* Cache of the anchor we last framed per use case — so when the scene
   reruns because the user toggled a category chip, we DON'T fly back
   to the anchor and lose the pan/zoom the user was exploring. The
   anchor recenter still fires when the anchor input itself changes. */
const lastFramedAnchor = new Map();

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// True if a queried feature belongs to a base-style POI layer.
function isPoiFeature(f) {
  const layerId = f.layer?.id || '';
  const srcLayer = f.sourceLayer || f.layer?.['source-layer'] || '';
  if (!/poi|place/i.test(layerId) && !/poi|place/i.test(srcLayer)) return false;
  return Boolean(featureName(f));
}

function featureName(f) {
  const p = f.properties || {};
  return p.name || p.name_en || p.name_int || p['name:en'] || p['name:latin'] || null;
}

function featureCategory(f) {
  const p = f.properties || {};
  const raw = p.category || p.subclass || p.class || p.type || '';
  if (!raw) return 'Point of interest';
  return String(raw).replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function featurePosition(f, fallback) {
  const g = f.geometry;
  if (g?.type === 'Point') return g.coordinates;
  return fallback;
}

/* Scale a base-style `icon-size` value by `k`, preserving its shape. The
   POI layers express size as a zoom `interpolate` (e.g. 0.42→0.84) — a
   zoom expression must stay the OUTERMOST expression for the property, so
   we can't wrap it in `["*", …]`. Instead we deep-copy and multiply each
   output stop, keeping the interpolation curve intact. Falls back sanely
   for a plain number or an unrecognised expression. */
function scaleIconSize(expr, k) {
  if (typeof expr === 'number') return expr * k;
  if (!Array.isArray(expr) || expr[0] !== 'interpolate') return expr;
  const out = expr.slice();
  // ["interpolate", interp, input, in0, OUT0, in1, OUT1, …] — outputs at 4,6,…
  for (let i = 4; i < out.length; i += 2) {
    if (typeof out[i] === 'number') out[i] = out[i] * k;
  }
  return out;
}

/* Group TomTom's per-day `timeRanges` into compressed day-range bands —
   contiguous days that share the same opening/closing time fold into a
   single entry. Returns the array of `{ range, slot }` so the caller
   decides whether to render it inline or stacked. */
function groupedHours(openingHours) {
  if (!openingHours?.timeRanges?.length) return [];
  const byDay = new Map();
  for (const r of openingHours.timeRanges) {
    const d = r.startTime?.date;
    if (!d) continue;
    const dow = new Date(d).getDay() || 7;
    const slot = `${String(r.startTime.hour).padStart(2, '0')}:${String(r.startTime.minute).padStart(2, '0')}–${String(r.endTime.hour).padStart(2, '0')}:${String(r.endTime.minute).padStart(2, '0')}`;
    if (!byDay.has(dow)) byDay.set(dow, slot);
  }
  if (byDay.size === 0) return [];
  const out = [];
  let runStart = null, runEnd = null, runSlot = null;
  const flush = () => {
    if (runStart == null) return;
    const range = runStart === runEnd ? DAYS[runStart - 1] : `${DAYS[runStart - 1]}–${DAYS[runEnd - 1]}`;
    out.push({ range, slot: runSlot });
  };
  for (let d = 1; d <= 7; d++) {
    const slot = byDay.get(d);
    if (slot && slot === runSlot) runEnd = d;
    else {
      flush();
      if (slot) { runStart = d; runEnd = d; runSlot = slot; }
      else      { runStart = null; runEnd = null; runSlot = null; }
    }
  }
  flush();
  return out;
}

/* Is the POI open right now? Null when hours unknown. */
function openNow(openingHours) {
  if (!openingHours?.timeRanges?.length) return null;
  const now = new Date();
  for (const r of openingHours.timeRanges) {
    if (!r.startTime?.date || !r.endTime?.date) continue;
    const s = new Date(r.startTime.date);
    s.setHours(r.startTime.hour, r.startTime.minute, 0, 0);
    const e = new Date(r.endTime.date);
    e.setHours(r.endTime.hour, r.endTime.minute, 0, 0);
    if (now >= s && now <= e) return true;
  }
  return false;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

/* Build the rich popup HTML from a TomTom POI record + the base-style
   feature it was matched against. The base feature wins for the headline
   (it's what the user clicked), the Search record fills in everything
   else. Hours render as a stacked block (one day-range per line) so
   POIs with varied weekly schedules stay scannable; phone/website
   become real tel: / https: links. */
function richCard({ accent, baseName, baseCat, address, poi }) {
  const hours  = groupedHours(poi?.openingHours);
  const isOpen = openNow(poi?.openingHours);
  const brand  = poi?.brands?.[0];

  // Lead with the category as a tag (it replaces the old eyebrow — the
  // establishment's type is the most useful at-a-glance descriptor).
  // Open / Closed render as neutral high-contrast pills with a coloured
  // status dot rather than a same-hue tinted pill: amber/green text on a
  // tint of itself fails WCAG AA badly (~1.2–1.9:1), whereas dark text on
  // the neutral surface clears it comfortably and the dot still carries
  // the status colour. Green = open, coral (--c-negative, not TomTom red)
  // = closed.
  const pills = [{ text: baseCat, tone: 'neutral' }];
  if (isOpen === true)  pills.push({ text: 'Open now',   tone: 'neutral', dot: 'var(--c-positive)' });
  if (isOpen === false) pills.push({ text: 'Closed now', tone: 'neutral', dot: 'var(--c-negative)' });
  // Brand only when it adds information beyond the name — chains repeat
  // the title ("Starbucks" branded "Starbucks"), so that pill is just
  // noise. Keep it for the rare case where the brand differs (e.g. a
  // venue operated under a parent brand).
  const nameLc = (baseName || '').toLowerCase();
  if (brand && !nameLc.includes(brand.toLowerCase())) {
    pills.push({ text: brand, tone: 'info' });
  }

  // Hours render as a standalone block (no key column) — POIs with seven
  // different daily schedules need full popup width, not the cramped
  // right-aligned value cell. Day-range left, time-slot right, both
  // tabular-nums so columns align across rows.
  const blocks = [];
  if (hours.length) {
    const lines = hours.map(h =>
      `<div class="pop-hours-line"><span class="pop-hours-day">${esc(h.range)}</span><span class="pop-hours-slot">${esc(h.slot)}</span></div>`
    ).join('');
    blocks.push(`<div class="pop-hours">${lines}</div>`);
  }

  const rows = [];
  if (poi?.phone) {
    const tel = poi.phone.replace(/[^+\d]/g, '');
    rows.push(['Phone', { html: `<a class="pop-link" href="tel:${esc(tel)}">${esc(poi.phone)}</a>` }]);
  }
  if (poi?.url) {
    const href = /^https?:\/\//.test(poi.url) ? poi.url : `https://${poi.url}`;
    const label = poi.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    rows.push(['Website', { html: `<a class="pop-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` }]);
  }

  return infoCard({
    accent,
    title: baseName,
    subtitle: address,
    pills,
    blocks,
    rows,
    footer: poi ? 'Live · TomTom POI Search' : 'Base-map POI · TomTom Reverse Geocoding',
  });
}

export default async function poi(ctx, uc) {
  const accent = ctx.caseColor(uc);
  const anchorQuery = paramFor(uc, 'anchor');

  /* Global search — anchor can be any address worldwide. */
  const anchorHit = (await geocode({ query: anchorQuery, limit: 1 }))[0];
  if (ctx.cancelled) return;
  const center = anchorHit?.position || [2.2945, 48.8584]; // Eiffel Tower fallback

  // The standard basemap ships the `3D - Building` extrusion layer
   // with `visibility: 'none'`. Flip it on for this case so the tilt
   // and zoom actually pay off — buildings get height (from the
   // `height` property in the buildings source-layer) and read as
   // shaded volumes instead of flat footprints.
  if (ctx.ml.getLayer('3D - Building')) {
    ctx.ml.setLayoutProperty('3D - Building', 'visibility', 'visible');
  }

  // Tilted, zoomed-in framing so the base-style 3D buildings show their
  // extrusion and the user can immediately see clickable POI labels.
  // Skip the camera move when the scene reruns for the SAME anchor —
  // a category toggle shouldn't yank the user back from wherever they
  // panned. New anchor (or first open) still frames as usual. We still
  // record the home target via markHome so the map's recenter button
  // can fly back to the anchor on demand.
  // 15.4 (not a round 15): the base-style 3D buildings fade in right
  // around z15, so resting exactly at 15 catches them mid-pop / half-
  // faded. Nudging slightly past the threshold lands on fully-formed
  // extrusions without zooming in much further.
  const homeCam = { center, zoom: 15.4, pitch: 45, bearing: -18 };
  if (lastFramedAnchor.get(uc.id) !== anchorQuery) {
    ctx.setView({ ...homeCam, animate: true });
    lastFramedAnchor.set(uc.id, anchorQuery);
  } else {
    ctx.markHome(homeCam);
  }

  /* --- Category filter (chip rail in Configure) -------------------- */
  // Apply the current selection to both POI vector layers. The base
  // style filter already constrains by `group`, so we tack on an `in`
  // filter at the end (preserves zoom-based visibility rules).
  const applyCategoryFilter = (selected) => {
    for (const layerId of ['POI', 'POI - Micro']) {
      if (!ctx.ml.getLayer(layerId)) continue;
      // Keep the original filter the basemap shipped with — we only add
      // a sibling clause so we can revert by overwriting our own copy.
      const orig = ctx.ml._origPoiFilter ??= {
        'POI':         ctx.ml.getFilter('POI'),
        'POI - Micro': ctx.ml.getFilter('POI - Micro'),
      };
      const next = selected.length
        ? ['all', orig[layerId], ['in', ['get', 'group'], ['literal', selected]]]
        : ['all', orig[layerId], ['==', ['get', 'group'], '__none__']]; // hide all
      ctx.ml.setFilter(layerId, next);
    }
  };

  const userPick = paramFor(uc, 'categories');
  // Repopulate the chip rail with the categories present in the loaded
  // POI vector tiles. We read from the SOURCE (not rendered) so our own
  // category filter doesn't shrink the available chip set — a user who
  // toggles "Eat & Drink" off must still see the chip to toggle it back
  // on. Accumulate across pans so chips don't flicker in/out.
  const seenGroups = new Set();
  const refreshChips = () => {
    if (ctx.cancelled) return;
    const feats = ctx.ml.querySourceFeatures('vectorTiles', { sourceLayer: 'poi' });
    for (const f of feats) {
      const g = f.properties?.group;
      if (g && GROUP_LABELS[g]) seenGroups.add(g);
    }
    const options = [...seenGroups]
      .sort((a, b) => GROUP_LABELS[a].localeCompare(GROUP_LABELS[b]))
      .map(g => ({ value: g, label: GROUP_LABELS[g] }));
    setDynamicOptions(uc, 'categories', options);
  };

  // First populate — wait for the basemap to settle so POI tiles are
  // actually rendered. After that, refresh on every pan/zoom so the
  // chip rail tracks "what's visible right now".
  let chipDebounce;
  const scheduleChipRefresh = () => {
    clearTimeout(chipDebounce);
    chipDebounce = setTimeout(refreshChips, 250);
  };
  ctx.ml.once('idle', () => {
    refreshChips();
    if (Array.isArray(userPick)) applyCategoryFilter(userPick);
  });
  ctx.on('moveend', scheduleChipRefresh);

  // If the user already picked a subset before this scene rerun (param
  // change reruns the scene), apply it now — the filter survives until
  // the idle handler refreshes the chip rail.
  if (Array.isArray(userPick)) applyCategoryFilter(userPick);

  /* --- Selected-POI highlight ------------------------------------- */
  // Re-draw the clicked POI's own base-style icon at ~1.8× on a layer
  // above the basemap so the active POI stands out from its neighbours
  // while its card is open. We reuse the base `POI` layer's icon-image
  // expression verbatim, so it's always the exact same glyph — just
  // bigger. The source/layer are tracked by ctx and torn down on swap.
  const HILITE = 'poi-selected';
  const baseIconImage = ctx.ml.getLayoutProperty('POI', 'icon-image');
  const baseIconSize  = ctx.ml.getLayoutProperty('POI', 'icon-size');
  ctx.addSource(HILITE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  ctx.addLayer({
    id: HILITE,
    type: 'symbol',
    source: HILITE,
    layout: {
      'icon-image': baseIconImage,
      'icon-size': scaleIconSize(baseIconSize, 1.8),
      // Always render the highlight — it must win over the base icon it
      // sits on top of, even where labels would normally collide.
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  const showHighlight = (lngLat, props) =>
    ctx.ml.getSource(HILITE)?.setData({
      type: 'Feature', geometry: { type: 'Point', coordinates: lngLat }, properties: props || {},
    });
  const clearHighlight = () =>
    ctx.ml.getSource(HILITE)?.setData({ type: 'FeatureCollection', features: [] });

  let activePopup = null;
  let lastFeatureKey = null;

  // Hover: pointer cursor when over a POI.
  ctx.on('mousemove', (e) => {
    const hit = ctx.ml.queryRenderedFeatures(e.point).find(isPoiFeature);
    ctx.ml.getCanvas().style.cursor = hit ? 'pointer' : '';
  });

  // Click: open an enriched infoCard at the POI. The base-style feature
  // gives us name+category instantly; reverseGeocode resolves the
  // address; poiSearch (scoped to the clicked POI's name within 80 m)
  // fills in phone, website and weekly hours when TomTom has them.
  ctx.on('click', async (e) => {
    const hit = ctx.ml.queryRenderedFeatures(e.point).find(isPoiFeature);
    if (!hit) return;

    const lngLat = featurePosition(hit, [e.lngLat.lng, e.lngLat.lat]);
    const key = `${lngLat[0].toFixed(5)}_${lngLat[1].toFixed(5)}_${featureName(hit)}`;
    if (key === lastFeatureKey && activePopup?.isOpen()) return;
    lastFeatureKey = key;

    if (activePopup) { try { activePopup.remove(); } catch {} }

    const name = featureName(hit) || 'Unnamed POI';
    const cat  = featureCategory(hit);

    // Immediate "loading" card — keeps the click feeling responsive
    // while reverseGeocode + poiSearch resolve in parallel. Created via
    // ctx.addPopup (not `new maplibregl.Popup`) so the context tracks it
    // and tears it down on scene swap — otherwise the card would linger
    // in the DOM after the user closes or switches the use case.
    const popup = ctx.addPopup(
      { closeButton: true, offset: 18 },
      lngLat,
      infoCard({
        accent, title: name,
        pills: [{ text: cat, tone: 'neutral' }],
        subtitle: 'Loading details…',
        footer: 'TomTom POI Search · TomTom Reverse Geocoding',
      }),
    );
    activePopup = popup;

    // Enlarge the clicked POI's own icon while its card is open. Copy the
    // feature's properties so the reused icon-image expression (which
    // reads `category` / `modality`) resolves to the same glyph. Drop the
    // highlight when the card is dismissed via its close button.
    showHighlight(lngLat, hit.properties);
    popup.on('close', clearHighlight);

    const [rev, hits] = await Promise.all([
      reverseGeocode({ point: lngLat }).catch(() => null),
      poiSearch({ query: name, center: lngLat, radius: 80, limit: 1, openingHours: true }).catch(() => []),
    ]);
    if (ctx.cancelled || !popup.isOpen()) return;

    popup.setHTML(richCard({
      accent,
      baseName: name,
      baseCat:  cat,
      address:  rev?.address || hits[0]?.address,
      poi:      hits[0],
    }));
  });

}
