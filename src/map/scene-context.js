/* Sandbox handed to a scene module. Tracks every source / layer / marker
   the scene adds so we can tear them all down cleanly on the next swap.

   Scenes never touch maplibre directly except through this ctx — that
   guarantees no leaked layers between use-case switches, and gives us a
   single place to add cross-cutting concerns later (telemetry, layer
   prefixes, "before" insertion logic, etc). */

import * as maplibregl from 'maplibre-gl';
import { TrafficFlowModule, TrafficIncidentsModule } from '@tomtom-org/maps-sdk/map';
import { ACCENT } from '../data/use-cases.js';
import { incidentTip, INCIDENT_LAYER } from './hover-tips.js';
import { createPin, ICONS, STATEFUL_MARKER_CLASS, STATEFUL_POPUP_OFFSET } from '../render/marker.js';
import { setLoading, setError, clearStatus } from '../ui/status.js';
import { renderLegend, clearLegend } from '../ui/legend.js';
import { decorateSidePanel } from '../ui/side-panel.js';

/* Marker glyphs stick out past the coordinate they're pinned to, but
   fitBounds only knows about the coordinate. A standard teardrop pin is
   38×45 anchored at its tip, so a marker sitting exactly on the framed
   edge draws 45px above and 19px either side of the bound and gets
   clipped. Reserve that on top of the UI insets — every scene frames
   markers, so the allowance belongs in the global rule rather than in
   each scene's bbox math. Nothing is needed at the bottom: a
   bottom-anchored pin is drawn entirely above its anchor. */
const PIN_INSET = { top: 48, side: 20 };

/* Returns the screen-space padding MapLibre should respect when framing
   content with flyTo / fitBounds. Accounts for the floating UI (topbar,
   detail panel, bottom map controls) plus the marker overhang above, so
   the framed content lands fully inside the genuinely visible slice of
   map — never behind a panel and never half off the edge.

   Re-evaluated on every call — the detail panel can show / hide between
   scene swaps, so we can't capture it once at boot. */
function safeInsets() {
  const panel = document.getElementById('panel-detail');
  const panelVisible =
    panel?.classList.contains('is-visible') &&
    !panel.classList.contains('is-minimized');
  const isMobile = window.innerWidth <= 720;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  /* Measure the panel's live rect rather than hardcoding its width:
     it's draggable and resizable, so its position is only known at
     call time. getBoundingClientRect handles desktop (left rail) and
     mobile (bottom sheet) uniformly. */
  const panelRect = panelVisible ? panel.getBoundingClientRect() : null;

  /* Reserve the topbar's real height instead of a fixed 80px. The bar is
     a floating pill (top:16, height:56 → bottom ~72) but it grows when
     the search/mega menu opens, so measuring its live rect keeps a popup
     from sliding under it. +24px breathing room; fall back to 80 if the
     bar isn't in the DOM yet. */
  const topbar = document.querySelector('.topbar');
  const topbarRect = topbar?.getBoundingClientRect();
  const top = (topbarRect ? Math.round(topbarRect.bottom) + 24 : 80) + PIN_INSET.top;

  /* A scene side panel, when one is open, covers the right rail. Reserve
     its real width the same way we reserve the detail panel's on the left
     — a scene that moved its result card off the map to stop it covering
     the geometry gains nothing if fitBounds then frames that geometry
     underneath the panel instead. */
  const side = document.getElementById('map-side');
  // A card tucked away on a phone (ui/side-panel.js) has no box: treat it
  // as absent rather than as a zero-height rect at the viewport's top.
  const sideRect = side && !side.hidden && side.offsetHeight > 0 ? side.getBoundingClientRect() : null;

  if (isMobile) {
    // Panel becomes a bottom sheet — reserve the space it actually covers.
    // The side panel docks to the bottom too, above that sheet.
    const bottomCover = Math.max(
      panelRect ? Math.round(vh - panelRect.top) + 24 : 100,
      sideRect ? Math.round(vh - sideRect.top) + 24 : 0,
    );
    return {
      top,
      right: 32 + PIN_INSET.side,
      bottom: bottomCover,
      left: 32 + PIN_INSET.side,
    };
  }
  /* Desktop: reserve the panel's real horizontal extent on the left so
     the framed content (route, cluster, markers) lands in the genuinely
     visible region beside the panel instead of hiding behind it. Clamped
     to 60% of the viewport so a wide/dragged panel can't squeeze the
     content box to nothing. The FAB + legend column lives on the right. */
  const left = panelRect
    ? Math.min(Math.round(panelRect.right) + 24 + PIN_INSET.side, Math.round(vw * 0.6))
    : 80 + PIN_INSET.side;
  const right = sideRect
    ? Math.min(Math.round(vw - sideRect.left) + 24 + PIN_INSET.side, Math.round(vw * 0.5))
    : 80 + PIN_INSET.side;
  return {
    top,
    right,
    bottom: 60,
    left,
  };
}

