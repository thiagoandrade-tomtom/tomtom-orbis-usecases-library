# Playbook Design System

A consolidated reference for the tokens, scales, and component patterns used across this project. Drop the CSS variable block from `tokens.css` into any new project and the rest of the rules below will produce visually identical chrome.

---

## 1 · Theming

Light is the default; dark applies via `[data-theme="dark"]` on `<html>`. Every component reads tokens, never raw hex values — so a theme flip just re-paints.

```html
<html data-theme="dark"> <!-- toggled by JS, persisted in localStorage -->
```

The theme is **orthogonal** to other axes (map family, projection, etc.). A user can be on dark theme + light-style basemap + satellite imagery — each axis owns its own tokens.

---

## 2 · Surfaces — `--s0` to `--s3` + `--s-hi`

A 5-step scale where `--s0` is the page floor and each step goes one level "up" in elevation. Use `--s0` for backgrounds, `--s1+` for cards / floating panels, `--s2+` for nested elements inside cards.

| Token | Light | Dark | Use for |
|---|---|---|---|
| `--s0` | `#FFFFFF` | `#0C0C12` | Page background, full-bleed map veil |
| `--s1` | `#F2F2F2` | `#292930` | Cards, popups, panel surfaces, hovered FABs |
| `--s2` | `#E5E5E5` | `#41414B` | Nested elements (inputs, chips inside cards), hover-on-card |
| `--s3` | `#CCCCCC` | `#5A5A65` | Subtle dividers when not using border tokens |
| `--s-hi` | `#333333` | `#FFFFFF` | High-contrast surface (brand, CTA fills) |

**Rule:** never use `background: #fff` — always reference a token. Two same-surface elements stacked invisibly is a design smell; bump one up the scale.

---

## 3 · Text — `--t-hi` / `--t-med` / `--t-lo` / `--t-dis`

Opacity in dark mode, true hex in light. Same component reads identical in both.

| Token | Light | Dark | Use for |
|---|---|---|---|
| `--t-hi` | `#000000` | `#FFFFFF` | Headings, primary body, active state |
| `--t-med` | `#5C5C5C` | `rgba(255,255,255,.72)` | Secondary body, table values |
| `--t-lo` | `#959595` | `rgba(255,255,255,.48)` | Labels, captions, idle FAB glyphs |
| `--t-dis` | `#B2B2B2` | `rgba(255,255,255,.32)` | Disabled, placeholder |
| `--t-wh` | `#FFFFFF` | `#FFFFFF` | Always-white text (over brand red, dark imagery) |

---

## 4 · Borders — `--b-base` / `--b-lo` / `--b-med` / `--b-hi`

Tracks the same 4-step intensity as text. In dark mode all four are `rgba(255,255,255,*)` so they're transparent — letting whatever surface is behind tint through.

| Token | Light | Dark | Use for |
|---|---|---|---|
| `--b-base` | `#F2F2F2` | `rgba(255,255,255,.08)` | Resting card outline (invisible by design) |
| `--b-lo` | `#E5E5E5` | `rgba(255,255,255,.16)` | Standard card outline, popup outline |
| `--b-med` | `#CCCCCC` | `rgba(255,255,255,.24)` | Hover state, focus-within |
| `--b-hi` | `#B2B2B2` | `rgba(255,255,255,.32)` | Active / selected outline |

**Rule:** every floating surface (FAB, card, panel, popup) carries a `1px solid var(--b-base)` outline by default. Without it, light mode looks pristine but dark mode loses edge definition.

---

## 5 · Brand & Semantic palette

```
--brand:        #DF1B12   /* TomTom red — CTAs, brand marks ONLY */
--success:      #00A65E
--warn:         #E34A27
--geo:          #1988CF
```

Map / data palette — use for anything *rendered on the map* (markers, lines, polygons). Each has a light variant (default) and a dark variant (auto-swapped under `[data-theme="dark"]`).

| Token | Light | Dark | Semantic |
|---|---|---|---|
| `--c-positive` | `#4CA262` (fern) | `#A5C94E` | Eco / EV / on-track / available |
| `--c-attention` | `#DBA43A` (saffron) | `#EDC15D` | Warning / in-progress / waiting |
| `--c-negative` | `#EE6748` (coral) | `#EE6748` | High attention / failure |
| `--c-neutral` | `#3C5C98` (indigo) | `#56BDB7` | Default markers & route lines |
| `--c-general` | `#646E7B` (gray) | `#9AA3B0` | Inactive / unknown |
| `--c-alternative` | `#6443A1` (amethyst) | `#AF79BE` | Boundaries / focus / selected area |

