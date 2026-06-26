/* Quickstart "Code" tab — resolves each authored starter file's
   `{{paramKey}}` placeholders against the live map view + Configure
   values, then syntax-highlights it.

   The authored files live in code-samples.js (one set per mapType). A
   placeholder is rendered as a highlighted, read-only `dd-snip-val`
   span reflecting the current value — the Configure controls are the
   canonical edit surface. The reserved `__style`, `__lng`, `__lat`,
   `__zoom`, `__dasharray` and palette keys carry the live view so the
   developer copies what they see, not a stale Amsterdam default. */

import { paramFor } from '../state.js';
import { filesForType } from './code-samples.js';
import { highlight } from './highlight.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
}[c]));

/* Named heatmap palettes mirrored from the runtime scenes so the
   snippet can show concrete hex values for whichever palette the user
   picked in Configure. Keep keys in sync with density.js. */
const SNIPPET_PALETTES = {
  'sunset':      { from: '#FCD34D', mid: '#FB923C', warm: '#F472B6', hot: '#9333EA', low: '#FCD34D' },
  'tropic':      { from: '#5EEAD4', mid: '#FCD34D', warm: '#F472B6', hot: '#EC4899', low: '#5EEAD4' },
  'peach':       { from: '#FED7AA', mid: '#FBA76F', warm: '#F472B6', hot: '#A855F7', low: '#FED7AA' },
  'violet-pink': { from: '#6443A1', mid: '#9333EA', warm: '#DB2777', hot: '#F472B6', low: '#6443A1' },
  'teal-coral':  { from: '#0EA5B7', mid: '#4ECDC4', warm: '#F08A5D', hot: '#EE6748', low: '#0EA5B7' },
  'amber-red':   { from: '#DBA43A', mid: '#E8842F', warm: '#EE6748', hot: '#EE6748', low: '#DBA43A' },
};

/* Build the reserved live tokens (map view + derived style values). */
function liveTokensFor(uc, view) {
  const v = view || {};
  const lineStyle = paramFor(uc, 'lineStyle') || paramFor(uc, 'strokeStyle') || paramFor(uc, 'geofenceStyle');
  const dasharray =
    lineStyle === 'dashed' ? '[2, 1.5]' :
    lineStyle === 'dotted' ? '[0.1, 1.6]' :
    'null';
  const paletteKey = paramFor(uc, 'palette');
  const pal = (paletteKey && SNIPPET_PALETTES[paletteKey]) || SNIPPET_PALETTES['amber-red'];
  return {
    __style:       v.style ?? 'standardDark',
    __lng:         v.center?.[0] ?? 4.9041,
    __lat:         v.center?.[1] ?? 52.3676,
    __zoom:        v.zoom ?? 11,
    __dasharray:   dasharray,
    __paletteFrom: pal.from,
    __paletteMid:  pal.mid,
    __paletteWarm: pal.warm,
    __paletteHot:  pal.hot,
    __paletteLow:  pal.low,
  };
}

/* Render a value into the form it should take inside source code:
   arrays become JS array literals, everything else is stringified. */
function displayValue(value) {
  if (Array.isArray(value)) return `[${value.map(v => `'${v}'`).join(', ')}]`;
  return value === undefined || value === null ? '' : String(value);
}

/* Highlight first (placeholders survive as literal text — none of our
   param keys is a JS keyword or bare number), then swap each `{{key}}`
   for a live `dd-snip-val` token. */
function resolveFile(file, uc, liveTokens) {
  const html = highlight(file.code, file.lang);
  return html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = key in liveTokens ? liveTokens[key] : paramFor(uc, key);
    return `<span class="dd-snip-val" data-key="${esc(key)}">${esc(displayValue(value))}</span>`;
  });
}

/** Resolved + highlighted starter files for a use case. Returns
    [{ name, lang, html }] in tab order (first = default). */
export function filesFor(uc, view) {
  const liveTokens = liveTokensFor(uc, view);
  return filesForType(uc.mapType).map(file => ({
    name: file.name,
    lang: file.lang,
    html: resolveFile(file, uc, liveTokens),
  }));
}