/* safeInsets() measures against the VIEWPORT, which is the map's own box
   in the full-map layout. In the split layout on a phone the map is only
   the top 40% of the screen, so a bottom inset measured from the viewport
   (the side card, the sidebar below) can exceed the map's whole height —
   and MapLibre silently ignores a fitBounds whose padding leaves no room,
   leaving the camera wherever it was. Only when that happens, re-express
   the insets relative to the map container and cap them at 80% of it. */
function fitToContainer(pad, map) {
  const r = map.getContainer().getBoundingClientRect();
  if (pad.top + pad.bottom < r.height * 0.9 && pad.left + pad.right < r.width * 0.9) return pad;
  const vw = window.innerWidth, vh = window.innerHeight;
  const out = {
    top:    Math.max(16, pad.top - r.top),
    bottom: Math.max(16, pad.bottom - (vh - r.bottom)),
    left:   Math.max(16, pad.left - r.left),
    right:  Math.max(16, pad.right - (vw - r.right)),
  };
  const squeeze = (a, b, size) => {
    const k = (out[a] + out[b]) > size * 0.8 ? (size * 0.8) / (out[a] + out[b]) : 1;
    out[a] = Math.round(out[a] * k); out[b] = Math.round(out[b] * k);
  };
  squeeze('top', 'bottom', r.height);
  squeeze('left', 'right', r.width);
  return out;
}

/* When a popup opens, ensure its DOM rect fits inside the viewport — if
   not, pan the map by the overflow so the user actually sees the card.
   MapLibre positions the popup relative to the anchor and never reclamps,
   so a tall popup near a screen edge would otherwise be partially or
   fully offscreen. Uses `safeInsets()` so the popup also clears the
   detail panel and topbar, not just the raw viewport edges. */
