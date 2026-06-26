/* Blueprint-style 48×48 SVG thumbnails — all drawn on the info/geo palette.
   Inspired by technical road-map line art. */

const B  = 'rgba(25,136,207,0.12)';  // background tint
const G1 = 'rgba(25,136,207,0.28)';  // dim grid / secondary lines
const G2 = 'rgba(25,136,207,0.52)';  // mid-weight lines
const GF = '#1988CF';                 // full geo color
const FA = 'rgba(25,136,207,0.14)';  // area fill

// Up-pointing navigation arrow (blueprint cursor)
const nav = (cx, cy, s = 1) =>
  `<path d="M${cx},${cy - 6 * s} L${cx - 4.5 * s},${cy + 4 * s} L${cx},${cy + 1 * s} L${cx + 4.5 * s},${cy + 4 * s} Z" fill="${GF}" opacity="0.82"/>`;

// Subtle background cross-grid (shared by most)
const grid = `
  <line x1="0" y1="16" x2="48" y2="16" stroke="${G1}" stroke-width="0.5"/>
  <line x1="0" y1="32" x2="48" y2="32" stroke="${G1}" stroke-width="0.5"/>
  <line x1="16" y1="0" x2="16" y2="48" stroke="${G1}" stroke-width="0.5"/>
  <line x1="32" y1="0" x2="32" y2="48" stroke="${G1}" stroke-width="0.5"/>`;

