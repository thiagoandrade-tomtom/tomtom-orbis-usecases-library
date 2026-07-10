/* Landmarks "WOW" layer (EXPERIMENT, Phase 1) — a MapLibre custom layer that
   renders the Orbis 3D landmark meshes through OUR OWN Three.js renderer,
   instead of borrowing the plugin's.

   Why our own renderer: every quality/glitch problem we hit came from the
   plugin drawing into MapLibre's shared WebGL context with no control over
   the pipeline — flat unlit shading, no shadows, and (the big one) a depth
   buffer we couldn't touch, so dense models (stadiums) z-fight on zoom.

   Owning the renderer lets us turn on `logarithmicDepthBuffer`, which
   redistributes depth precision (via gl_FragDepth) and is the standard fix
   for z-fighting at map scale. This is the Phase-1 make-or-break: does log
   depth kill the stadium flicker? Lighting / shadows / AO come in later
   phases once the depth foundation is proven.

   We reuse the plugin's exported `ModelsSource` + `buildLandmarksTileURL`
   so tile streaming (GLB meshopt + KTX2, creased normals, alpha silhouette)
   is unchanged — we only replace how the meshes are drawn. Camera math
   mirrors the plugin's own `alignCameraToMap`, tuned to these tiles.

   three + the plugin are imported LAZILY (inside install) so this module —
   which provider imports statically — never drags Three.js (~500 KB) into
   the initial bundle. */

const WOW_LAYER_ID = 'orbis-3d-landmarks-wow';
const BASEMAP_BUILDING_LAYER = '3D - Building';
/* Hide basemap extruded buildings flagged as landmarks so their flat boxes
   don't clip through our meshes — same expression the plugin installs. */
const HAS_LANDMARK_EXCLUDE = ['!', ['coalesce', ['get', 'has_landmark'], false]];
/* Web-mercator metres per unit — the scale the plugin bakes into its camera
   matrix so tile-space metres land on MapLibre's projected units. */
const MERC = 1 / 40075016.68;

/* Build the custom layer with three + the tile source already resolved.
   THREE is captured in closure so render() (synchronous, per frame) has it
   without another import. */
