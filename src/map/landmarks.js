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
    this.textured = false;   // EXPERIMENT: real GLB textures vs flat fill-extrusion
    this._origApplyMaterials = null; // plugin's own applyMaterials, saved while patched
    this._origNeedsPrepass = null;   // plugin's own needsTranslucentPrepass, saved while patched
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

  /* EXPERIMENT — render the meshes with their real baked textures (colour
     + surface detail from the GLB) instead of the plugin's flat monochrome
     fill-extrusion shading.

     The GLB tiles already ship with KTX2 textures; the plugin deliberately
     discards the RGB and keeps only the alpha channel (silhouette mask),
     painting everything one basemap-building colour. It re-applies its own
     material EVERY frame in `ModelsLayer.applyMaterials()`, so we can't just
     set materials once — we shadow that method with one that swaps each mesh
     to a lightweight unlit material built from the mesh's baked texture (the
     plugin stashes the source material on `userData` when a tile loads).
     Toggling off puts the plugin's own method back.

     KNOWN LIMITATION: works well on solid landmarks (towers, arches), but
     dense models (stadiums) z-fight on zoom — coincident/coplanar faces tie
     in the depth buffer and no material flag breaks that. A flicker-free
     textured look for every model needs a plugin/SDK-level fix (log depth
     or de-duped geometry). Purely a dev-facing test hatch — not the default
     look, toggled with the `L` key via the debug overlay. */
  async setTextured(on) {
    this.textured = on;
    let inst;
    try { inst = await this.#ensure(); } catch { return; }
    const layer = inst.layer;
    if (!layer) return;

    if (on) {
      if (!this._origApplyMaterials) {
        this._origApplyMaterials = layer.applyMaterials.bind(layer);
      }
      /* Kill the plugin's translucent depth-prepass in textured mode — it
         fires while the fill-extrusion layer opacity is 0.82. Our material
         is OPAQUE, so the prepass is redundant and, worse, splitting depth
         and colour across two passes leaves the coarse double-sided hull's
         depth ambiguous frame-to-frame → the zoom flicker. Force it off so
         there's a single opaque pass that writes its own depth. */
      if (!this._origNeedsPrepass) {
        this._origNeedsPrepass = layer.needsTranslucentPrepass.bind(layer);
      }
      layer.needsTranslucentPrepass = () => false;
      const { MeshBasicMaterial, DoubleSide } = await import('three');
      layer.applyMaterials = () => {
        layer.tiles.traverse((obj) => {
          if (!obj.isMesh) return;
          const orig = obj.userData.originalMaterial;
          if (!orig?.map) return;
          /* Lightweight unlit material carrying the baked colour texture,
             identical on both themes. MeshStandardMaterial's PBR path leaves
             GL state that corrupts MapLibre's shared context (whole map goes
             black); MeshBasic is minimal enough to survive it.

             OPAQUE, not transparent. The texture is a hard alpha CUTOUT
             (lattice/holes carved by the alpha channel), so we discard via
             `alphaTest` and stay in the opaque pass with depthWrite on.
             `transparent: true` drops these into the sorted translucent
             pass, where the coarse double-sided hull's front/back faces
             (and separate landmark meshes) get re-sorted every frame as the
             camera moves — that is the z-fighting flicker + "cuts" on zoom. */
          if (!obj.userData.texturedMaterial) {
            obj.userData.texturedMaterial = new MeshBasicMaterial({
              map: orig.map,
              transparent: false,
              alphaTest: orig.alphaTest ?? 0.1,
              depthWrite: true,
              side: DoubleSide,
            });
          }
          obj.material = obj.userData.texturedMaterial;
        });
      };
    } else if (this._origApplyMaterials) {
      layer.applyMaterials = this._origApplyMaterials;
      this._origApplyMaterials = null;
      if (this._origNeedsPrepass) {
        layer.needsTranslucentPrepass = this._origNeedsPrepass;
        this._origNeedsPrepass = null;
      }
    }
    this.map.mapLibreMap.triggerRepaint();
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
