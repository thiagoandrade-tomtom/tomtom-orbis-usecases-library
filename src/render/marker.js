/* TomTom-style map marker factory — shape from POI_example.svg.
   40×47 viewBox: filled teardrop body + inner depth stroke + icon at (20,20).
   Optional status badge circle at top-right (33,7).

   Icon entries support two formats:
   - string → legacy 16×16 white-fill SVG fragment (positioned via translate)
   - { lucide: '...' } → 24×24 Lucide stroke SVG fragment; scaled to fit
     and rendered as white strokes with non-scaling width for crisp lines. */

// Exact paths from the reference SVG
const PATH_BODY  = 'M34.1421 5.85786C26.3316 -1.95262 13.6683 -1.95262 5.85786 5.85786C-1.95262 13.6683 -1.95262 26.3316 5.85786 34.1421C6.48449 34.7688 7.14235 35.3451 7.82644 35.8712C11.6514 38.8127 15.8554 41.5713 18.268 45.75C19.0378 47.0833 20.9623 47.0833 21.7321 45.75C24.1447 41.5712 28.3488 38.8126 32.1737 35.8711C32.8577 35.345 33.5155 34.7687 34.1421 34.1421C41.9526 26.3316 41.9526 13.6683 34.1421 5.85786Z';
const PATH_INNER = 'M6.56543 6.56543C13.9854 -0.854531 26.0146 -0.854531 33.4346 6.56543C40.8545 13.9854 40.8545 26.0146 33.4346 33.4346C32.8388 34.0304 32.2141 34.5785 31.5645 35.0781C27.8382 37.9437 23.4055 40.8518 20.8662 45.25C20.5054 45.875 19.6372 45.914 19.2129 45.3672L19.1338 45.25C16.5945 40.8519 12.1627 37.9436 8.43652 35.0781C7.78667 34.5784 7.16136 34.0305 6.56543 33.4346C-0.854531 26.0146 -0.854531 13.9854 6.56543 6.56543Z';

/* Lucide icons stroke in `currentColor` so the pin wrapper can drive the
   colour via CSS (white in light theme, near-black in dark — see `wrap`).
   non-scaling-stroke keeps the line crisp at the small render size. */
const LUCIDE_STROKE_ATTRS =
  `fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"`;

