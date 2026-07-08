/* MapProvider — owns the TomTomMap lifecycle and orchestrates scene swaps.

   Design goals:
   - One TomTomMap instance for the life of the page (creating/destroying maps
     is expensive — a single instance handles re-styling and scene swaps fine).
   - Scenes are plain async functions `(ctx, useCase) => void`. They never call
     map APIs directly; they go through the SceneContext which tracks resources.
   - Theme switches re-style without tearing down the active scene; the scene
     is re-applied after the style load so layers/sources persist conceptually.
   - A surface-coloured fade veil is held over the map during initial load and
     theme swaps, so the user never sees the bare-tile flash that MapLibre's
     setStyle exposes mid-transition.
   - Token-based cancellation: if a user clicks two cases in fast succession,
     the older scene's async work is short-circuited before it touches the map. */

import { TomTomMap, BaseMapModule } from '@tomtom-org/maps-sdk/map';
import { API_KEY, DEFAULT_VIEW, hasKey, MAP_LABEL_SCALE } from './config.js';
import { createSceneContext } from './scene-context.js';
import { applyLabelScale } from './label-scale.js';
import { LandmarksController } from './landmarks.js';
import { basemapFor } from '../state.js';

/* Concrete TomTom Orbis style IDs by family + theme. A use case can opt
   into a non-default family via `mapStyle` (e.g. `'driving'` for routing
   cases, `'mono'` for data viz, `'satellite'` for outdoor / terrain).
   `satellite` is theme-agnostic — TomTom ships a single imagery style. */
const STYLE_FAMILY = {
  standard:  { light: 'standardLight', dark: 'standardDark' },
  driving:   { light: 'drivingLight',  dark: 'drivingDark'  },
  mono:      { light: 'monoLight',     dark: 'monoDark'     },
  satellite: { light: 'satellite',     dark: 'satellite'    },
};

function styleId(family, theme) {
  const fam = STYLE_FAMILY[family] || STYLE_FAMILY.standard;
  return fam[theme] || fam.light;
}

const STYLE = STYLE_FAMILY.standard;

export class MapProvider {
  constructor({ container, theme = 'dark' }) {
    if (!hasKey) {
      throw new Error('MapProvider requires VITE_TOMTOM_API_KEY in .env');
    }

    this.theme = theme;
    this.activeFamily = 'standard';   // current style family — drives theme-toggle picks
    this.fade  = document.getElementById('stage-fade');
    document.documentElement.setAttribute('data-map-family', this.activeFamily);

    this.map = new TomTomMap({
      key: API_KEY,
      style: STYLE[theme],
      /* Default to English labels worldwide. TomTom otherwise renders
         each region in its native script (Arabic in the Gulf, Cyrillic
         in Russia, etc.), which is correct cartography but makes the
         picker useless when the user is looking for "Dubai" and sees
         دبي. Falls back to the local name when no English exists. */
      language: 'en-GB',
      mapLibre: {
        container,
        center: DEFAULT_VIEW.center,
        zoom: DEFAULT_VIEW.zoom,
        pitch: DEFAULT_VIEW.pitch,
        attributionControl: false,
        fadeDuration: 220,        // smoother tile cross-fade on style swaps
        /* Globe projection — MapLibre 5 renders the earth as a sphere at
           low zooms and smoothly transitions to flat Mercator above zoom
           ~4, so every existing case (which opens at zoom 11+) looks
           identical to before. The globe only matters in the idle/empty
           state before a case is selected. */
        projection: { type: 'globe' },
      },
    });

    this.mapLibreMap = this.map.mapLibreMap;
    /* 3D landmark meshes (Orbis Private Preview). Base-map level: ON by
       default in every use case, mirroring the base style's 3D buildings
       (which are visible by default and only hidden when the user switches
       to 2D). We enable it once the map is ready — that kicks off the
       lazy plugin+three.js import in the background. The compass 2D/3D
       button then hides/shows it alongside buildings3D. The plugin restores
       itself across style swaps, so it lives outside the scene teardown
       cycle; we still re-assert visibility after each swap to be safe. */
    this.landmarks = new LandmarksController(this.map);
    this.landmarksOn = true;
    this.activeCtx = null;
    this.lastScene = null;        // { sceneFn, useCase } — replayed after style swaps
    this.home = null;             // Camera target the active scene framed on first setView/fitBounds.

    this.ready = new Promise(resolve => {
      if (this.map.mapReady) resolve();
      else this.mapLibreMap.once('load', () => resolve());
    });

    // After the first idle (tiles painted + no in-flight transitions),
    // drop the loading veil. Two RAFs let the first painted frame settle
    // before we start the opacity transition.
    this.ready.then(() => {
      applyLabelScale(this.mapLibreMap, MAP_LABEL_SCALE);
      this.#applyGlobe();
      this.#dropFadeWhenIdle();
      /* Turn landmarks on now so they're present in every use case. They
         only render at zoom ≥15, so this is a no-op at the idle globe view
         and fades in the moment a case zooms to street level. */
      this.landmarks.setVisible(this.landmarksOn);
      /* Dev-only inspector hatch — lets DevTools poke at the provider
         (jumpTo, layer queries, BaseMapModule). Stripped from prod by
         Vite's `import.meta.env.DEV` substitution. */
      if (import.meta.env.DEV) {
        try { window.__provider = this; } catch {}
      }
    });
  }

