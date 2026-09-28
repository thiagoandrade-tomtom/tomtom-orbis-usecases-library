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

  // Traffic — two cars stacked in a queue (front view, the designer's
  // icon). No road: every road variant (vertical, 45°, isometric) read
  // as clutter against the artwork's own open outlines.
  traffic: `
    <rect width="48" height="48" fill="${B}"/>
    <!-- Cars: 22×18 artwork scaled ×1.55 and centred -->
    <g transform="translate(6.9 10.1) scale(1.55)" fill="${GF}">
      <path d="M19.1118 1.60588L20.1 3.91765C20.9295 4.2 21.5295 4.97647 21.5295 5.89412V8.98235C21.5295 9.70588 20.9295 10.2882 20.2059 10.2882H15.5118C15.2118 10.2882 14.9824 10.0588 14.9824 9.75882C14.9824 9.45882 15.2118 9.22941 15.5118 9.22941H20.2059C20.3471 9.22941 20.4706 9.12353 20.4706 8.98235V5.85882C20.4706 5.29412 20.0118 4.83529 19.4295 4.83529H12.6883C12.3883 4.83529 12.1589 4.60588 12.1589 4.30588C12.1589 4.00588 12.3883 3.77647 12.6883 3.77647H18.9L18.1412 2.01176C17.8765 1.42941 17.2942 1.04118 16.6589 1.04118H12.2471C11.6295 1.04118 11.0648 1.41176 10.8 1.97647C10.7912 2.00294 10.7824 2.025 10.7736 2.04706C10.7648 2.06912 10.7559 2.09118 10.7471 2.11765L10.3765 2.82353C10.2706 3 10.0942 3.10588 9.90005 3.10588C9.81181 3.10588 9.72358 3.08824 9.65299 3.05294C9.38828 2.91176 9.2824 2.59412 9.42358 2.32941L9.75887 1.71176C9.7677 1.69412 9.77211 1.67647 9.77652 1.65882C9.78093 1.64118 9.78534 1.62353 9.79417 1.60588C10.2177 0.635294 11.1883 0 12.2471 0H16.6589C17.7353 0 18.6883 0.635294 19.1118 1.60588Z"/>
      <path d="M2.0293 11.8763C2.0293 11.2763 2.52341 10.7822 3.14106 10.7822C3.75871 10.7822 4.25283 11.2763 4.25283 11.8763C4.25283 12.4444 3.80997 12.443 3.23869 12.4412L3.14106 12.4411L3.04343 12.4412C2.47216 12.443 2.0293 12.4444 2.0293 11.8763Z"/>
      <path d="M10.7649 10.7822C10.1649 10.7822 9.68848 11.2763 9.68848 11.8587C9.68848 12.4243 10.1379 12.4239 10.7135 12.4234L10.7649 12.4234L10.8598 12.4236C11.4144 12.4254 11.8414 12.4267 11.8414 11.8587C11.8591 11.2587 11.3649 10.7822 10.7649 10.7822Z"/>
      <path d="M0.740924 15.8115H3.38798C3.49386 15.8115 3.5821 15.8998 3.5821 15.988V16.7645C3.5821 17.0645 3.33504 17.3115 3.03504 17.3115H1.11151C0.811512 17.3115 0.564453 17.0645 0.564453 16.7645V15.988C0.564453 15.8998 0.635041 15.8115 0.740924 15.8115Z"/>
      <path d="M13.1468 15.8296H10.4997C10.3938 15.8296 10.3232 15.9178 10.3232 16.0061V16.7825C10.3232 17.0825 10.5703 17.3296 10.8703 17.3296H12.7938C13.0938 17.3296 13.3409 17.0825 13.3409 16.7825V16.0061C13.3232 15.9178 13.235 15.8296 13.1468 15.8296Z"/>
      <path d="M18.3881 8.02943L18.4829 8.02963C19.0393 8.03139 19.4822 8.03279 19.4822 7.46472C19.4822 6.86472 18.9881 6.37061 18.3881 6.37061C17.7881 6.37061 17.2939 6.86472 17.2939 7.46472C17.2939 8.03279 17.7369 8.03139 18.2932 8.02963L18.3881 8.02943Z"/>
      <path d="M18.1237 11.2588H20.7708C20.8767 11.2588 20.9473 11.347 20.9473 11.4353V12.2117C20.9473 12.5117 20.7002 12.7588 20.4002 12.7588H18.4943C18.1943 12.7588 17.9473 12.5117 17.9473 12.2117V11.4353C17.9473 11.347 18.0179 11.2588 18.1237 11.2588Z"/>
      <path fill-rule="evenodd" clip-rule="evenodd" d="M12.8824 8.34705C12.9 8.3647 12.9176 8.39999 12.9176 8.41764C13.4824 8.68235 13.8882 9.24705 13.8882 9.91764V13.7823C13.8882 14.3823 13.4118 14.8588 12.8118 14.8588H1.07647C0.476471 14.8588 0 14.3823 0 13.7823V9.91764C0 9.24705 0.405882 8.6647 0.988235 8.41764C0.994976 8.40416 0.999142 8.39325 1.0027 8.38394C1.00846 8.36887 1.01262 8.35796 1.02353 8.34705L2.36471 5.99999C2.78824 5.01176 3.74118 4.37646 4.8 4.37646H9.21176C10.2706 4.37646 11.2235 5.01176 11.6471 5.99999L12.8824 8.34705ZM3.31765 6.46764C3.31324 6.47647 3.30882 6.48529 3.3 6.49411L2.29412 8.29411H11.6647L10.7118 6.47646C10.7118 6.47646 10.6941 6.45882 10.6941 6.44117C10.4471 5.82352 9.86471 5.43529 9.22941 5.43529H4.81765C4.16471 5.43529 3.58235 5.82352 3.33529 6.44117C3.32647 6.44999 3.32206 6.45882 3.31765 6.46764ZM1.09412 13.8L12.8294 13.7823V9.91764C12.8294 9.59999 12.5824 9.35293 12.2647 9.35293H1.64118C1.32353 9.35293 1.07647 9.59999 1.07647 9.91764V13.7823C1.07647 13.7912 1.07647 13.7956 1.07868 13.7978C1.08088 13.8 1.08529 13.8 1.09412 13.8Z"/>
    </g>`,

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