// Legacy 16×16 white-fill icons kept for shapes that don't have a better
// Lucide equivalent (dot/bars/flag/star) and the bolt clusters for EV tiers.
// Themed icons (vehicles, places, people) now point at Lucide stroke sources
// — same key names so scenes don't need to know which format is in use.
export const ICONS = {
  dot:      `<circle cx="8" cy="8" r="5" fill="currentColor"/>`,
  bars:     `<path fill="currentColor" d="M0 16V8h4v8zm6 0V4h4v12zm6 0V0h4v16z"/>`,
  flag:     `<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4 16V1m0 0 9 4.5L4 9"/>`,
  star:     `<path fill="currentColor" d="M8 0l2.5 5H16l-4.5 3.5L13 14 8 11l-5 3 1.5-5.5L0 5h5.5z"/>`,

  location: { lucide: `
    <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
    <circle cx="12" cy="10" r="3" />` },
  truck: { lucide: `
    <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
    <path d="M15 18H9" />
    <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
    <circle cx="17" cy="18" r="2" />
    <circle cx="7" cy="18" r="2" />` },
  pkg: { lucide: `
    <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
    <path d="M12 22V12" />
    <polyline points="3.29 7 12 12 20.71 7" />
    <path d="m7.5 4.27 9 5.15" />` },
  house: { lucide: `
    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
    <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />` },
  run: { lucide: `
    <circle cx="12" cy="5" r="1" />
    <path d="m9 20 3-6 3 6" />
    <path d="m6 8 6 2 6-2" />
    <path d="M12 10v4" />` },
  building: { lucide: `
    <path d="M10 12h4" />
    <path d="M10 8h4" />
    <path d="M14 21v-3a2 2 0 0 0-4 0v3" />
    <path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" />
    <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />` },
  bike: { lucide: `
    <circle cx="18.5" cy="17.5" r="3.5" />
    <circle cx="5.5" cy="17.5" r="3.5" />
    <circle cx="15" cy="5" r="1" />
    <path d="M12 17.5V14l-3-3 4-3 2 3h2" />` },
  car: { lucide: `
    <path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8" />
    <path d="M7 14h.01" />
    <path d="M17 14h.01" />
    <rect width="18" height="8" x="3" y="10" rx="2" />
    <path d="M5 18v2" />
    <path d="M19 18v2" />` },

  // Lightning-bolt clusters for EV chargers — 1 bolt = slow AC, 2 bolts = fast AC,
  // 3 bolts = rapid DC. Each bolt drawn as a chevron-style path inside the 16×16 icon box.
  bolt1: `<path fill="currentColor" d="M10.4 0 L3 8.4 L7.2 8.4 L5.6 16 L13 7.2 L8.8 7.2 Z"/>`,
  bolt2: `
    <path fill="currentColor" d="M5.9 1.6 L1 8 L3.8 8 L2.7 14.4 L7.6 7 L4.8 7 Z"/>
    <path fill="currentColor" d="M13.1 1.6 L8.2 8 L11 8 L9.9 14.4 L14.8 7 L12 7 Z"/>`,
  bolt3: `
    <path fill="currentColor" d="M3.7 2.4 L0 8 L2.1 8 L1.3 13.6 L5 7 L3 7 Z"/>
    <path fill="currentColor" d="M9.4 2.4 L5.7 8 L7.8 8 L7 13.6 L10.7 7 L8.7 7 Z"/>
    <path fill="currentColor" d="M15.1 2.4 L11.4 8 L13.5 8 L12.7 13.6 L16.4 7 L14.4 7 Z"/>`,

  // Lucide icons — 24×24 stroke sources, scaled and stroked white via LUCIDE_STROKE_ATTRS.
  // Add new ones by fetching from https://unpkg.com/lucide-static@latest/icons/<name>.svg
  // and pasting just the inner shape tags into a { lucide: `...` } entry.
  coffee: { lucide: `
    <path d="M10 2v2" />
    <path d="M14 2v2" />
    <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" />
    <path d="M6 2v2" />` },
  utensils: { lucide: `
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
    <path d="M7 2v20" />
    <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />` },
  shopping: { lucide: `
    <path d="M16 10a4 4 0 0 1-8 0" />
    <path d="M3.103 6.034h17.794" />
    <path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z" />` },
  parking: { lucide: `
    <circle cx="12" cy="12" r="10" />
    <path d="M9 17V7h4a3 3 0 0 1 0 6H9" />` },
  plug: { lucide: `
    <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
    <path d="m2 22 3-3" />
    <path d="M7.5 13.5 10 11" />
    <path d="M10.5 16.5 13 14" />
    <path d="m18 3-4 4h6l-4 4" />` },
  train: { lucide: `
    <path d="M8 3.1V7a4 4 0 0 0 8 0V3.1" />
    <path d="m9 15-1-1" />
    <path d="m15 15 1-1" />
    <path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z" />
    <path d="m8 19-2 3" />
    <path d="m16 19 2 3" />` },
  bus: { lucide: `
    <path d="M8 6v6" />
    <path d="M15 6v6" />
    <path d="M2 12h19.6" />
    <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3" />
    <circle cx="7" cy="18" r="2" />
    <path d="M9 18h5" />
    <circle cx="16" cy="18" r="2" />` },
  target: { lucide: `
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />` },
  alert: { lucide: `
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />` },
  clock: { lucide: `
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />` },
};

/* Build the centered icon `<g>` for a pin. Handles both legacy 16×16
   white-fill fragments and 24×24 Lucide stroke fragments — the Lucide
   path coords are scaled (16/24 = 0.6667) so the icon visually occupies
   the same 16×16 slot as a legacy icon. */
function iconGroup(icon) {
  if (icon && typeof icon === 'object' && icon.lucide) {
    return `<g transform="translate(12,12) scale(0.6667)" ${LUCIDE_STROKE_ATTRS}>${icon.lucide}</g>`;
  }
  return `<g transform="translate(12,12)" fill="currentColor">${icon}</g>`;
}

function pinSVG(color, icon, badge) {
  const badgeSVG = badge
    ? `<circle cx="33" cy="7" r="5" fill="${badge}" stroke="white" stroke-width="2"/>`
    : '';
  return `<svg width="40" height="47" viewBox="0 0 40 47" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="${PATH_BODY}" fill="${color}"/>
  <path d="${PATH_INNER}" stroke="black" stroke-opacity="0.3" stroke-width="2"/>
  ${iconGroup(icon)}
  ${badgeSVG}
</svg>`;
}

/* Default render size — pins keep their 40:47 teardrop aspect ratio but
   render small on the map (24px wide). Internal SVG paths still use the
   40×47 viewBox so the icon and badge geometry don't need to change.

   `color: var(--s0)` drives the icon foreground via CSS currentColor —
   white in light theme, near-black in dark theme — so icons stay legible
   on the lighter pin colours used by the dark palette. */
