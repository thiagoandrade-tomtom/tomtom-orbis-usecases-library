/* Split / sidebar shell.
   Same map+scene engine as the Full-map view (main.js), wrapped in a
   two-column layout: a docked sidebar (picker + detail) beside the map.
   No floating mega-menu and no draggable panel — the picker and the
   detail live permanently in the rail. Everything layout-agnostic
   (theme, gate, deep-link, attribution) comes from app/core. */

import '../styles/split.css';
import '../map/config.js';

import {
  readTheme, watchDeviceTheme, injectAttribLogo, bindAccessGate,
  readCaseSlug, findCaseBySlug, writeCaseSlug,
} from '../app/core.js';

import { MapProvider } from '../map/provider.js';
import { getScene } from '../scenes/index.js';
import { state, getSelected, setBasemapOverride } from '../state.js';
import { bindList, renderCaseList, renderCategoryChips } from '../ui/list.js';
import { bindDetail, renderDetail, refreshDetailLiveTokens } from '../ui/detail.js';
import { bindMapControls } from '../ui/mapctls.js';

/* ── Master-detail navigation ─────────────────────────────────────────
   The rail is one panel with two views. `showList`/`showDetail` just flip
   a class on the sidebar; CSS handles the slide. The selected case stays
   loaded on the map in both views — "back" is panel navigation, not a
   deselect — so the list simply re-highlights whatever is active. */
function showList() {
  const sb = document.querySelector('.sidebar');
  sb?.classList.remove('is-detail');
  document.getElementById('view-detail')?.setAttribute('aria-hidden', 'true');
  document.getElementById('view-list')?.removeAttribute('aria-hidden');
  // Return focus to the active row (or the first chip) for keyboard users.
  const target = document.querySelector('.case-row.is-active') || document.querySelector('#cat-chips .chip');
  target?.focus?.({ preventScroll: true });
}
function showDetail() {
  const sb = document.querySelector('.sidebar');
  sb?.classList.add('is-detail');
  document.getElementById('view-list')?.setAttribute('aria-hidden', 'true');
  document.getElementById('view-detail')?.removeAttribute('aria-hidden');
  document.getElementById('back-btn')?.focus?.({ preventScroll: true });
}

/* ── Resizable rail ────────────────────────────────────────────────────
   Drag the divider to set the sidebar width; double-click resets, arrow
   keys nudge. Width is clamped (rail stays usable, map keeps ≥ half the
   viewport) and remembered per browser. The map is told to `resize()` as
   the column changes so its canvas tracks the new width. */
/* MIN is 340, not 300: below that the longest case titles ("Neighbourhood
   analysis") start ellipsizing in the list card, and a cut title is the
   one truncation the card can't afford. Measured against the widest
   title in the catalog — revisit if a longer one is added. */
const RAIL = { MIN: 340, DEFAULT: 384, KEY: 'split-sidebar-w' };
function railMax() { return Math.min(560, Math.round(window.innerWidth * 0.5)); }
function clampRail(w) { return Math.max(RAIL.MIN, Math.min(railMax(), Math.round(w))); }

function bindResizer(provider) {
  const split  = document.querySelector('.split');
  const sidebar = document.querySelector('.sidebar');
  const handle = document.getElementById('resizer');
  if (!split || !sidebar || !handle) return;

  const currentW = () => sidebar.getBoundingClientRect().width;
  const apply = (w, persist) => {
    const c = clampRail(w);
    split.style.setProperty('--sidebar-w', c + 'px');
    handle.setAttribute('aria-valuenow', String(c));
    provider?.mapLibreMap?.resize();
    if (persist) { try { localStorage.setItem(RAIL.KEY, String(c)); } catch {} }
    return c;
  };

  handle.setAttribute('aria-valuemin', String(RAIL.MIN));
  handle.setAttribute('aria-valuemax', String(railMax()));

  // Restore a remembered width.
  try {
    const saved = parseInt(localStorage.getItem(RAIL.KEY), 10);
    if (Number.isFinite(saved)) apply(saved, false);
    else handle.setAttribute('aria-valuenow', String(RAIL.DEFAULT));
  } catch { handle.setAttribute('aria-valuenow', String(RAIL.DEFAULT)); }

  let dragging = false, startX = 0, startW = 0, raf = 0;
  handle.addEventListener('pointerdown', e => {
    dragging = true; startX = e.clientX; startW = currentW();
    handle.classList.add('is-active');
    document.body.classList.add('is-resizing');
    try { handle.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging || raf) return;
    const w = startW + (e.clientX - startX);
    raf = requestAnimationFrame(() => { raf = 0; apply(w, false); });
  });
  const end = e => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('is-active');
    document.body.classList.remove('is-resizing');
    try { handle.releasePointerCapture(e.pointerId); } catch {}
    apply(currentW(), true);                       // persist the final width
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);

  handle.addEventListener('dblclick', () => apply(RAIL.DEFAULT, true));
  handle.addEventListener('keydown', e => {
    const step = e.shiftKey ? 32 : 16;
    if (e.key === 'ArrowLeft')  { apply(currentW() - step, true); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { apply(currentW() + step, true); e.preventDefault(); }
    else if (e.key === 'Home') { apply(RAIL.DEFAULT, true); e.preventDefault(); }
  });

  // Keep the rail within bounds (and the map sized) if the window changes.
  window.addEventListener('resize', () => {
    handle.setAttribute('aria-valuemax', String(railMax()));
    apply(currentW(), false);
  });
}

/* ── Category chip scroller ────────────────────────────────────────────
   The chip rail overflows the narrow sidebar. Wire the ‹ › buttons to
   scroll it, and show them (plus the edge fades) only when there's more
   off-screen in that direction. Re-checked on scroll, resize, and whenever
   the chips re-render (filtering swaps the rail's innerHTML). */
