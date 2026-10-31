/* UI icons — one spec for every icon button, link glyph and inline mark
   in the app chrome, on Lucide's 24-unit geometry. Stroke is set per
   size so the line always lands at ~1.5 CSS px (3 device px on a 2x
   screen): 2.25 at 16 px, 3 at 12 px. Hand-drawn glyphs at mixed sizes
   and strokes came out at fractional widths and rendered soft.

   Map sprites and markers are not UI icons and keep their own drawing
   (render/marker.js, render/ev-sprites.js, render/hairline/). */

const LINE_PX = 1.5;
const strokeFor = size => +(LINE_PX * 24 / size).toFixed(2);

const attrs = size =>
  `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeFor(size)}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;

export const icon = (body, size = 16, cls = '') =>
  `<svg${cls ? ` class="${cls}"` : ''} ${attrs(size)}>${body}</svg>`;

export const ICO_COPY  = '<rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>';
export const ICO_EXT   = '<path d="M7 17 17 7M8 7h9v9"/>';
export const ICO_DL    = '<path d="M12 3v12m-5-5 5 5 5-5M4 21h16"/>';
export const ICO_PKG   = '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>';
export const ICO_CHECK = '<path d="M20 6 9 17l-5-5"/>';
export const ICO_MINUS = '<path d="M5 12h14"/>';
export const ICO_PLUS  = '<path d="M5 12h14M12 5v14"/>';
export const ICO_X     = '<path d="M18 6 6 18M6 6l12 12"/>';

export const ICO_CHEV_DOWN  = '<path d="m6 9 6 6 6-6"/>';
export const ICO_CHEV_UP    = '<path d="m18 15-6-6-6 6"/>';
export const ICO_CHEV_LEFT  = '<path d="m15 18-6-6 6-6"/>';
export const ICO_CHEV_RIGHT = '<path d="m9 18 6-6-6-6"/>';
export const ICO_ARROW_RIGHT = '<path d="M5 12h14m-7-7 7 7-7 7"/>';

export const ICO_SEARCH = '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>';
export const ICO_MOON   = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';
export const ICO_SUN    = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>';
export const ICO_LOCATE = '<path d="M2 12h3M19 12h3M12 2v3M12 19v3"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>';
export const ICO_LOCK   = '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
export const ICO_INFO   = '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>';
export const ICO_LIST   = '<path d="M3 6h.01M3 12h.01M3 18h.01M8 6h13M8 12h13M8 18h13"/>';
export const ICO_CODE   = '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>';
export const ICO_FLAG   = '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>';
export const ICO_GRIP   = '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>';
/* Zap and sparkles sit as solid accents on coloured chips, where an
   outline alone thins out — same Lucide outline, filled. */
export const ICO_ZAP      = '<path fill="currentColor" d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>';
export const ICO_SPARKLES = '<path fill="currentColor" d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/><path d="M20 3v4M22 5h-4M4 17v2M5 18H3"/>';
/* "Present": Lucide's scan corners framing a play triangle — reads as
   "start the show", not just "make it bigger". */
export const ICO_PRESENT  = '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path fill="currentColor" d="M10 8.5v7l6-3.5z"/>';

/* Compass FAB glyphs. It shows the *next* camera state, "3D" or "2D"
   (text set in the title face; y=17 centres the cap-height), or, once
   the map is rotated off north, an N under a needle — the whole SVG is
   then rotated by -bearing so the needle tracks true north. The N is
   drawn bottom-left → top-left → bottom-right → top-right; any other
   order flips the diagonal into a Cyrillic "И". */
const compassText = s => `<text x="12" y="17" text-anchor="middle" stroke="none" fill="currentColor" font-family="var(--f-title, Gilroy, sans-serif)" font-weight="800" font-size="15" letter-spacing="0.4">${s}</text>`;
export const ICO_3D    = compassText('3D');
export const ICO_2D    = compassText('2D');
export const ICO_NORTH = '<path fill="currentColor" d="M12 4 9.7 7.2h4.6z"/><path d="M9 18v-8l6 8v-8"/>';

/* Static icons in the HTML shells (index.html, split.html) are written as
   `<svg data-icon="name" width="16" height="16"></svg>` — the box holds
   its size before boot, and hydrateIcons() draws the glyph on the spec. */
const BY_NAME = {
  search: ICO_SEARCH, x: ICO_X, plus: ICO_PLUS, minus: ICO_MINUS,
  'chev-down': ICO_CHEV_DOWN, 'chev-up': ICO_CHEV_UP,
  'chev-left': ICO_CHEV_LEFT, 'chev-right': ICO_CHEV_RIGHT,
  'arrow-right': ICO_ARROW_RIGHT, moon: ICO_MOON, sun: ICO_SUN,
  locate: ICO_LOCATE, lock: ICO_LOCK, '3d': ICO_3D,
};

export function hydrateIcons(root = document) {
  for (const svg of root.querySelectorAll('svg[data-icon]')) {
    const body = BY_NAME[svg.dataset.icon];
    if (!body) continue;
    const size = +svg.getAttribute('width') || 16;
    const tmp = document.createElement('div');
    tmp.innerHTML = icon(body, size);
    const src = tmp.firstChild;
    for (const { name, value } of src.attributes) svg.setAttribute(name, value);
    svg.innerHTML = src.innerHTML;
  }
}
