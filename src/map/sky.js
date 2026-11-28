/* The themed sky: space around the globe, horizon glow and fog. Colours
   come from CSS (`--map-space-*`, themed and forced to night on satellite),
   so no palette is hardcoded here. The Orbis styles ship without a sky, so
   anything that resets one (a style swap, a styling reset) calls this
   again — otherwise MapLibre's default paints the space white. */
export function applyThemeSky(ml) {
  const root = getComputedStyle(document.documentElement);
  const deep    = root.getPropertyValue('--map-space-deep').trim()    || '#0c1422';
  const horizon = root.getPropertyValue('--map-space-horizon').trim() || '#3a6ba3';
  try {
    ml.setSky?.({
      'sky-color':         deep,
      'sky-horizon-blend': 0.65,
      'horizon-color':     horizon,
      'horizon-fog-blend': 0.5,
      'fog-color':         deep,
      'fog-ground-blend':  0.6,
      'atmosphere-blend':  0.85,
    });
  } catch (err) { console.warn('[sky]', err); }
}
