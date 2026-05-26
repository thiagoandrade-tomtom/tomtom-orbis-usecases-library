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

  if (isMobile) {
    // Panel becomes a bottom sheet at this breakpoint — pad bottom heavily.
    return {
      top: 80, right: 32,
      bottom: panelVisible ? Math.round(window.innerHeight * 0.55) + 24 : 100,
      left: 32,
    };
  }
  /* Symmetric horizontal padding — content centres at the geometric
     screen centre regardless of whether the detail panel is open.
     Anything that falls behind the panel is hidden by its opaque
     surface, which the user explicitly accepted as a trade-off in
     return for a route/cluster that reads as visually centred on
     the page. The FAB column on the right gets the same 80px breath. */
  return {
    top: 80,
    right: 80,
    bottom: 60,
    left: 80,
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
    requestAnimationFrame(() => {
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
    });
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
  const layers  = new Set();
  const markers = new Set();
  const popups  = new Set();
  const hiddenLayers = new Map(); // base-style layer id → previous visibility
  const handlers = []; // [{ type, layerId, fn }]
  const disposers = []; // arbitrary cleanup callbacks run on teardown

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
    setLegend({ title, items } = {}) {
      const host = document.getElementById('map-legend');
      if (!host) return;
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
      for (const id of layers)  { try { mapLibreMap.getLayer(id)  && mapLibreMap.removeLayer(id); }  catch {} }
      for (const id of sources) { try { mapLibreMap.getSource(id) && mapLibreMap.removeSource(id); } catch {} }
      for (const m of markers)  { try { m.remove(); } catch {} }
      for (const p of popups)   { try { p.remove(); } catch {} }
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