function bindChipScroll() {
  const rail = document.getElementById('cat-chips');
  const wrap = rail?.closest('.chip-scroll');
  const prev = document.getElementById('chips-prev');
  const next = document.getElementById('chips-next');
  if (!rail || !wrap) return;

  const update = () => {
    const max = rail.scrollWidth - rail.clientWidth;
    const overflow = max > 2;
    const canPrev = overflow && rail.scrollLeft > 1;
    const canNext = overflow && rail.scrollLeft < max - 1;
    wrap.classList.toggle('can-prev', canPrev);
    wrap.classList.toggle('can-next', canNext);
    if (prev) prev.hidden = !canPrev;
    if (next) next.hidden = !canNext;
  };
  const step = () => Math.max(120, Math.round(rail.clientWidth * 0.7));

  prev?.addEventListener('click', () => rail.scrollBy({ left: -step(), behavior: 'smooth' }));
  next?.addEventListener('click', () => rail.scrollBy({ left:  step(), behavior: 'smooth' }));
  rail.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  // Filtering rebuilds the chips (innerHTML swap) — recheck when that happens.
  new MutationObserver(update).observe(rail, { childList: true });

  update();
  requestAnimationFrame(update);
}

/* ── Search ────────────────────────────────────────────────────────────
   The lupa button toggles an inline field in the nav bar; typing filters
   the list live via state.query (the same path the Full-map search uses).
   Closing clears the query so the list returns to full. */
function bindSearch() {
  const bar = document.querySelector('.nav-bar');
  const btn = document.getElementById('search-btn');
  const input = document.getElementById('split-search');
  if (!bar || !btn || !input) return;

  const open = () => { bar.classList.add('searching'); requestAnimationFrame(() => input.focus()); };
  const close = () => {
    bar.classList.remove('searching');
    if (state.query) { state.query = ''; renderCaseList(); }
    input.value = '';
  };
  btn.addEventListener('click', () => bar.classList.contains('searching') ? close() : open());
  input.addEventListener('input', () => { state.query = input.value; renderCaseList(); });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
}

async function boot() {
  const theme = readTheme();
  document.documentElement.setAttribute('data-theme', theme);

  const provider = new MapProvider({ container: 'map-canvas', theme });
  injectAttribLogo();

  /* Theme toggle — sidebar button. Mirrors the topbar toggle in main.js:
     flip the attribute, persist the choice, repaint the basemap + tokens. */
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('orbis-theme', next); } catch {}
    provider.setTheme(next).then(refreshDetailLiveTokens);
  });
  watchDeviceTheme(t => {
    document.documentElement.setAttribute('data-theme', t);
    provider.setTheme(t).then(refreshDetailLiveTokens);
  });

  bindList({ onSelect: id => openCase(provider, id) });
  bindChipScroll();
  bindSearch();
  document.getElementById('back-btn')?.addEventListener('click', () => leaveCase(provider));
  bindResizer(provider);
  bindMapControls(provider);
  bindDetail({
    provider,
    onParamChange: uc => provider.setScene(getScene(uc.mapType), uc),
    onBasemapChange: (uc, family) => {
      setBasemapOverride(uc, family);
      provider.setStyleFamily(family).then(refreshDetailLiveTokens);
    },
  });

  /* "reset filters" in the empty state — the topbar owns this in Full
     map; the split rail wires its own since it has no topbar. */
  document.getElementById('empty-reset')?.addEventListener('click', () => {
    state.category = 'all';
    state.query = '';
    renderCategoryChips();
    renderCaseList();
  });

  provider.mapLibreMap?.on('moveend', refreshDetailLiveTokens);

  // Deep link `?case=<mapType>` opens that case straight in the detail
  // view; otherwise we land on the list.
  const enterApp = () => {
    const deepLinked = findCaseBySlug(readCaseSlug());
    if (deepLinked) openCase(provider, deepLinked.id);
    else            showList();
  };

  bindAccessGate(enterApp);
}

/* Load a case onto the map (if not already active) and slide the detail
   view in. The panel opens immediately — the scene loads behind it — so
   navigation stays snappy and a slow (or failing) map load never blocks
   the detail. Re-selecting the active case just re-opens its detail. */
async function openCase(provider, id) {
  const alreadyActive = id === state.selectedId;
  if (!alreadyActive) {
    state.selectedId = id;
    renderCaseList();                            // re-highlight the active row
    renderDetail();                              // fills #detail-content (showPanel no-ops without a panel)
    const cur = document.getElementById('nav-current');
    if (cur) cur.textContent = getSelected()?.title || '';   // breadcrumb crumb
  }
  showDetail();                                  // slide in now, regardless of scene load
  if (!alreadyActive) {
    const uc = getSelected();
    if (uc) {
      writeCaseSlug(uc.mapType);
      document.querySelector('.detail-scroll')?.scrollTo(0, 0);
      try {
        await provider.setScene(getScene(uc.mapType), uc);
      } catch (err) {
        // Map scene failed to load (e.g. no API key in this env) — the
        // detail view stays fully usable, so just note it and move on.
        console.warn('[split] scene load failed', err);
      }
    }
  }
}

/* Leaving a case (back button) returns the map to its original state —
   scene torn down, basemap + camera reset to the default view — matching
   the Full-map dismiss. The rail slides back to the list with no active
   selection, so the next pick loads fresh. */
async function leaveCase(provider) {
  state.selectedId = null;
  writeCaseSlug(null);
  renderCaseList();                              // drop the active-row highlight
  showList();                                    // slide back immediately
  try {
    await provider.clearScene();                 // reset basemap + camera to DEFAULT_VIEW
  } catch (err) {
    console.warn('[split] clearScene failed', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