function wrap(svg, w = 24, h = 28) {
  const el = document.createElement('div');
  el.style.cssText = `width:${w}px;height:${h}px;cursor:pointer;color:var(--s0);filter:drop-shadow(0 2px 4px rgba(0,0,0,0.38))`;
  el.innerHTML = svg;
  return el;
}

/** Standard TomTom teardrop pin. Icon foreground tracks `var(--s0)`
    (white on light theme, near-black on dark). iconKey → ICONS. */
export function createPin(color, iconKey = 'dot', badge) {
  return wrap(pinSVG(color, ICONS[iconKey] ?? ICONS.dot, badge));
}

/** Pin with a Gilroy number label — for ordered waypoints. */
export function createNumberPin(color, n) {
  const label = `<text x="8" y="12" text-anchor="middle" dominant-baseline="middle"
    fill="currentColor" font-family="Gilroy,Nunito,sans-serif" font-weight="700" font-size="13">${n}</text>`;
  return wrap(pinSVG(color, label));
}

/** EV charger pin — bolt count + colour scale with charging speed,
    mirroring the TomTom LDEVR sample (slow / regular / fast / ultra-fast).
    A small pill below the pin shows the charging duration so the user
    can scan the route and read "this stop adds 12 min" without clicking. */
const CHARGER_TIERS = [
  { max: 22,    speed: 'slow',       icon: 'bolt1', color: '#7AA15A' },
  { max: 50,    speed: 'regular',    icon: 'bolt2', color: '#4CA262' },
  { max: 150,   speed: 'fast',       icon: 'bolt3', color: '#2F8F46' },
  { max: Infinity, speed: 'ultra-fast', icon: 'bolt3', color: '#1F6F33' },
];

export function chargerTier(kw) {
  return CHARGER_TIERS.find(t => kw <= t.max) || CHARGER_TIERS[CHARGER_TIERS.length - 1];
}

export function createChargerPin({ kw = 50, durationLabel, name } = {}) {
  const tier = chargerTier(kw);
  // The wrapper is sized to the pin only (so MapLibre's bottom-anchor
  // lands on the pin tip). The text label hangs out to the right as an
  // absolutely positioned overlay — like the TomTom LDEVR sample.
  const wrap = document.createElement('div');
  wrap.style.cssText = `
    position:relative;width:30px;height:35px;cursor:pointer;color:var(--s0);
    filter:drop-shadow(0 2px 4px rgba(0,0,0,0.38))`;
  wrap.innerHTML = pinSVG(tier.color, ICONS[tier.icon]);

  if (name || durationLabel) {
    const label = document.createElement('div');
    label.style.cssText = `
      position:absolute;left:34px;bottom:0;display:flex;flex-direction:column;
      align-items:flex-start;line-height:1.15;font-family:Gilroy,Nunito,sans-serif;
      color:#1A1F2A;text-shadow:0 1px 0 rgba(255,255,255,0.9), 0 0 4px rgba(255,255,255,0.9)`;
    if (name) {
      const n = document.createElement('span');
      n.style.cssText = `font-weight:700;font-size:13px;white-space:nowrap`;
      n.textContent = name;
      label.appendChild(n);
    }
    if (durationLabel) {
      const meta = document.createElement('span');
      meta.style.cssText = `font-weight:600;font-size:11px;color:#3D4654;white-space:nowrap`;
      meta.textContent = `${kw ? `${Math.round(kw)} kW · ` : ''}${durationLabel}`;
      label.appendChild(meta);
    }
    wrap.appendChild(label);
  }
  return wrap;
}

/** Small dot for splits, sub-POIs, secondary points. The border picks
    up the UI surface colour (--s0) — same logic as the route casing
    halo — so the dot stays visible against any basemap. Shadow geometry
    mirrors the teardrop pin so dots and pins read as one family. */
export function createDot(color, size = 12) {
  const el = document.createElement('div');
  el.style.cssText = `
    width:${size}px;height:${size}px;border-radius:50%;
    background:${color};border:2px solid var(--s0);
    filter:drop-shadow(0 2px 4px rgba(0,0,0,0.38));cursor:pointer`;
  return el;
}

/** Price / label badge pill — Real Estate listings. */
export function createBadge(color, text) {
  const el = document.createElement('div');
  el.style.cssText = `
    font-family:Gilroy,sans-serif;font-weight:700;font-size:11px;
    color:#fff;background:${color};padding:5px 11px;
    border-radius:20px;border:2px solid rgba(255,255,255,0.85);
    box-shadow:0 2px 8px rgba(0,0,0,0.40);white-space:nowrap;cursor:pointer`;
  el.textContent = text;
  return el;
}