  /** Swap to a new scene. Tears down the previous one cleanly. If the
      use case requests a different basemap family (via `mapStyle`), the
      style swap happens BEFORE the scene runs so the new scene paints
      onto the right basemap. */
  async setScene(sceneFn, useCase) {
    await this.ready;
    this.lastScene = { sceneFn, useCase };

    const wantFamily = basemapFor(useCase);
    const styleSwapped = wantFamily !== this.activeFamily;
    if (styleSwapped) {
      this.fade?.classList.add('is-active');
      await new Promise(r => requestAnimationFrame(r));
      this.map.setStyle(styleId(wantFamily, this.theme));
      await new Promise(res => this.mapLibreMap.once('styledata', res));
      this.activeFamily = wantFamily;
      document.documentElement.setAttribute('data-map-family', this.activeFamily);
      applyLabelScale(this.mapLibreMap, MAP_LABEL_SCALE);
      this.#applyGlobe();
      this.#reapplyBuildings3D();
      this.#reapplyLandmarks();
    }

    if (this.activeCtx) this.activeCtx.teardown();
    this.home = null;
    /* Flatten the projection back to Mercator before the scene runs.
       Globe projection breaks MapLibre's fitBounds (`cameraForBoxAnd-
       Bearing` throws), which would kill any case that frames itself
       via bounds — i.e. almost all of them. At case-level zooms the
       difference between globe and Mercator is invisible anyway. */
    this.#applyMercator();
    /* Reset pitch/bearing before the scene runs. Most cases call
       fitBounds (which doesn't touch pitch) so the 41° tilt from the
       idle globe view would otherwise bleed into every case. Scenes
       that genuinely want a tilted camera (POI, fleet, etc.) call
       ctx.setView with an explicit pitch — those still win because
       this reset happens BEFORE the scene runs. */
    this.mapLibreMap.jumpTo({ pitch: 0, bearing: 0 });
    const ctx = createSceneContext({
      map: this.map,
      mapLibreMap: this.mapLibreMap,
      onCamera: (cmd) => { this.home = cmd; },
    });
    this.activeCtx = ctx;

    ctx.beginLoading();
    try {
      await sceneFn(ctx, useCase);
    } catch (err) {
      if (!ctx.cancelled) console.error(`[scene:${useCase.mapType}]`, err);
    } finally {
      ctx.endLoading();
    }

    if (styleSwapped) this.#dropFadeWhenIdle();
  }

  /** Tear down the active scene and return the map to its initial empty
      state — standard basemap family, default camera, no overlays. Used
      when the user dismisses the detail panel. */
  async clearScene() {
    await this.ready;

    if (this.activeCtx) this.activeCtx.teardown();
    this.activeCtx = null;
    this.lastScene = null;
    this.home = null;

    const wantFamily = 'standard';
    if (wantFamily !== this.activeFamily) {
      this.fade?.classList.add('is-active');
      await new Promise(r => requestAnimationFrame(r));
      this.map.setStyle(styleId(wantFamily, this.theme));
      await new Promise(res => this.mapLibreMap.once('styledata', res));
      this.activeFamily = wantFamily;
      document.documentElement.setAttribute('data-map-family', this.activeFamily);
      applyLabelScale(this.mapLibreMap, MAP_LABEL_SCALE);
      this.#reapplyBuildings3D();
      this.#reapplyLandmarks();
      this.#dropFadeWhenIdle();
    }

    /* Restore the globe projection now that no case needs Mercator-only
       fitBounds. lastScene is already null above so the guard inside
       #applyGlobe will let this through. */
    this.#applyGlobe();

    this.mapLibreMap.easeTo({
      center:  DEFAULT_VIEW.center,
      zoom:    DEFAULT_VIEW.zoom,
      bearing: 0,
      pitch:   DEFAULT_VIEW.pitch ?? 0,
      duration: 600,
    });
  }

  /** Snapshot of what the developer sees right now — used by the
      Quickstart snippet and the agent Prompt so the values they copy
      match the live map (style ID, camera center, zoom). */
  getCurrentView() {
    const c = this.mapLibreMap?.getCenter?.();
    const z = this.mapLibreMap?.getZoom?.();
    return {
      style: styleId(this.activeFamily, this.theme),
      center: c ? [Number(c.lng.toFixed(4)), Number(c.lat.toFixed(4))] : DEFAULT_VIEW.center,
      zoom: typeof z === 'number' ? Number(z.toFixed(1)) : DEFAULT_VIEW.zoom,
    };
  }