**Rule:** never use `--brand` red on the map. It collides with the brand logo + topbar CTA and reads as UI chrome, not data.

---

## 6 · Elevation — `--e1` to `--e6`

Six-step box-shadow scale, tuned for soft contact-shadow style (not Material drop-shadows). Origin always above content.

| Token | Use case |
|---|---|
| `--e1` | Pressed-in chips, subtle resting cards |
| `--e2` | FABs at rest, popovers, chip rails |
| `--e3` | Floating panels on top of map |
| `--e4` | Mega-menu / picker dialogs |
| `--e5` | Modal-level dialogs |
| `--e6` | Top-of-stack overlay (rare) |

All shadows use `rgba(17, 12, 34, .08-.12)` — a desaturated near-black so dark mode doesn't crush them to invisibility. (Pure black shadows on `#0C0C12` would vanish.)

---

## 7 · Radius — `--r-sm` to `--r-xl`

| Token | px | Use for |
|---|---|---|
| `--r-sm` | 5 | Badges, kbd glyphs, inline pills |
| `--r-md` | 10 | Buttons, inputs, config rows |
| `--r-lg` | 20 | Cards, panels, popups |
| `--r-xl` | 40 | Topbar pill, primary CTA, "Explore" button |
| `50%` | — | FABs (40×40 circles), close-X buttons |

**Rule:** never invent intermediate values. The four-step scale + circles cover everything.

---

## 8 · Typography

Three families, each with one job. Mixing breaks the visual rhythm.

| Variable | Family | Use ONLY for |
|---|---|---|
| `--f-title` | Gilroy (700 / 600) | Titles, h-levels, button labels, chip text, UPPERCASE micro-labels |
| `--f-body` | Proxima Nova (400 / 600 / 700, regular + italic) | All reading text, popover bodies, descriptions |
| `--f-code` | Fira Code | Code snippets, technical identifiers (hex codes, layer IDs, coordinates) |

**Scale (px / line-height):**

| Role | Size / line |
|---|---|
| Display heading | 24 / 32 |
| Display, ≤720px | 20 / 28 |
| Display, ≤480px | 18 / 24 |
| Sub-display | 16 / 20 |
| Section heading (h4) | 14 / 20 |
| Body | 14 / 20 |
| Small body | 13 / 18 |
| Inline tech label | 13 / 16 (Fira Code) |
| Caption | 12 / 16 |
| Tag / chip | 11 / 14 |
| Micro-label (UPPER) | 10 / 14, letter-spacing `0.4-0.5px` |

UPPERCASE micro-labels are always Gilroy 700, never Proxima.

The display row steps its line-height 32 → 28 → 24 against font 24 → 20 → 18,
so the vertical rhythm stays on the 4px grid as headings shrink. Small-text
line-heights (14, 18) sit off that grid deliberately — at 10-13px, a 4px-grid
line-height is either too tight or too loose to read.

Hero titles (`.mega-title`) run one step above their breakpoint's display
size: 22 / 28 on desktop.

---

## 9 · Spacing rhythm — `4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 80`

This is the TomTom Playbook spacing scale. Every gap, padding and margin
comes from it. Use as raw px (no token — too many to name).

| Value | Use for |
|---|---|
| `4px` | Internal padding of pills, chip-to-chip gap, glyph-to-label gap |
| `8px` | FAB-to-FAB stack, tight clusters, grids of small tiles |
| `12px` | Card-internal sections, chip rail insets |
| `16px` | Topbar internal gap, panel header padding |
| `20px` | Section gaps inside panels |
| `24px` | Page-level breathing room around big surfaces |
| `32px` | Major section breaks |
| `40px` | Large surface insets |
| `80px` | Page-scale separation |

A value off this scale needs a reason recorded next to it, as an inline
marker the audit script reads:

```css
padding: 6px 12px;   /* design-audit-ok(6): reason the 6 is deliberate */
```

Run `npm run audit:design` to check compliance. Two rules worth knowing
before you reach for an off-scale value:

- **Derive the box, not the padding.** When on-scale padding cannot produce
  the height you want (a 40px row around an 18px line, say), declare the
  height and keep the padding on the scale — do not solve it with an 11px
  padding.
- **A 1px border makes a 4px outer box impossible.** Any element with an odd
  number of hairline borders forces `padding + content` to be odd. Chase the
  content box, not the border box, in those cases.

