/* Shared scene helpers. Keep these small and stateless — they exist so
   every case that lets the user tune a route/area can do it the same
   way, without each scene re-implementing dash patterns or halo
   strokes. Anything bigger belongs in scene-context.js. */

import { paramFor } from '../state.js';

/** Read a CSS custom property from :root. Used to pull the UI surface
    colour so route/area outlines always match the host theme — overlays
    stay readable against any basemap (mono, driving, satellite). */
export const cssVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

/** Translate a `lineStyle` param into a MapLibre `line-dasharray`. The
    values are tuned so dashes/dots stay visible at the default line
    width — they scale automatically with the user-picked width because
    dasharray is multiplied by line-width at paint time. */
export const dashFor = (style) => {
  if (style === 'dashed') return [2, 1.5];
  if (style === 'dotted') return [0.1, 1.6];
  return null;
};

/** Default thickness of the halo on each side of an overlay line. The
    casing is painted in the UI surface colour at 95% opacity so the
    main line reads against any basemap. */
export const HALO = 6;

/** Resolve the standard line-styling params for a case. Falls back to
    sensible defaults so a scene can call this even when the user case
    didn't declare the params yet. */
export function lineParams(uc, { defaultColor, defaultWidth = 10 } = {}) {
  const color = paramFor(uc, 'routeColor') || defaultColor;
  const width = Number(paramFor(uc, 'lineWidth')) || defaultWidth;
  const style = paramFor(uc, 'lineStyle') || 'solid';
  return { color, width, style, dashArray: dashFor(style) };
}

/** Resolve the standard area-styling params for a case (fill + stroke). */
export function areaParams(uc, { defaultFill, defaultStroke, defaultWidth = 2 } = {}) {
  const fill = paramFor(uc, 'fillColor') || defaultFill;
  const stroke = paramFor(uc, 'strokeColor') || defaultStroke || defaultFill;
  const width = Number(paramFor(uc, 'strokeWidth')) || defaultWidth;
  const style = paramFor(uc, 'strokeStyle') || 'solid';
  return { fill, stroke, width, style, dashArray: dashFor(style) };
}