function makeWowLayer(THREE, ModelsSource, buildLandmarksTileURL) {
  return {
    id: WOW_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    minTileZoom: 14,   // meshes only exist near street level
    opacity: 0.85,     // <1 → translucent blend with the scene (tunable live)

    onAdd(map, gl) {
      this.map = map;
      /* Own renderer over MapLibre's canvas/context — the whole point is the
         `logarithmicDepthBuffer` flag, which the plugin's renderer lacks. */
      this.renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
        logarithmicDepthBuffer: true,
      });
      this.renderer.autoClear = false;

      this.scene = new THREE.Scene();
      this.camera = new THREE.Camera();

      /* Reuse the plugin's tile source verbatim — GLB tiles live only at z15. */
      this.source = new ModelsSource(WOW_LAYER_ID, {
        type: 'models',
        tiles: [buildLandmarksTileURL()],
        minzoom: 15,
        maxzoom: 15,
        withCredentials: false, // direct api.tomtom.com with key
      });
      this.source.onAdd(map, this.renderer);
      this.scene.add(this.source.scene);
    },

    render(_gl, options) {
      const tz = this.map.transform.tileZoom;
      if (tz < this.minTileZoom) return;

      this.source.updateTiles();

      /* Build (once per mesh) the two materials the translucent path needs:
         a colour material and a depth-only prepass material, both carrying
         the baked texture + alpha cutout. Owning the renderer lets us run a
         real two-pass render, so transparency here is flicker-FREE — unlike
         the plugin, where transparency dropped meshes into three's sorted
         pass and z-fought every frame. */
      const cutout = 0.1;
      this.source.scene.traverse((obj) => {
        if (!obj.isMesh) return;
        const orig = obj.userData.originalMaterial;
        if (!orig?.map) return;
        if (!obj.userData.wowColor) {
          const alphaTest = orig.alphaTest ?? cutout;
          obj.userData.wowColor = new THREE.MeshBasicMaterial({
            map: orig.map,
            alphaTest,
            side: THREE.DoubleSide,
          });
          obj.userData.wowDepth = new THREE.MeshBasicMaterial({
            map: orig.map,        // sampled only for its alpha (silhouette)
            alphaTest,
            side: THREE.DoubleSide,
            colorWrite: false,    // depth-only prepass
          });
        }
      });

      /* Mirror of the plugin's alignCameraToMap: tile-metres → clip matrix
         premultiplied by MapLibre's main projection matrix. */
      const lat = this.map.getCenter().lat * Math.PI / 180;
      const z = MERC / Math.cos(lat);
      const model = new THREE.Matrix4().set(
        MERC, 0, 0, 0.5,
        0, -2.4953202340126887e-8, 0, 0.5,
        0, 0, z, 0,
        0, 0, 0, 1,
      );
      const main = new THREE.Matrix4().fromArray(options.defaultProjectionData.mainMatrix);
      this.camera.projectionMatrix.copy(main).multiply(model);

      /* CRITICAL for logarithmicDepthBuffer: three derives its log-depth
         uniform from `camera.far` (`logDepthBufFC = 2 / log2(far + 1)`). We
         set the projection matrix by hand, so a bare Camera has no near/far
         and the uniform comes out NaN — log depth silently does nothing.
         Feed MapLibre's own clip planes each frame so the distribution
         actually matches the projection. */
      this.camera.near = this.map.transform.nearZ ?? 0.1;
      this.camera.far = this.map.transform.farZ ?? 1e5;

      this.renderer.resetState();

      const opaque = this.opacity >= 1;
      if (opaque) {
        /* Fully opaque: single pass, material writes its own depth. */
        this.source.scene.traverse((obj) => {
          if (obj.isMesh && obj.userData.wowColor) {
            const m = obj.userData.wowColor;
            m.transparent = false; m.opacity = 1; m.depthWrite = true;
            obj.material = m;
          }
        });
        this.renderer.render(this.scene, this.camera);
      } else {
        /* Translucent: depth prepass establishes the frontmost silhouette
           depth, then the colour pass blends with depthWrite off so each
           pixel composites exactly once — no per-frame sort flicker. */
        this.source.scene.traverse((obj) => {
          if (obj.isMesh && obj.userData.wowDepth) obj.material = obj.userData.wowDepth;
        });
        this.renderer.render(this.scene, this.camera);          // pass 1: depth
        this.source.scene.traverse((obj) => {
          if (obj.isMesh && obj.userData.wowColor) {
            const m = obj.userData.wowColor;
            m.transparent = true; m.opacity = this.opacity; m.depthWrite = false;
            obj.material = m;
          }
        });
        this.renderer.render(this.scene, this.camera);          // pass 2: colour
      }

      this.map.triggerRepaint();
    },

    onRemove() {
      try { this.renderer?.dispose?.(); } catch { /* noop */ }
    },
  };
}

/* Install/remove the wow layer on a MapLibre map. three + the plugin are
   loaded on first install so the initial bundle stays lean. */
export class LandmarksWow {
  constructor(mapLibreMap) {
    this.map = mapLibreMap;
    this.layer = null;
    this._deps = null;
  }

  async install() {
    if (this.layer || !this.map) return;
    if (!this._deps) {
      const [THREE, plugin] = await Promise.all([
        import('three'),
        import('@tomtom-org/maps-sdk-plugin-landmarks-3d'),
      ]);
      this._deps = { THREE, ModelsSource: plugin.ModelsSource, buildLandmarksTileURL: plugin.buildLandmarksTileURL };
    }
    // A fast off-toggle could have raced us — bail if we were removed.
    if (this.layer || !this.map) return;
    this.layer = makeWowLayer(this._deps.THREE, this._deps.ModelsSource, this._deps.buildLandmarksTileURL);
    this.map.addLayer(this.layer);
    this.#excludeLandmarkBuildings();
    this.map.triggerRepaint();
  }

  remove() {
    this.layer = null;
    try { if (this.map.getLayer(WOW_LAYER_ID)) this.map.removeLayer(WOW_LAYER_ID); } catch { /* noop */ }
  }

  #excludeLandmarkBuildings() {
    if (!this.map.getLayer(BASEMAP_BUILDING_LAYER)) return;
    const existing = this.map.getFilter(BASEMAP_BUILDING_LAYER);
    if (existing && JSON.stringify(existing).includes(JSON.stringify(HAS_LANDMARK_EXCLUDE))) return;
    const next = existing ? ['all', existing, HAS_LANDMARK_EXCLUDE] : HAS_LANDMARK_EXCLUDE;
    this.map.setFilter(BASEMAP_BUILDING_LAYER, next);
  }
}