  /** Swap the basemap style. Re-applies the active scene after the style finishes loading. */
  async setTheme(theme) {
    this.theme = theme;
    await this.ready;
    this.fade?.classList.add('is-active');

    // Yield one frame so the opacity transition starts *before* MapLibre's
    // synchronous setStyle work begins to hammer the main thread.
    await new Promise(r => requestAnimationFrame(r));

    this.map.setStyle(styleId(this.activeFamily, theme));
    await new Promise(res => this.mapLibreMap.once('styledata', res));
    applyLabelScale(this.mapLibreMap, MAP_LABEL_SCALE);
    this.#applyGlobe();
    this.#reapplyBuildings3D();
    this.#reapplyLandmarks();

    if (this.lastScene) {
      // Layers/sources were wiped by the style swap — re-add them. The
      // scene's setView/fitBounds calls only record the home camera for
      // recenter; they don't actually move the map, so whatever the user
      // had panned/zoomed to before the toggle stays in frame.
      const { sceneFn, useCase } = this.lastScene;
      if (this.activeCtx) this.activeCtx.teardown();
      this.home = null;
      const ctx = createSceneContext({
        map: this.map,
        mapLibreMap: this.mapLibreMap,
        onCamera: (cmd) => { this.home = cmd; },
        suppressCameraMoves: true,
      });
      this.activeCtx = ctx;
      try { await sceneFn(ctx, useCase); } catch (err) { console.error('[scene replay]', err); }
    }

    this.#dropFadeWhenIdle();
  }

  /** Swap the basemap family (standard / driving / mono / satellite)
      without losing the user's pan/zoom or the active scene's overlays.
      Mirrors `setTheme` — the scene replays under the new style with
      camera moves suppressed so the user is comparing the SAME data on
      a different basemap, not bouncing back to the case's home view. */
  async setStyleFamily(family) {
    if (family === this.activeFamily) return;
    await this.ready;
    this.activeFamily = family;
    document.documentElement.setAttribute('data-map-family', family);
    this.fade?.classList.add('is-active');

    await new Promise(r => requestAnimationFrame(r));
    this.map.setStyle(styleId(family, this.theme));
    await new Promise(res => this.mapLibreMap.once('styledata', res));
    applyLabelScale(this.mapLibreMap, MAP_LABEL_SCALE);
    this.#applyGlobe();
    this.#reapplyBuildings3D();
    this.#reapplyLandmarks();

    if (this.lastScene) {
      const { sceneFn, useCase } = this.lastScene;
      if (this.activeCtx) this.activeCtx.teardown();
      this.home = null;
      const ctx = createSceneContext({
        map: this.map,
        mapLibreMap: this.mapLibreMap,
        onCamera: (cmd) => { this.home = cmd; },
        suppressCameraMoves: true,
      });
      this.activeCtx = ctx;
      try { await sceneFn(ctx, useCase); } catch (err) { console.error('[scene replay]', err); }
    }

    this.#dropFadeWhenIdle();
  }

  /** Map-control conveniences for the topbar / zoom buttons. */
  zoomIn()  { this.mapLibreMap.zoomIn(); }
  zoomOut() { this.mapLibreMap.zoomOut(); }
  resetBearing() { this.mapLibreMap.resetNorth(); }

  /** Compass button action — two semantics behind one click:

        bearing != 0         → reset to north (wins; user rotated off
                               north, getting back is the priority)
        bearing == 0         → toggle pitch (2D ↔ 3D)

      The icon in mapctls.js mirrors this: a rotating ↑N when rotated,
      otherwise text "2D" or "3D" announcing what the click will do.
      The 2D/3D toggle ALSO flips TomTom's 3D building / landmark
      layers, so the tilt reveals the real depth of the city instead
      of just looking at a tilted flat texture. */
  cycleCompass() {
    const m = this.mapLibreMap;
    const pitch = m.getPitch();
    const bearing = m.getBearing();
    const TILT = DEFAULT_VIEW.pitch ?? 41;
    if (Math.abs(bearing) > 1) {
      m.easeTo({ bearing: 0, duration: 500 });
    } else if (pitch > 1) {
      m.easeTo({ pitch: 0, duration: 500 });
      this.#setBuildings3D(false);
      this.landmarksOn = false;
      this.landmarks.setVisible(false);
    } else {
      m.easeTo({ pitch: TILT, duration: 500 });
      this.#setBuildings3D(true);
      this.landmarksOn = true;
      this.landmarks.setVisible(true);
    }
  }

