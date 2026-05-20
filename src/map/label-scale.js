/* Scales all map label text sizes by a uniform factor.
   Must be called after the style is fully loaded (initial load or post-theme-swap).
   Handles both plain-number text-size values and MapLibre expression arrays. */

export function applyLabelScale(mapLibreMap, scale) {
  const style = mapLibreMap.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    if (layer.type !== 'symbol') continue;
    const textSize = layer.layout?.['text-size'];
    if (textSize === undefined) continue;

    const scaled = typeof textSize === 'number'
      ? textSize * scale
      : ['*', scale, textSize];

    mapLibreMap.setLayoutProperty(layer.id, 'text-size', scaled);
  }
}