function autoPanPopup(mapLibreMap, popup) {
  popup.on('open', () => {
    /* Wait until the map is idle before measuring overflow. Scene
       openers (route case opens 3 chip popups right after fitBounds)
       would otherwise trigger a panBy mid-fitBounds-animation — panBy
       cancels the in-flight easeTo and the camera gets stranded
       partway. Waiting for `idle` lets fitBounds settle first. */
    const measureAndPan = () => {
      const el = popup.getElement?.();
      if (!el) return;
      const r = el.getBoundingClientRect();
      const ins = safeInsets();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let dx = 0, dy = 0;
      if (r.left   < ins.left)        dx = r.left - ins.left;
      else if (r.right  > vw - ins.right)  dx = r.right - (vw - ins.right);
      if (r.top    < ins.top)         dy = r.top - ins.top;
      else if (r.bottom > vh - ins.bottom) dy = r.bottom - (vh - ins.bottom);
      if (dx || dy) mapLibreMap.panBy([dx, dy], { duration: 240 });

      /* Flag overflowing popups so the CSS bottom-fade kicks in — the
         fade is a visual hint that there's more content to scroll to. */
      const pop = el.querySelector('.pop');
      if (pop) {
        const updateScrollState = () => {
          const overflow = pop.scrollHeight > pop.clientHeight + 1;
          const atBottom = pop.scrollTop + pop.clientHeight >= pop.scrollHeight - 2;
          pop.classList.toggle('is-scrollable', overflow && !atBottom);
        };
        updateScrollState();
        pop.addEventListener('scroll', updateScrollState, { passive: true });
        /* Viewport resize changes max-height → may flip overflow on/off
           without a scroll event. Observe the pop itself. Cleaned up on
           popup close by MapLibre removing the element from the DOM. */
        const ro = new ResizeObserver(updateScrollState);
        ro.observe(pop);
        popup.once('close', () => ro.disconnect());
      }
    };
    /* If the map is mid-animation, wait for idle before measuring;
       otherwise (user click on a settled map) measure on the next frame. */
    if (mapLibreMap.isMoving?.() || mapLibreMap.isEasing?.() || mapLibreMap.isZooming?.()) {
      mapLibreMap.once('idle', () => requestAnimationFrame(measureAndPan));
    } else {
      requestAnimationFrame(measureAndPan);
    }
  });
}

