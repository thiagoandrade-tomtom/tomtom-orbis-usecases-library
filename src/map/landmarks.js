/* Landmarks3D — base-map-level 3D landmark meshes (TomTom Orbis, Private
   Preview). High-detail GLB models (Eiffel Tower, Big Ben, Burj Khalifa,
   …) streamed as tiles and rendered with Three.js on top of the shared
   TomTomMap.

   Two deliberate choices:

   - Lazy load. The plugin pulls in Three.js (~150 KB gzipped) plus KTX2
     transcoders. None of that belongs in the initial bundle when the user
     may never tilt into 3D, so the `import()` fires on the first request to
     SHOW landmarks — never just to hide them.

   - Singleton, created once. The plugin restores itself across `setStyle`
     (it re-installs its custom layer and re-hides the overlapping basemap
     buildings on every style change), so unlike our other overlays we do
     NOT recreate it per style/scene swap. We only flip visibility.

   `displayMode: 'inherited'` shades the meshes to match the basemap 3D
   building layer's colour/opacity, so light/dark themes are handled by the
   plugin without us re-applying anything on theme toggle. */

export class LandmarksController {
  constructor(map) {
    this.map = map;
    this.instance = null;    // Landmarks3D once loaded+constructed
    this.loading = null;     // in-flight import promise (dedupes concurrent calls)
    this.visible = false;    // last requested visibility — source of truth while loading
  }

  /* Resolve to the Landmarks3D instance, importing + constructing on the
     first call. Constructed hidden; visibility is driven entirely through
     setVisible so the load order can't flash meshes on. */
  async #ensure() {
    if (this.instance) return this.instance;
    if (!this.loading) {
      this.loading = import('@tomtom-org/maps-sdk-plugin-landmarks-3d')
        .then(({ Landmarks3D }) => {
          this.instance = new Landmarks3D(this.map, {
            displayMode: 'inherited',
            visible: false,
          });
          return this.instance;
        });
    }
    return this.loading;
  }

  /* Show or hide landmarks. Hiding before anything ever loaded is a no-op
     so we don't pay the Three.js import just to keep them off. Because the
     import is async, a fast toggle sequence could resolve out of order —
     we always re-read `this.visible` after awaiting so the last request
     wins. */
  async setVisible(visible) {
    this.visible = visible;
    if (!visible && !this.instance && !this.loading) return;
    try {
      const inst = await this.#ensure();
      await inst.setVisible(this.visible);
    } catch (err) {
      console.warn('[landmarks3D]', err?.message || err);
    }
  }

  /* Change how landmarks blend with the basemap ('inherited' | 'dark' |
     'light'). No-op until the plugin has loaded — nothing to restyle yet. */
  setDisplayMode(mode) {
    if (!this.instance) return;
    this.instance.setDisplayMode(mode).catch((err) => {
      console.warn('[landmarks3D] displayMode', err?.message || err);
    });
  }
}
