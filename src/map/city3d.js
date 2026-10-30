/* City 3D — the landmarks plugin's two Public Preview renderers:

   - Buildings3D: the base map's buildings drawn with three.js —
     procedural facades with windows, a sun or moon that casts shadows,
     lit windows on dark styles, glass reflections. It takes over the
     style's `3D - Building` layer while visible (by composing `false`
     into its filter) and hands it back when hidden.

   - GLSurfaces: WebGL materials on the style's water, land cover, paving
     and roads, plus 3D trees on the green, in the style's own colours and
     the map's light. Its wind keeps the map redrawing every frame while
     it's on (`wind.speedFactor: 0` stills it).

   A scene opts in through `ctx.enableCity3D` — today only Discover
   Places, where the map itself is the subject; over traffic and routes
   they compete with the data. The debug keys (`G` buildings, `W`
   surfaces) flip whatever the scene asked for, so any case can be A/B'd.

   A scene can also pin the map's light to the screen (setSceneLight), so
   it turns with the camera and the shadows sweep as the map rotates.

   Same pattern as landmarks.js: lazy import (three.js stays out of the
   initial bundle until something asks for it), one instance per map that
   restores itself across `setStyle`, and visibility as the state we
   drive. Buildings follow the compass 2D/3D switch, so they never stand
   while the rest of the 3D city is flat; the surfaces are ground
   textures and stay on in 2D. */

import { StylingFoundationsModule, resetKnob, setKnobs, stylingFoundationsKnobCatalogue } from '@tomtom-org/maps-sdk/map';

const PLUGIN = () => import('@tomtom-org/maps-sdk-plugin-landmarks-3d');
const CTOR = { buildings: 'Buildings3D', surfaces: 'GLSurfaces' };
const LIGHT_KNOBS = ['view.light.alignment', 'view.light.direction', 'view.light.altitude'];

export class City3DController {
  constructor(map) {
    this.map = map;
    this.buildings = null;                            // Buildings3D once loaded
    this.surfaces = null;                             // GLSurfaces once loaded
    this.scene = { buildings: false, surfaces: false };   // what the active scene asked for
    this.flip  = { buildings: false, surfaces: false };   // debug-key override, inverts the scene
    this.base3D = true;                               // the compass 2D/3D switch, mirrored from the provider
    this._loading = { buildings: null, surfaces: null };
  }

  /** Whether a renderer should draw right now. */
  wants(kind) {
    const on = this.scene[kind] !== this.flip[kind];
    return kind === 'buildings' ? on && this.base3D : on;
  }

  /* Construct on first use, hidden in the same tick (before any frame
     draws; `visible` is no knob of theirs, so it can't go in the config).
     A concurrent caller shares the import. */
  #ensure(kind) {
    if (this[kind]) return Promise.resolve(this[kind]);
    this._loading[kind] ??= PLUGIN().then((mod) => {
      this[kind] = new mod[CTOR[kind]](this.map);
      this[kind].setVisible(false);
      return this[kind];
    });
    return this._loading[kind];
  }

  /* Re-read the wanted state after every await, so the last request
     wins. Hiding something never loaded is a no-op: no three.js just to
     keep it off. */
  async #sync(kind) {
    if (!this.wants(kind) && !this[kind] && !this._loading[kind]) return;
    try {
      const inst = await this.#ensure(kind);
      inst.setVisible(this.wants(kind));
    } catch (err) {
      console.warn(`[city3d] ${CTOR[kind]}`, err?.message || err);
    }
  }

  /** Follow the compass switch: buildings stand only in 3D. */
  setBase3D(on) {
    this.base3D = on;
    this.#sync('buildings');
  }

  /** A scene's request: `true`, a knob config to apply, or falsy for off.
      A config replaces the renderer's whole look (its `applyConfig`), so
      an empty or absent one is the plugin's default look. */
  async setScene(kind, request) {
    this.scene[kind] = Boolean(request);
    if (request) {
      try {
        const inst = await this.#ensure(kind);
        // A newer request may have landed while the plugin loaded.
        if (this.scene[kind]) inst.applyConfig(typeof request === 'object' ? request : {});
      } catch { /* #sync reports it */ }
    }
    return this.#sync(kind);
  }

  /** A scene's light: `{ direction, altitude }` puts the map's light at a
      fixed place on screen (`view.light.alignment: 'viewport'`, direction
      clockwise from the top of the screen), so it turns with the camera
      and the shadows sweep across the city as the map rotates. Buildings3D
      and GLSurfaces follow the map's light while their own `light.direction`
      / `light.altitude` knobs are unset. `null` hands the light back to
      the style. */
  async setSceneLight(light) {
    this._light = light;
    try {
      const styling = await StylingFoundationsModule.get(this.map);
      if (this._light !== light) return;   // a newer request landed meanwhile
      if (light) {
        setKnobs(styling, stylingFoundationsKnobCatalogue, {
          'view.light.alignment': 'viewport',
          'view.light.direction': light.direction,
          'view.light.altitude': light.altitude,
        });
      } else {
        for (const id of LIGHT_KNOBS) resetKnob(styling, stylingFoundationsKnobCatalogue, id);
      }
    } catch (err) {
      console.warn('[city3d] light', err?.message || err);
    }
  }

  /** Debug key: invert the scene's choice. Returns whether it now draws
      (buildings: before the 2D/3D switch). */
  toggle(kind) {
    this.flip[kind] = !this.flip[kind];
    this.#sync(kind);
    return this.scene[kind] !== this.flip[kind];
  }
}