export function createSceneContext({ map, mapLibreMap, onCamera, onRetry, suppressCameraMoves: initialSuppress = false }) {
  /* Replays (theme / basemap swaps) re-add the scene's layers without
     yanking the camera back to its home framing. That suppression is for
     the replayed boot only: the provider calls resumeCameraMoves() once
     the scene function resolves, so a click afterwards (select an area,
     a jam) frames its target again instead of silently doing nothing. */
  let suppressCameraMoves = initialSuppress;
  const sources = new Set();
  // Only the FIRST camera command of a scene is treated as "home" — later
  // setView calls (e.g. user clicks a marker) shouldn't redefine recenter.
  // `markHome` (with `{ force: true }`) is the exception: scenes use it to
  // overwrite the placeholder camera once they've computed the real frame
  // (e.g. an initial setView while routing data resolves, then fitBounds).
  let cameraRecorded = false;
  const recordCamera = (cmd, { force = false } = {}) => {
    if (!onCamera) return;
    if (cameraRecorded && !force) return;
    cameraRecorded = true;
    try { onCamera(cmd); } catch {}
  };
  /* MapLibre keeps a persistent `padding` on the transform: whatever you
     pass to flyTo / fitBounds stays set until the next command overrides
     it. But the camera methods COMPUTE their target center relative to the
     padding already on the transform, then apply the new padding on top —
     so an asymmetric inset (a wide left pad to clear the detail panel)
     gets counted twice and the framed content lands shifted to one side.

     A scene typically does exactly this: an initial setView with padding
     while data resolves, then a fitBounds with the same padding once the
     real geometry is known — double-shifting the route/cluster right. Zero
     the transform padding before every camera command so the new inset is
     applied once, from a clean slate. */
  const resetPadding = () =>
    mapLibreMap.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });

  const layers  = new Set();
  const markers = new Set();
  const popups  = new Set();
  const hiddenLayers = new Map(); // base-style layer id → previous visibility
  const handlers = []; // [{ type, layerId, fn }]
  const disposers = []; // arbitrary cleanup callbacks run on teardown
  let legendDisposer = false, sideDisposer = false;

  /* Hover tips — see map/hover-tips.js. One pointer card for the whole
     scene; entries are { layers: id[] | RegExp, html: feature => string|null }.
     Layers are matched against the live style on every move, so a tip can
     be registered before its layers exist (SDK modules add theirs async). */
  const tipEntries = [];
  let tipPopup = null, tipBound = false, tipCursor = false;
  // Matching layer ids, cached until the style or its layers change.
  let tipIds = null;
  const tipLayerIds = () => {
    if (tipIds) return tipIds;
    const style = mapLibreMap.getStyle()?.layers || [];
    tipIds = [];
    for (const e of tipEntries) {
      for (const l of style) {
        if (e.layers instanceof RegExp ? e.layers.test(l.id) : e.layers.includes(l.id)) tipIds.push(l.id);
      }
    }
    return tipIds;
  };
  const hideTip = () => {
    tipPopup?.remove(); tipPopup = null;
    if (tipCursor) { mapLibreMap.getCanvas().style.cursor = ''; tipCursor = false; }
  };
  const onTipMove = (e) => {
    const ids = tipLayerIds();
    const f = ids.length ? mapLibreMap.queryRenderedFeatures(e.point, { layers: ids })[0] : null;
    const entry = f && tipEntries.find(t => t.layers instanceof RegExp ? t.layers.test(f.layer.id) : t.layers.includes(f.layer.id));
    const html = entry ? entry.html(f, e.lngLat) : null;
    if (!html) { hideTip(); return; }
    if (!tipPopup) {
      tipPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'map-hover-popup', maxWidth: '280px' })
        .setLngLat(e.lngLat).setHTML(html).addTo(mapLibreMap);
    } else {
      tipPopup.setLngLat(e.lngLat).setHTML(html);
    }
    // Only take the cursor over when nothing else claimed it (a scene's own hover).
    if (!mapLibreMap.getCanvas().style.cursor) { mapLibreMap.getCanvas().style.cursor = 'help'; tipCursor = true; }
  };

  /* Depth-ordering for stateful markers. MapLibre's symbol layers do
     collision detection; DOM markers get none, so overlapping markers
     stack in whatever order the scene happened to add them — and a pin
     standing up buries whatever sits just south of it, at random.

     Ranking by projected screen Y turns that into depth: lower on screen
     reads as nearer, so it wins. The selected marker always beats the
     lot. Note this makes overlap orderly and stable across pans; it does
     not reduce it. Collapsing crowded neighbours into count pills was
     tried and rejected — it flattened the very thing these fields exist
     to show (per-marker colour spread across the map).

     Sorted on camera settle (a pure pan preserves relative screen order,
     rotation/pitch doesn't) and on every selection change. */
  const depthMarkers = new Set();
  let depthFrame = null;

  /* A ranked field opts out of depth-by-Y: when every marker carries a
     `data-rank`, rank 1 stacks on top and the last rank at the bottom,
     because in a "worst N" list the #1 must never hide under #9. */
  function restackMarkers() {
    depthFrame = null;
    if (!depthMarkers.size) return;
    const rows = [...depthMarkers]
      .map(m => {
        const el = m.getElement?.();
        if (!el) return null;
        const rank = el.dataset.rank != null ? Number(el.dataset.rank) : null;
        return { el, rank, y: rank == null ? mapLibreMap.project(m.getLngLat()).y : 0 };
      })
      .filter(Boolean);
    const byRank = rows.every(r => r.rank != null);
    const ranked = rows.sort(byRank ? (a, b) => b.rank - a.rank : (a, b) => a.y - b.y);
    /* Dots take ranks 1..N by depth; the selected marker tops the stack.
       Popups clear the whole range from CSS. */
    const top = ranked.length + 1;
    ranked.forEach(({ el }, i) => {
      el.style.zIndex = String(el.classList.contains('is-selected') ? top : i + 1);
    });
  }

  const scheduleRestack = () => {
    if (depthFrame == null) depthFrame = requestAnimationFrame(restackMarkers);
  };

  const ctx = {
    /** The wrapped TomTomMap. Use for SDK-specific modules (RoutingModule, PlacesModule, etc). */
    map,
    /** The raw MapLibre map. Use for addSource/addLayer/queryRenderedFeatures/etc. */
    ml: mapLibreMap,
    /** Becomes true when a newer scene supersedes this one. Async scenes must check it after every await. */
    cancelled: false,

    /** Pick the theme-appropriate accent variant. `dark` is used when the
        host document is in dark mode so markers/lines keep luminance
        contrast against the dark basemap; falls back to `main`.
        Accepts either a semantic accent name (string) or an inline
        `{ main, dark }` object — letting a single use case override its
        rendered colour without touching the semantic palette. */
    color(accent) {
      const a = typeof accent === 'string' ? ACCENT[accent] : accent;
      if (!a) return '#000';
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      return (dark && a.dark) ? a.dark : a.main;
    },
    soft(accent) {
      const a = typeof accent === 'string' ? ACCENT[accent] : accent;
      return a?.soft;
    },
    /** Resolve a use case's primary colour. If the use case defines
        `accentColor: { main, dark, soft? }`, that wins; otherwise we fall
        back to the semantic accent named in `uc.accent`. */
    caseColor(uc) { return ctx.color(uc?.accentColor || uc?.accent); },
    caseSoft(uc)  { return ctx.soft(uc?.accentColor || uc?.accent); },

    addSource(id, def) {
      if (mapLibreMap.getSource(id)) mapLibreMap.removeSource(id);
      mapLibreMap.addSource(id, def);
      sources.add(id);
    },

    addLayer(def, beforeId) {
      if (mapLibreMap.getLayer(def.id)) mapLibreMap.removeLayer(def.id);
      mapLibreMap.addLayer(def, beforeId);
      layers.add(def.id);
    },

    addMarker(opts, lngLat) {
      const { popupHTML, popupOpts, icon, ...mOpts } = opts || {};

      // Auto-generate TomTom-style pin when only a color is supplied.
      if (mOpts.color && !mOpts.element) {
        mOpts.element = createPin(mOpts.color, icon || 'dot');
        delete mOpts.color;
      }

      /* A stateful marker (createStatefulPin) is a zero-size origin that
         positions each of its two shapes itself, so it always anchors at
         the coordinate — overriding any anchor a caller passed, since
         'bottom' would push both shapes a full pin above the point. */
      const stateful = !!mOpts.element?.classList?.contains(STATEFUL_MARKER_CLASS);
      if (stateful) mOpts.anchor = 'center';
      // Pins anchor at the tip (bottom); circles/custom elements default to center.
      else if (!mOpts.anchor) mOpts.anchor = mOpts.element ? 'bottom' : 'center';

      const m = new maplibregl.Marker(mOpts).setLngLat(lngLat).addTo(mapLibreMap);
      if (popupHTML) {
        const offset = stateful ? STATEFUL_POPUP_OFFSET : 18;
        const p = new maplibregl.Popup({ closeButton: false, offset, ...(popupOpts || {}) })
          .setHTML(popupHTML);
        if (!suppressCameraMoves) autoPanPopup(mapLibreMap, p);
        m.setPopup(p);
        popups.add(p);
        /* Selection state rides on the popup MapLibre already toggles from
           the marker click, so every scene that passes popupHTML gets the
           round → pin morph just by switching marker factory. */
        if (stateful) {
          const root = mOpts.element;
          p.on('open',  () => { root.classList.add('is-selected');    scheduleRestack(); });
          p.on('close', () => { root.classList.remove('is-selected'); scheduleRestack(); });
        }
      }
      markers.add(m);
      /* Stateful markers are the crowded ones (POI fields), and the only
         ones that grow on selection — so they're what needs deterministic
         depth. Registered after creation so the first sort sees the element. */
      if (stateful) {
        depthMarkers.add(m);
        if (depthMarkers.size === 1) ctx.on('moveend', scheduleRestack);
        scheduleRestack();
      }
      return m;
    },

    /** Remove one marker the scene added — for layers that rebuild their
        markers on a data refresh. Drops it from depth ordering too. */
    removeMarker(m) {
      if (!m) return;
      try { m.remove(); } catch {}
      markers.delete(m);
      depthMarkers.delete(m);
      scheduleRestack();
    },

    /** Re-run stateful-marker stacking after the scene toggled
        `is-selected` itself (selection that isn't driven by a popup). */
    restack() { scheduleRestack(); },

    addPopup(opts, lngLat, html) {
      const p = new maplibregl.Popup({ closeButton: false, ...opts })
        .setLngLat(lngLat).setHTML(html);
      // During a theme-replay we re-add the same popups the user already
      // saw — letting them auto-pan again would yank the camera away from
      // the view they had pre-toggle.
      if (!suppressCameraMoves) autoPanPopup(mapLibreMap, p);
      p.addTo(mapLibreMap);
      popups.add(p);
      return p;
    },

    setView({ center, zoom, bearing = 0, pitch = 0, animate = true, padding }) {
      const opts = { center, zoom, bearing, pitch };
      opts.padding = padding ?? safeInsets();
      recordCamera({ kind: 'view', center, zoom, bearing, pitch });
      if (suppressCameraMoves) return;
      resetPadding();
      mapLibreMap[animate ? 'flyTo' : 'jumpTo'](opts);
    },

    /** End a replay's camera suppression — see `suppressCameraMoves`. */
    resumeCameraMoves() { suppressCameraMoves = false; },

    /** Record a "home" camera target for the recenter button without
        actually moving the map. Useful when a scene reruns (e.g. the
        user toggled a filter) and you want the recenter button to keep
        working — but you don't want to yank the user back from whatever
        they panned to. */
    markHome({ center, zoom, bearing = 0, pitch = 0 }) {
      recordCamera({ kind: 'view', center, zoom, bearing, pitch }, { force: true });
    },

    markHomeBounds(bounds, opts = {}) {
      recordCamera({ kind: 'bounds', bounds, opts }, { force: true });
    },

    fitBounds(bounds, opts = {}) {
      const padding = opts.padding ?? fitToContainer(safeInsets(), mapLibreMap);
      recordCamera({ kind: 'bounds', bounds, opts: { ...opts } });
      if (suppressCameraMoves) return;
      resetPadding();
      mapLibreMap.fitBounds(bounds, { duration: 900, ...opts, padding });
    },

    /** Register a MapLibre event handler that auto-detaches on teardown. */
    on(type, layerIdOrFn, maybeFn) {
      const fn = maybeFn || layerIdOrFn;
      const layerId = maybeFn ? layerIdOrFn : null;
      if (layerId) mapLibreMap.on(type, layerId, fn);
      else mapLibreMap.on(type, fn);
      handlers.push({ type, layerId, fn });
    },

    /** Register cleanup for anything the ctx can't track itself — timers,
        document-level listeners, classes a scene put on <html>. Runs on
        teardown, alongside the ctx's own disposers. */
    onTeardown(fn) {
      if (typeof fn === 'function') disposers.push(fn);
    },

    /** Loading and errors go to the shared map status pill (ui/status.js)
        — never a scene's own spinner, popup or card. The provider wraps
        every scene run in beginLoading/endLoading, so each case gets it for
        free; a scene calls beginLoading itself only to say what it waits on
        (`Finding jams in Paris…`) or to report `progress` (0–1). Calling it
        again updates the pill in place. Replays (theme / basemap swaps)
        reuse their data, so they stay quiet. */
    beginLoading(label = 'Loading data…', { progress } = {}) {
      if (suppressCameraMoves || ctx.cancelled) return;
      setLoading(ctx, label, { progress });
    },
    endLoading() {
      clearStatus(ctx, 'loading');
    },
    /** Report a failure the user should know about. `detail` is a short
        second line (the reason, what to try). `retry` defaults to re-running
        the whole scene; pass `false` when retrying can't help (bad input),
        or a function for a narrower retry. Cleared on teardown. */
    showError(message, { detail, retry = true } = {}) {
      if (ctx.cancelled) return;
      const fn = typeof retry === 'function' ? retry : retry ? onRetry : null;
      setError(ctx, message, { detail, onRetry: fn || undefined });
    },

    /** Fill the shared legend — a card behind the legend button in the
        map-control column (ui/legend.js). Each item is one of:
        { color: '#hex', label: '...', shape?: 'dot'|'bar'|'square' }
        { gradient: ['#a', '#b'], label: '...' }
        { html: '<svg…>', label: '...' }
        Items stack one per row; keep labels short. Empty items hide it. */
    setLegend({ title, items } = {}) {
      renderLegend({ title, items });
      // Auto-clear on teardown — registered once, however often a scene
      // re-renders its legend.
      if (!legendDisposer) {
        legendDisposer = true;
        disposers.push(clearLegend);
      }
    },

    /** Fill the right-rail side panel with scene HTML. For results too
        tall or too data-dense to sit in a map popup without covering the
        geometry they describe — the panel never overlaps the map content,
        because safeInsets() reserves its width for fitBounds.

        Pass no arguments (or an empty string) to hide it. Content is
        replaced wholesale, so a scene can call this on every selection.
        Auto-clears on scene teardown. Layout shells that don't render a
        `#map-side` host (embeds) make this a silent no-op, exactly like
        setLegend. */
    setSidePanel(html) {
      const host = document.getElementById('map-side');
      if (!host) return;
      if (!html) { host.hidden = true; host.innerHTML = ''; return; }
      host.innerHTML = html;
      host.hidden = false;
      // Phones: the column's show / hide button and the scroll cue
      // (ui/side-panel.js).
      decorateSidePanel(host);
      // Reset the scroll position between selections — otherwise the next
      // area's card opens scrolled to wherever the last one was read to.
      host.scrollTop = 0;
      // Once per ctx: a live board re-renders this on every step / refresh.
      if (!sideDisposer) {
        sideDisposer = true;
        disposers.push(() => { host.hidden = true; host.innerHTML = ''; });
      }
    },

    /** Show TomTom's native Traffic Flow on the basemap — vector layer
        styled to match the active map theme (not the legacy raster tiles).
        Backed by the SDK's TrafficFlowModule. */
    async enableTrafficFlow(config) {
      try {
        const mod = await TrafficFlowModule.get(map, config);
        if (ctx.cancelled) { try { mod.setVisible(false); } catch {} return; }
        mod.setVisible(true);
        disposers.push(() => { try { mod.setVisible(false); } catch {} });
      } catch (err) {
        console.warn('[traffic-flow]', err.message);
      }
    },

    /** Load the SDK's traffic-flow source without showing its overlay —
        for scenes that draw their own layer from the flow tiles
        (`vectorTilesFlow`, source-layer "Traffic flow"). Resolves true
        once the source exists. Nothing to undo: the module stays hidden. */
    async ensureTrafficFlowSource(config) {
      try {
        const mod = await TrafficFlowModule.get(map, config);
        try { mod.setVisible(false); } catch {}
      } catch (err) {
        console.warn('[traffic-flow source]', err.message);
      }
      return !!mapLibreMap.getSource('vectorTilesFlow');
    },

    /** Hover tips for map features — site-wide pattern, see
        map/hover-tips.js. `entries`: [{ layers: id[] | RegExp, html(feature, lngLat) }].
        Earlier entries win where layers overlap. */
    hoverTips(entries) {
      tipEntries.push(...entries);
      tipIds = null;
      if (tipBound) return;
      tipBound = true;
      ctx.on('styledata', () => { tipIds = null; });
      ctx.on('mousemove', onTipMove);
      ctx.on('mouseout', hideTip);
      ctx.on('movestart', hideTip);
      disposers.push(() => { hideTip(); tipEntries.length = 0; tipIds = null; tipBound = false; });
    },

    /** Show TomTom's native Traffic Incidents — pictograms + segment
        highlights, integrated with the active map style. Every incident
        explains itself on hover (description, delay, until when). */
    async enableTrafficIncidents(config) {
      try {
        const mod = await TrafficIncidentsModule.get(map, config);
        if (ctx.cancelled) { try { mod.setVisible(false); } catch {} return; }
        mod.setVisible(true);
        ctx.hoverTips([{ layers: INCIDENT_LAYER, html: f => incidentTip(f.properties || {}) }]);
        disposers.push(() => { try { mod.setVisible(false); } catch {} });
      } catch (err) {
        console.warn('[traffic-incidents]', err.message);
      }
    },

    /** Ensure any `fill-extrusion` layers in the base style are visible.
        TomTom's standard styles ship with a 3D Buildings layer that only
        reads on a pitched camera — pair this with a non-zero `pitch` in
        setView to make the city skyline pop. */
    enable3DBuildings() {
      const all = mapLibreMap.getStyle()?.layers || [];
      for (const lyr of all) {
        if (lyr.type !== 'fill-extrusion') continue;
        try { mapLibreMap.setLayoutProperty(lyr.id, 'visibility', 'visible'); } catch {}
      }
    },

    /** Hide base-style layers whose id/source-layer matches the predicate.
        Originals are restored on teardown. Useful for scenes that overlay
        their own POIs and want to avoid double-labeling with the base map. */
    hideLayers(predicate) {
      const all = mapLibreMap.getStyle()?.layers || [];
      for (const lyr of all) {
        if (hiddenLayers.has(lyr.id)) continue;
        if (!predicate(lyr)) continue;
        const prev = (lyr.layout && lyr.layout.visibility) || 'visible';
        hiddenLayers.set(lyr.id, prev);
        try { mapLibreMap.setLayoutProperty(lyr.id, 'visibility', 'none'); } catch {}
      }
    },

    teardown() {
      ctx.cancelled = true;
      // Drop any loading / error state this scene left in the status pill.
      clearStatus(ctx);
      for (const id of layers)  { try { mapLibreMap.getLayer(id)  && mapLibreMap.removeLayer(id); }  catch {} }
      for (const id of sources) { try { mapLibreMap.getSource(id) && mapLibreMap.removeSource(id); } catch {} }
      for (const m of markers)  { try { m.remove(); } catch {} }
      for (const p of popups)   { try { p.remove(); } catch {} }
      /* Safety net: a scene that opens a popup directly (new maplibregl.
         Popup().addTo(...)) instead of via ctx.addPopup wouldn't be in
         `popups`, so it would survive the swap and linger on the map.
         Sweep any popup elements still parented to the map container so
         no orphaned card outlives its scene. */
      try {
        const container = mapLibreMap.getContainer?.();
        container?.querySelectorAll('.maplibregl-popup')
          .forEach(el => { try { el.remove(); } catch {} });
      } catch {}
      for (const d of disposers) { try { d(); } catch {} }
      disposers.length = 0;
      for (const h of handlers) {
        try {
          if (h.layerId) mapLibreMap.off(h.type, h.layerId, h.fn);
          else mapLibreMap.off(h.type, h.fn);
        } catch {}
      }
      handlers.length = 0;
      try { mapLibreMap.getCanvas().style.cursor = ''; } catch {}
      for (const [id, prev] of hiddenLayers) {
        try { mapLibreMap.setLayoutProperty(id, 'visibility', prev); } catch {}
      }
      hiddenLayers.clear();
      /* Drop the queued restack too — its moveend handler is already gone
         with `handlers`, but a frame in flight would otherwise run against
         markers that no longer exist and hold their elements alive. */
      if (depthFrame != null) { cancelAnimationFrame(depthFrame); depthFrame = null; }
      depthMarkers.clear();
      layers.clear(); sources.clear(); markers.clear(); popups.clear();
    },
  };

  return ctx;
}