const THUMBS = {

  // Route — perspective road converging upward + cross streets + nav cursor
  route: `
    <rect width="48" height="48" fill="${B}"/>
    ${grid}
    <!-- Perspective main road: wider at bottom, narrower at top -->
    <line x1="16" y1="48" x2="20" y2="0"  stroke="${GF}" stroke-width="1.5"/>
    <line x1="32" y1="48" x2="28" y2="0"  stroke="${GF}" stroke-width="1.5"/>
    <!-- Cross street -->
    <line x1="0"  y1="30" x2="48" y2="30" stroke="${GF}" stroke-width="1.5"/>
    <!-- Block streets (left/right of road) -->
    <line x1="0"  y1="18" x2="20" y2="18" stroke="${G2}" stroke-width="0.75"/>
    <line x1="28" y1="18" x2="48" y2="18" stroke="${G2}" stroke-width="0.75"/>
    ${nav(24, 20)}`,

  // POI — street grid with pin markers at key intersections
  poi: `
    <rect width="48" height="48" fill="${B}"/>
    <line x1="0"  y1="16" x2="48" y2="16" stroke="${G1}" stroke-width="0.75"/>
    <line x1="0"  y1="32" x2="48" y2="32" stroke="${G1}" stroke-width="0.75"/>
    <line x1="12" y1="0"  x2="12" y2="48" stroke="${G1}" stroke-width="0.75"/>
    <line x1="24" y1="0"  x2="24" y2="48" stroke="${G1}" stroke-width="0.75"/>
    <line x1="36" y1="0"  x2="36" y2="48" stroke="${G1}" stroke-width="0.75"/>
    <!-- Pin markers -->
    <circle cx="12" cy="16" r="3.5" fill="${FA}" stroke="${GF}" stroke-width="1.25"/>
    <circle cx="36" cy="16" r="3.5" fill="${FA}" stroke="${GF}" stroke-width="1.25"/>
    <circle cx="24" cy="32" r="3.5" fill="${FA}" stroke="${GF}" stroke-width="1.25"/>
    <circle cx="12" cy="16" r="1.5" fill="${GF}"/>
    <circle cx="36" cy="16" r="1.5" fill="${GF}"/>
    <circle cx="24" cy="32" r="1.5" fill="${GF}"/>`,

  // Multi-stop — waypoint chain with dashed connector line
  multistop: `
    <rect width="48" height="48" fill="${B}"/>
    ${grid}
    <polyline points="6,40 14,14 24,28 36,10 42,22"
      fill="none" stroke="${G2}" stroke-width="1.25" stroke-dasharray="3 2.5"/>
    <circle cx="6"  cy="40" r="3"   fill="${FA}" stroke="${GF}" stroke-width="1.25"/>
    <circle cx="14" cy="14" r="2.5" fill="${FA}" stroke="${GF}" stroke-width="1.25"/>
    <circle cx="24" cy="28" r="2.5" fill="${FA}" stroke="${GF}" stroke-width="1.25"/>
    <circle cx="36" cy="10" r="2.5" fill="${FA}" stroke="${GF}" stroke-width="1.25"/>
    <circle cx="42" cy="22" r="3"   fill="${GF}"/>`,

  // Fleet — geofence boundary + multiple vehicle cursors
  fleet: `
    <rect width="48" height="48" fill="${B}"/>
    ${grid}
    <rect x="5" y="5" width="38" height="38" rx="3"
      fill="none" stroke="${G2}" stroke-width="1" stroke-dasharray="3 2"/>
    ${nav(12, 16, 0.85)}
    ${nav(32, 10, 0.85)}
    ${nav(38, 28, 0.85)}
    ${nav(18, 34, 0.85)}`,

  // Package — curved route to a destination pin
  package: `
    <rect width="48" height="48" fill="${B}"/>
    ${grid}
    <path d="M6,40 Q18,30 26,20 Q34,12 42,10"
      fill="none" stroke="${G2}" stroke-width="1.25"/>
    <circle cx="6" cy="40" r="2.5" fill="${FA}" stroke="${GF}" stroke-width="1.25"/>
    <!-- Destination package icon -->
    <rect x="38" y="5" width="8" height="7" rx="1"
      fill="${FA}" stroke="${GF}" stroke-width="1.25"/>
    <line x1="42" y1="12" x2="42" y2="16" stroke="${GF}" stroke-width="1.25"/>
    <circle cx="42" cy="17" r="1.5" fill="${GF}"/>
    ${nav(26, 26)}`,

  // Delivery — dispatch hub with spoke routes to stops
  delivery: `
    <rect width="48" height="48" fill="${B}"/>
    ${grid}
    <line x1="24" y1="24" x2="5"  y2="7"  stroke="${G2}" stroke-width="1"/>
    <line x1="24" y1="24" x2="43" y2="7"  stroke="${G2}" stroke-width="1"/>
    <line x1="24" y1="24" x2="5"  y2="41" stroke="${G2}" stroke-width="1"/>
    <line x1="24" y1="24" x2="43" y2="41" stroke="${G2}" stroke-width="1"/>
    <circle cx="5"  cy="7"  r="2.5" fill="${FA}" stroke="${GF}" stroke-width="1.2"/>
    <circle cx="43" cy="7"  r="2.5" fill="${FA}" stroke="${GF}" stroke-width="1.2"/>
    <circle cx="5"  cy="41" r="2.5" fill="${FA}" stroke="${GF}" stroke-width="1.2"/>
    <circle cx="43" cy="41" r="2.5" fill="${FA}" stroke="${GF}" stroke-width="1.2"/>
    <circle cx="24" cy="24" r="5"   fill="${FA}" stroke="${GF}" stroke-width="1.5"/>
    <circle cx="24" cy="24" r="2"   fill="${GF}"/>`,

  // City — street grid with building footprints
  city: `
    <rect width="48" height="48" fill="${B}"/>
    <line x1="0"  y1="20" x2="48" y2="20" stroke="${GF}" stroke-width="1.25"/>
    <line x1="0"  y1="34" x2="48" y2="34" stroke="${G1}" stroke-width="0.75"/>
    <line x1="18" y1="0"  x2="18" y2="48" stroke="${GF}" stroke-width="1.25"/>
    <line x1="36" y1="0"  x2="36" y2="48" stroke="${G1}" stroke-width="0.75"/>
    <!-- Building footprints -->
    <rect x="2"  y="3"  width="13" height="14" fill="${FA}" stroke="${GF}" stroke-width="1"/>
    <rect x="21" y="3"  width="12" height="14" fill="${FA}" stroke="${GF}" stroke-width="1"/>
    <rect x="39" y="3"  width="7"  height="14" fill="${FA}" stroke="${G2}" stroke-width="1"/>
    <rect x="2"  y="23" width="13" height="8"  fill="${FA}" stroke="${G2}" stroke-width="1"/>
    <rect x="21" y="23" width="12" height="8"  fill="${FA}" stroke="${G2}" stroke-width="1"/>`,

  // Heatmap — sun + rising heat/isotherm waves (weather / temperature)
  heatmap: `
    <rect width="48" height="48" fill="${B}"/>
    <!-- Sun -->
    <circle cx="24" cy="16" r="6.5" fill="${FA}" stroke="${GF}" stroke-width="1.5"/>
    <g stroke="${GF}" stroke-width="1.25" stroke-linecap="round">
      <line x1="24"   y1="3"   x2="24"   y2="6"/>
      <line x1="9"    y1="16"  x2="12"   y2="16"/>
      <line x1="36"   y1="16"  x2="39"   y2="16"/>
      <line x1="13.2" y1="5.2" x2="15.3" y2="7.3"/>
      <line x1="34.8" y1="5.2" x2="32.7" y2="7.3"/>
    </g>
    <!-- Rising heat waves (isotherms) -->
    <path d="M6,33 q6,-5 12,0 t12,0 t12,0" fill="none" stroke="${GF}" stroke-width="1.5"/>
    <path d="M6,40 q6,-5 12,0 t12,0 t12,0" fill="none" stroke="${G2}" stroke-width="1.1"/>`,

  // Density — overlapping heatmap blobs suggest soft density patches
  density: `
    <rect width="48" height="48" fill="${B}"/>
    <circle cx="18" cy="22" r="13" fill="${FA}" opacity="0.55"/>
    <circle cx="30" cy="18" r="9"  fill="${FA}" opacity="0.7"/>
    <circle cx="32" cy="30" r="11" fill="${FA}" opacity="0.6"/>
    <circle cx="14" cy="34" r="6"  fill="${FA}" opacity="0.5"/>
    <circle cx="24" cy="24" r="4"  fill="${GF}"/>`,

  // Sport — curved activity trace over contour terrain lines
  sport: `
    <rect width="48" height="48" fill="${B}"/>
    <!-- Terrain contour lines -->
    <path d="M0,36 Q12,30 24,26 Q36,22 48,28" fill="none" stroke="${G1}" stroke-width="0.6"/>
    <path d="M0,42 Q12,38 24,34 Q36,30 48,36" fill="none" stroke="${G1}" stroke-width="0.6"/>
    <!-- Activity route -->
    <path d="M4,42 C10,34 16,28 22,20 S36,12 44,14"
      fill="none" stroke="${GF}" stroke-width="1.75"/>
    <circle cx="4"  cy="42" r="2.5" fill="${FA}" stroke="${GF}" stroke-width="1.25"/>
    <circle cx="44" cy="14" r="2.5" fill="${GF}"/>
    ${nav(24, 30)}`,

  // EV — three lightning bolts at decreasing weight, evoking speed tiers
  ev: `
    <rect width="48" height="48" fill="${B}"/>
    ${grid}
    <!-- Big bolt: rapid DC -->
    <path d="M16,6 L6,26 L12,26 L10,42 L22,22 L15,22 Z"
      fill="${FA}" stroke="${GF}" stroke-width="1.25" stroke-linejoin="round"/>
    <!-- Mid bolt: fast AC -->
    <path d="M30,10 L23,26 L27,26 L25,38 L33,24 L28,24 Z"
      fill="${FA}" stroke="${G2}" stroke-width="1" stroke-linejoin="round"/>
    <!-- Small bolt: slow AC -->
    <path d="M41,14 L37,26 L39,26 L38,34 L43,24 L40,24 Z"
      fill="none" stroke="${G2}" stroke-width="0.9" stroke-linejoin="round"/>`,

  // Sharing — clusters of different vehicle types on a grid
  sharing: `
    <rect width="48" height="48" fill="${B}"/>
    ${grid}
    <!-- Primary cluster -->
    <circle cx="12" cy="12" r="4.5" fill="${FA}" stroke="${GF}" stroke-width="1.25"/>
    <circle cx="24" cy="22" r="4.5" fill="${FA}" stroke="${GF}" stroke-width="1.5"/>
    <circle cx="38" cy="12" r="4.5" fill="${FA}" stroke="${GF}" stroke-width="1.25"/>
    <!-- Secondary cluster -->
    <circle cx="14" cy="36" r="3.5" fill="${FA}" stroke="${G2}" stroke-width="1"/>
    <circle cx="36" cy="36" r="3.5" fill="${FA}" stroke="${G2}" stroke-width="1"/>
    <!-- Center dots -->
    <circle cx="12" cy="12" r="1.5" fill="${GF}"/>
    <circle cx="24" cy="22" r="1.5" fill="${GF}"/>
    <circle cx="38" cy="12" r="1.5" fill="${GF}"/>`,
};

export function thumbFor(uc) {
  const content = THUMBS[uc.mapType] ?? '';
  return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">${content}</svg>`;
}