  /** Toggle TomTom Orbis's `buildings3D` layer group — that group
      includes both generic extruded buildings AND the bespoke 3D mesh
      models for landmarks (Eiffel Tower, Big Ben, Burj Khalifa, etc.),
      which fill-extrusion alone misses because landmarks ship as
      separate model layers in the style.

      Uses the official `BaseMapModule` instead of manually flipping
      visibility on layers we find: the module owns the group
      definitions, knows about model layers, and persists its state
      across `setStyle` calls (so a theme toggle no longer wipes the
      3D buildings the user just enabled).

      `BaseMapModule.get` is a memoised async getter — first call
      initialises, subsequent calls return the same instance. We track
      `this.buildings3DOn` so style-swap re-applies (theme toggle,
      basemap family change) can restore whatever the user picked.
      No short-circuit: setVisible is cheap and the SDK is the source
      of truth, not our cached flag. */
  async #setBuildings3D(visible) {
    this.buildings3DOn = visible;
    try {
      const mod = await BaseMapModule.get(this.map);
      mod.setVisible(visible, {
        layerGroups: { mode: 'include', names: ['buildings3D'] },
      });
    } catch (err) {
      console.warn('[buildings3D]', err.message);
    }
  }

  /** Re-apply whatever buildings-3D state the user last picked. Called
      after every style swap (theme, basemap family, scene change) so
      the SDK module gets a fresh setVisible against the new style. */
  #reapplyBuildings3D() {
    if (this.buildings3DOn === undefined) return;     // never toggled
    this.#setBuildings3D(this.buildings3DOn);
  }

  /** Re-assert landmark visibility after a style swap. The plugin restores
      itself across setStyle, but re-calling setVisible is cheap and keeps
      our intent authoritative regardless of the plugin's internal timing. */
  #reapplyLandmarks() {
    this.landmarks.setVisible(this.landmarksOn);
  }

  /** Re-frame the active use case. Replays the first camera command the
      scene issued (setView or fitBounds) so the user lands back on the
      case context, not their browser geolocation. */
  recenter() {
    const h = this.home;
    if (!h) return;
    if (h.kind === 'view') {
      this.activeCtx?.setView({ center: h.center, zoom: h.zoom, bearing: h.bearing, pitch: h.pitch, animate: true });
    } else if (h.kind === 'bounds') {
      this.activeCtx?.fitBounds(h.bounds, h.opts);
    }
  }

  /** Re-apply globe projection + atmosphere after every style swap.
      Every `setStyle` re-resolves the projection from the style JSON,
      which the TomTom Orbis styles declare as Mercator — so without
      this hook, a theme toggle or basemap-family swap reverts the
      planet to flat.
      Important: globe is only safe when no scene is active. MapLibre's
      `fitBounds` throws `cameraForBoxAndBearing` errors in globe mode,
      which kills any scene that calls fitBounds (most of ours do).
      So we only paint the globe in the idle/empty state — once a case
      runs, the projection swaps to mercator and stays there until the
      panel is dismissed. */
  /** Switch back to Mercator for the duration of a case. setProjection
      to mercator also clears the globe atmosphere (sky returns to default).
      No-op if MapLibre's setProjection isn't available. */
  #applyMercator() {
    try { this.mapLibreMap.setProjection?.({ type: 'mercator' }); } catch (err) { console.warn('[mercator]', err); }
  }

  #applyGlobe() {
    const m = this.mapLibreMap;
    /* Skip if a case is active — that's the responsibility of #applyMercator. */
    if (this.lastScene) return;
    try { m.setProjection?.({ type: 'globe' }); } catch (err) { console.warn('[globe] projection', err); }
    /* Pull space/horizon colours from CSS so theme switches re-paint the
       atmosphere without us hardcoding two palettes here. */
    const root = getComputedStyle(document.documentElement);
    const deep    = root.getPropertyValue('--map-space-deep').trim()    || '#0c1422';
    const horizon = root.getPropertyValue('--map-space-horizon').trim() || '#3a6ba3';
    try {
      m.setSky?.({
        'sky-color':         deep,
        'sky-horizon-blend': 0.65,
        'horizon-color':     horizon,
        'horizon-fog-blend': 0.5,
        'fog-color':         deep,
        'fog-ground-blend':  0.6,
        'atmosphere-blend':  0.85,
      });
    } catch (err) { console.warn('[globe] sky', err); }
  }

  /** Wait until the map is idle (tiles loaded, no transitions), then fade
      back in. Falls back to a short timeout if `idle` doesn't fire quickly
      (e.g. when there's no scene to wait on). */
  #dropFadeWhenIdle() {
    if (!this.fade) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this.mapLibreMap.off('idle', finish);
      requestAnimationFrame(() => this.fade.classList.remove('is-active'));
    };
    this.mapLibreMap.once('idle', finish);
    // Safety net: never leave the veil up longer than 900 ms.
    setTimeout(finish, 900);
  }
}