> Earlier revisions of this section listed `4 / 8 / 12 / 16 / 24` in the
> heading while the table beneath it also sanctioned `10px`. That gap is
> where most of the project's `10px` drift came from — 28 occurrences at
> its peak. Both now agree with Playbook, and `10px` is gone.

---

## 10 · Component patterns

### FAB (Floating Action Button) — `40×40` circle

```
width / height: 40px
background:      var(--s0)
border:          1px solid var(--b-base)
border-radius:   50%
box-shadow:      var(--e2)
color:           var(--t-hi)
icon:            18-22px (mask glyph, currentColor)
hover:           background → var(--s1), translateY(-1px), transition .15s
```

Stack vertically with `gap: 8px`. Inner icon transitions `transform .35s ease-out` for compass-like rotation.

### Card / popup — `.pop`

```
min-width:       260px
max-width:       320px
background:      var(--s1)
border:          1px solid var(--b-lo)
border-radius:   var(--r-lg)
box-shadow:      var(--e3)
padding:         16px 20px
font-family:     var(--f-body)
```

Header pattern: eyebrow micro-label (Gilroy 700, --t-lo) → title (Gilroy 700, --t-hi, 16/22) → subtitle (Proxima 400, --t-med). Rows divided by `1px solid var(--b-base)`.

### Floating panel (detail/mega-menu)

```
width:           360px (detail), 100vw - 32px (mega)
background:      var(--s0)
border:          1px solid var(--b-lo)
border-radius:   var(--r-lg)
box-shadow:      var(--e4)
max-height:      var(--dialog-max-h)    /* min(640px, 100dvh - 152px) */
overflow:        hidden                 /* internal scroll on .panel-body */
```

Header: 48-56px tall, `padding: 12px 16px`, sticky. Body scrolls below.

### Chip rail

Single-select OR multi-select rails share styling. Variant via class.

```
chip:
  font-family:   var(--f-title)  /* Gilroy 700 */
  font-size:     11px / 14px
  letter-spacing: 0.4px
  text-transform: uppercase
  color:         var(--t-lo)
  background:    transparent
  border:        1px solid var(--b-base)
  border-radius: 999px
  padding:       6px 10px 6px 8px
  cursor:        pointer
  transition:    background .12s, color .12s, border-color .12s

chip:hover:
  border-color:  var(--b-med)
  color:         var(--t-med)

chip.is-on:
  background:    var(--s2)
  color:         var(--t-hi)
  border-color:  var(--b-med)
```

A row may optionally append a hint with `.dd-cfg-chip-hint { font-size: 9px; opacity: .75; margin-left: 4px; }` for inline annotations ("default", "no dark", etc.).

### Configure row — `.dd-cfg-row`

Label on the left, control on the right.

```
display:         flex; align-items: center; justify-content: space-between
gap:             12px
padding:         10px 12px
background:      var(--s1)
border:          1px solid var(--b-base)
border-radius:   var(--r-md)
transition:      border-color .15s

hover:           border-color: var(--b-med)
focus-within:    border-color: var(--brand)
```

Variant `--chips` flips to column layout for chip rails (chips wrap below the label).

### Inputs

`16px` minimum font-size on mobile (`@media (max-width: 720px)`) — iOS auto-zooms anything smaller. Selectors covered:

```
#search, .dd-cfg-input, .dd-cfg-combo-input, .dd-cfg-select select,
.access-input input, input[type="text|search|email|number|password|tel|url"],
select, textarea
```

Native dropdown chrome stripped via `appearance: none` + a sibling `<svg class="dd-cfg-chev">` painted with currentColor.

### Close-X button

Always a 28×28 hit area with a 10×10 mask glyph centred via `position: absolute; inset: 0; margin: auto`. The mask reads `var(--ico-x)`. Hover brightens `color` only — no surface bump, no border ring.

```
.close-btn {
  width: 28px; height: 28px;
  position: absolute; top: 0; right: 0; margin: 6px 6px 0 0;
  border: 1px solid transparent;       /* reserves layout */
  border-radius: 50%;
  background: transparent;
  color: var(--t-lo);
  font-size: 0; line-height: 0;        /* collapse native × glyph */
}
.close-btn::before {
  content: '';
  position: absolute; inset: 0; margin: auto;
  width: 10px; height: 10px;
  background-color: currentColor;
  -webkit-mask: var(--ico-x) center / contain no-repeat;
          mask: var(--ico-x) center / contain no-repeat;
}
.close-btn:hover { color: var(--t-hi); }   /* glyph brighten ONLY */
```

---

## 11 · Hover & interaction rules

