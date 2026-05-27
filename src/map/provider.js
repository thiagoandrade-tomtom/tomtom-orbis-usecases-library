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

import { TomTomMap } from '@tomtom-org/maps-sdk/map';
import { API_KEY, DEFAULT_VIEW, hasKey, MAP_LABEL_SCALE } from './config.js';
import { createSceneContext } from './scene-context.js';
import { applyLabelScale } from './label-scale.js';
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
        attributionControl: false,
        fadeDuration: 220,        // smoother tile cross-fade on style swaps
      },
    });

    this.mapLibreMap = this.map.mapLibreMap;
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
      this.#dropFadeWhenIdle();
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
    }

    if (this.activeCtx) this.activeCtx.teardown();
    this.home = null;
    const ctx = createSceneContext({
      map: this.map,
      mapLibreMap: this.mapLibreMap,
      onCamera: (cmd) => { this.home = cmd; },
    });
    this.activeCtx = ctx;

    try {
      await sceneFn(ctx, useCase);
    } catch (err) {
      if (!ctx.cancelled) console.error(`[scene:${useCase.mapType}]`, err);
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
      this.#dropFadeWhenIdle();
    }

    this.mapLibreMap.easeTo({
      center: DEFAULT_VIEW.center,
      zoom: DEFAULT_VIEW.zoom,
      bearing: 0,
      pitch: 0,
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
