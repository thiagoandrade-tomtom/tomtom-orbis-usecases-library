/* Sandbox handed to a scene module. Tracks every source / layer / marker
   the scene adds so we can tear them all down cleanly on the next swap.

   Scenes never touch maplibre directly except through this ctx — that
   guarantees no leaked layers between use-case switches, and gives us a
   single place to add cross-cutting concerns later (telemetry, layer
   prefixes, "before" insertion logic, etc). */

import maplibregl from 'maplibre-gl';
import { TrafficFlowModule, TrafficIncidentsModule } from '@tomtom-org/maps-sdk/map';
import { ACCENT } from '../data/use-cases.js';
import { createPin, ICONS } from '../render/marker.js';

/* Returns the screen-space padding MapLibre should respect when framing
   content with flyTo / fitBounds. Accounts for the floating UI (topbar,
   detail panel, bottom map controls) so the centroid of a route or area
   doesn't end up hidden behind a panel.

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
  const top = topbarRect ? Math.round(topbarRect.bottom) + 24 : 80;

  if (isMobile) {
    // Panel becomes a bottom sheet — reserve the space it actually covers.
    return {
      top,
      right: 32,
      bottom: panelRect ? Math.round(vh - panelRect.top) + 24 : 100,
      left: 32,
    };
  }
  /* Desktop: reserve the panel's real horizontal extent on the left so
     the framed content (route, cluster, markers) lands in the genuinely
     visible region beside the panel instead of hiding behind it. Clamped
     to 60% of the viewport so a wide/dragged panel can't squeeze the
     content box to nothing. The FAB + legend column lives on the right. */
  const left = panelRect
    ? Math.min(Math.round(panelRect.right) + 24, Math.round(vw * 0.6))
    : 80;
  return {
    top,
    right: 80,
    bottom: 60,
    left,
  };
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

export function createSceneContext({ map, mapLibreMap, onCamera, suppressCameraMoves = false }) {
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

  // Subtle "waiting on third-party services" indicator, shown in the
  // legend pill after a short delay so instant/cached loads never flash it.
  let loadingTimer = null;
  const clearLoadingTimer = () => { if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; } };

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

      // Pins anchor at the tip (bottom); circles/custom elements default to center.
      if (!mOpts.anchor) mOpts.anchor = mOpts.element ? 'bottom' : 'center';

      const m = new maplibregl.Marker(mOpts).setLngLat(lngLat).addTo(mapLibreMap);
      if (popupHTML) {
        const p = new maplibregl.Popup({ closeButton: false, offset: 18, ...(popupOpts || {}) })
          .setHTML(popupHTML);
        if (!suppressCameraMoves) autoPanPopup(mapLibreMap, p);
        m.setPopup(p);
        popups.add(p);
      }
      markers.add(m);
      return m;
    },

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
      const padding = opts.padding ?? safeInsets();
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

    /** Render the shared bottom-of-map legend. Each item is one of:
        { color: '#hex', label: '...', shape?: 'dot'|'bar'|'square' }
        { gradient: ['#a', '#b'], label: '...' }
        { html: '<svg…>', label: '...' }
        Items render left-to-right; whole legend hides if items is empty. */
    /** Show a subtle "still loading" indicator in the legend pill while a
        scene waits on third-party services. The map itself is already up;
        this just signals the overlay data is on its way. Delayed so fast
        or cached loads never flash it. Called by the provider around the
        scene run, so every case gets it for free; a scene calling
        setLegend (real data ready) supersedes it. No-op during camera-
        suppressed replays (theme / basemap swaps) — those reuse data. */
    beginLoading(label = 'Loading data…') {
      if (suppressCameraMoves) return;
      clearLoadingTimer();
      loadingTimer = setTimeout(() => {
        if (ctx.cancelled) return;
        const host = document.getElementById('map-legend');
        if (!host) return;
        host.classList.add('is-loading');
        host.innerHTML = `<span class="map-legend-spinner" aria-hidden="true"></span><span>${label}</span>`;
        host.hidden = false;
      }, 280);
    },
    endLoading() {
      clearLoadingTimer();
      if (ctx.cancelled) return;
      const host = document.getElementById('map-legend');
      if (host && host.classList.contains('is-loading')) {
        host.classList.remove('is-loading');
        host.hidden = true; host.innerHTML = '';
      }
    },

    setLegend({ title, items } = {}) {
      // A real legend supersedes the loading indicator.
      clearLoadingTimer();
      const host = document.getElementById('map-legend');
      if (!host) return;
      host.classList.remove('is-loading');
      if (!items || items.length === 0) { host.hidden = true; host.innerHTML = ''; return; }
      const parts = [];
      if (title) parts.push(`<span class="map-legend-title">${title}</span>`);
      for (const it of items) {
        let swatch = '';
        if (it.html) {
          swatch = it.html;
        } else if (it.gradient) {
          const [a, b] = it.gradient;
          swatch = `<span class="map-legend-swatch bar" style="background:linear-gradient(90deg, ${a} 0%, ${b} 100%);color:transparent;"></span>`;
        } else if (it.color) {
          const shape = it.shape === 'dot' ? 'dot' : it.shape === 'bar' ? 'bar' : '';
          swatch = `<span class="map-legend-swatch ${shape}" style="color:${it.color}"></span>`;
        }
        parts.push(`<span class="map-legend-item">${swatch}<span>${it.label}</span></span>`);
      }
      host.innerHTML = parts.join('');
      host.hidden = false;
      // Auto-clear on teardown.
      disposers.push(() => { host.hidden = true; host.innerHTML = ''; });
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

    /** Show TomTom's native Traffic Incidents — pictograms + segment
        highlights, integrated with the active map style. */
    async enableTrafficIncidents(config) {
      try {
        const mod = await TrafficIncidentsModule.get(map, config);
        if (ctx.cancelled) { try { mod.setVisible(false); } catch {} return; }
        mod.setVisible(true);
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
      clearLoadingTimer();
      // Drop any loading indicator this scene left in the legend pill.
      try {
        const host = document.getElementById('map-legend');
        if (host && host.classList.contains('is-loading')) {
          host.classList.remove('is-loading'); host.hidden = true; host.innerHTML = '';
        }
      } catch {}
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
      layers.clear(); sources.clear(); markers.clear(); popups.clear();
    },
  };

  return ctx;
}