- **Surface bumps go up the scale.** `--s0` → `--s1` on hover, `--s1` → `--s2`. Never invert.
- **Close / icon-only buttons** brighten the glyph (`--t-lo` → `--t-hi`) but DO NOT change surface. Surface bumps on tiny buttons read as floating chips.
- **Cards** brighten their border (`--b-base` → `--b-med`) on hover; surface stays.
- **Focus visible:** `focus-within` on rows promotes border to `--brand`.
- **Transitions:** `.12s-.15s` for color/background, `.15s` for transforms, `.35s ease-out` for ornamental rotation (compass needle).

---

## 12 · Breakpoints

```
≥ 900px    Desktop — full floating layout, attribution chrome visible
720–900px  Tablet — narrower detail panel (320px), no map attribution
≤ 720px    Phone — drawers: panels slide up from bottom, topbar becomes pill
≤ 480px    Small — tighter typography, brand wordmark hidden
≤ 360px    Tiny — further compaction
```

Responsive CSS is the **last imported sheet** so its `@media` rules win equal-specificity ties. Putting component CSS after responsive is the #1 cause of layout regressions.

---

## 13 · Dialog geometry

Every floating dialog (mega-menu, detail panel, map popup) caps height with a shared token:

```
--dialog-max-h: min(640px, calc(100dvh - 152px));
```

`152px` reserves space for the topbar + bottom attribution / safe-area. `dvh` (not `vh`) accommodates mobile browser chrome that comes and goes.

---

## 14 · Map "space" colours (globe-projection extra)

When the map renders in globe projection, the area outside the sphere is a dedicated token, independent from `--s0`:

```
:root                       --map-space-deep:    #D8E4EF      (slate-blue daytime sky)
                            --map-space-horizon: #7BA8D4

[data-theme="dark"]         --map-space-deep:    #0C1422      (deep navy night)
                            --map-space-horizon: #3A6BA3

[data-map-family="satellite"]                                  (override: night-sky on any theme)
                            --map-space-deep:    #0C1422
                            --map-space-horizon: #3A6BA3
```

`--map-space-deep` is the background of `.stage`; `--map-space-horizon` feeds MapLibre's `setSky({ horizon-color })` for the atmospheric glow at the planet's limb.

---

## 15 · Animation timing

| Use | Duration | Easing |
|---|---|---|
| Hover (color, bg, border) | 120-150 ms | default |
| Hover transform (FAB lift) | 150 ms | default |
| Ornamental rotation (compass needle) | 350 ms | `ease-out` |
| Tile cross-fade (style swap) | 220 ms | (MapLibre native) |
| Camera easeTo (pitch / bearing reset) | 500 ms | (MapLibre native) |
| fitBounds | 900 ms | (MapLibre native) |
| Camera flyTo on case load | 1500 ms | (MapLibre native) |

---

## 16 · Iconography

- Single source for `×`: `var(--ico-x)` (inline 7×7 SVG, painted via mask + currentColor)
- All FAB / chip icons are inline SVG with `stroke-width: 2-2.4`, `stroke-linejoin: round`, `stroke-linecap: round`, `fill="none"` for outlines or `fill="currentColor"` for solids
- Icon viewBox: `0 0 24 24`, rendered square at one of four sizes:

| Size | Use for |
|---|---|
| `22×22` | Text-label glyphs that must read as type (`2D` / `3D` in the compass) |
| `18×18` | Map-control FABs — locate, theme toggle |
| `16×16` | Default. Search, chip and panel-header glyphs |
| `12×12` | Dense inline glyphs inside tags and micro-labels |

- All icons read currentColor so theme tokens drive their tint automatically

> This section previously named 18 / 22 as the only two sizes. `16×16` was
> in fact the most-used size in the app and `12×12` and `14×14` were also in
> circulation. The table above records what the app actually does; `14×14`
> is being folded into `16×16` as those call sites are touched.

---

## 17 · Accessibility hit areas

- FABs: 40×40 (above the 44×44 mobile target; topbar pill is 52×52 on mobile)
- Close-X: 28×28 hit area with a 10×10 visible glyph
- Chips: 28-32px tall (depending on content) with 8-10px horizontal padding
- Inputs: 16px minimum font-size on mobile (iOS zoom guard)

---

## 18 · One-line summary

> **Surfaces stack up the `s` scale, text steps down the `t` scale, every floating thing carries `--b-base` + `var(--e2-4)`, no surface bumps on tiny buttons, no brand red on the map, and responsive.css is imported last.**

Carry those six rules + the token block from `tokens.css` and the visual language ports cleanly to any new project.
