/* Incident types — TomTom's `iconCategory` (Incident Details) and
   `icon_category_0 / _1` (Traffic Incidents vector tiles), one entry per
   code. The finer type (e.g. "Obstruction on the road", "Broken down
   vehicle") is in the incident's event description; this is the family
   it belongs to.

   kind  — stable id (legend de-dupe, CSS hooks)
   tone  — badge colour: closed (red), warn (amber), weather (blue)
   order — which to keep first when space is short: acute, rare events
           before the long-running ones
   sprite — TomTom's own pictogram in the map style, the one the live
           incident layer draws — so a badge matches the map
   svg   — fallback 24×24 stroke paths in a round badge, only for a style
           that lacks the sprite */

import { spriteCanvas } from '../render/ev-sprites.js';

export const INCIDENT_TYPES = {
  1: { kind: 'accident', sprite: 'traffic-incidents-accident', label: 'Accident', tone: 'warn', order: 0,
       svg: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>' },
  14: { kind: 'broken-down', sprite: 'traffic-incidents-broken_down_vehicle', label: 'Broken-down vehicle', tone: 'warn', order: 1,
       svg: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>' },
  3: { kind: 'hazard', sprite: 'traffic-incidents-danger', label: 'Hazard', tone: 'warn', order: 2,
       svg: '<path d="M12 5v9"/><path d="M12 19h.01"/>' },
  7: { kind: 'lane-closed', sprite: 'traffic-incidents-lane_closed', label: 'Lane closed', tone: 'warn', order: 3,
       svg: '<path d="M4 3v18"/><path d="M20 3v18"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/>' },
  2: { kind: 'fog', sprite: 'traffic-incidents-fog', label: 'Fog', tone: 'weather', order: 4,
       svg: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 17H7"/><path d="M17 21H9"/>' },
  4: { kind: 'rain', sprite: 'traffic-incidents-rain', label: 'Rain', tone: 'weather', order: 4,
       svg: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>' },
  5: { kind: 'ice', sprite: 'traffic-incidents-frost', label: 'Ice', tone: 'weather', order: 4,
       svg: '<path d="M12 3v18"/><path d="m4.2 7.5 15.6 9"/><path d="m19.8 7.5-15.6 9"/>' },
  10: { kind: 'wind', sprite: 'traffic-incidents-wind', label: 'Wind', tone: 'weather', order: 4,
       svg: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>' },
  11: { kind: 'flooding', sprite: 'traffic-incidents-flooding', label: 'Flooding', tone: 'weather', order: 4,
       svg: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>' },
  9: { kind: 'works', sprite: 'traffic-incidents-roadworks', label: 'Roadworks', tone: 'warn', order: 5,
       svg: '<rect x="2" y="6" width="20" height="8" rx="1"/><path d="M17 14v7"/><path d="M7 14v7"/><path d="M17 3v3"/><path d="M7 3v3"/><path d="M10 14 2.3 6.3"/><path d="m14 6 7.7 7.7"/><path d="m8 6 8 8"/>' },
  8: { kind: 'closed', sprite: 'traffic-incidents-road_closed', label: 'Road closed', tone: 'closed', order: 6,
       svg: '<circle cx="12" cy="12" r="9"/><path d="M7.5 12h9"/>' },
  6: { kind: 'jam', label: 'Jam', tone: 'warn', order: 7, svg: '' },
};

export const incidentType = code => INCIDENT_TYPES[Number(code)] || null;

/* Every code except jam (6) and unknown (0) — what "also happening on
   the road" means beside a jam ranking. */
export const NON_JAM_CATEGORIES = Object.keys(INCIDENT_TYPES).filter(c => c !== '6').join(',');

/* The type's badge as HTML: TomTom's sprite from the style when it has
   one, else the stroke fallback. `cls` sizes it (jam-hz = 24 px marker,
   jam-hz--legend = 16 px). Sprites are read once per style and cached —
   a theme / basemap switch swaps the style, so the cache is dropped. */
const urls = new WeakMap();
export function incidentBadge(ml, type, cls = 'jam-hz') {
  if (!type) return '';
  let cache = urls.get(ml);
  if (ml && !cache) {
    urls.set(ml, cache = new Map());
    ml.on('style.load', () => cache.clear());
  }
  if (ml && type.sprite && !cache.has(type.sprite)) {
    const url = spriteCanvas(ml, type.sprite)?.toDataURL();
    if (url) cache.set(type.sprite, url);
  }
  const url = cache?.get(type.sprite);
  if (url) return `<span class="${cls} jam-hz--sprite" aria-hidden="true"><img src="${url}" alt=""></span>`;
  if (!type.svg) return '';
  return `<span class="${cls} jam-hz--${type.tone}" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">${type.svg}</svg></span>`;
}

/* Resolves once the style's incident sprites are in (or after `ms`, so a
   style without them falls back instead of hanging). A scene booting
   right after a style switch can otherwise build its badges a beat
   before the sprite sheet lands. */
export function whenIncidentSprites(ml, ms = 3000) {
  const ready = () => !!spriteCanvas(ml, INCIDENT_TYPES[1].sprite);
  if (!ml || ready()) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(t); ml.off('styledata', check); ml.off('idle', check); resolve(); };
    const check = () => { if (ready()) done(); };
    const t = setTimeout(done, ms);
    ml.on('styledata', check);
    ml.on('idle', check);
  });
}
