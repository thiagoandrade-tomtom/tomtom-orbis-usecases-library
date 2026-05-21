/* App entry. Boots the map provider, wires the UI, and opens the
   unified mega-menu on first load — that menu is both the intro and
   the use-case picker, so we only ever show one overlay. */

import './styles/index.css';
import './map/config.js';

/* MapLibre ships its worker as a UMD blob-string that's wired up only in
   the global-init path. When rolldown bundles maplibre-gl as ESM, the
   global init can be skipped, leaving `WORKER_URL: ""` and `new Worker("")`
   silently producing a no-op worker — geojson features never get processed,
   so custom layers (route polylines, etc) never render. Import maplibre's
   dedicated worker entry as a URL asset and feed it back via setWorkerUrl
   before any Map is constructed. */
import maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker?url';
maplibregl.setWorkerUrl(workerUrl);

import { MapProvider } from './map/provider.js';
import { getScene } from './scenes/index.js';
import { state, getSelected } from './state.js';
import { USE_CASES } from './data/use-cases.js';
import { bindList, renderCaseList } from './ui/list.js';
import { bindDetail, renderDetail, refreshDetailLiveTokens } from './ui/detail.js';
import { bindTopbar, closeMegaMenu, openMegaMenu } from './ui/topbar.js';
import { bindMapControls } from './ui/mapctls.js';
import { bindPanel } from './ui/panel.js';
import { bindDebug } from './ui/debug.js';

/* Deep-link plumbing — `?case=<mapType>` opens that demo directly and
   stays in sync as the user navigates. Using `mapType` as the slug
   keeps URLs human-readable (e.g. `/?case=multistop`) without needing
   a separate `slug` field on each use case. */
const CASE_PARAM = 'case';
function readCaseSlug() {
  return new URLSearchParams(window.location.search).get(CASE_PARAM);
}
function findCaseBySlug(slug) {
  return slug ? USE_CASES.find(u => u.mapType === slug) : null;
}
function writeCaseSlug(slug) {
  const url = new URL(window.location.href);
  if (slug) url.searchParams.set(CASE_PARAM, slug);
  else      url.searchParams.delete(CASE_PARAM);
  history.replaceState(null, '', url);
}

/* Restricted-entry gate — soft client-side lock. Compares the typed
   password to `VITE_ACCESS_PASSWORD` (set in `.env` locally and as a repo
   secret in CI). On success we flip `<html>` into the unlocked state and
   remember it for the rest of the tab via sessionStorage.

   NOTE: any client-side check is bypassable by inspecting the bundle.
   This is a casual deterrent for sharing links, not real security. */
const STORAGE_KEY = 'o';
function isUnlocked() {
  try { return sessionStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}
function markUnlocked() {
  try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch {}
  document.documentElement.classList.add('is-unlocked');
}

/* Toggle the HTML `inert` attribute on every top-level body element
   that isn't the gate itself. `inert` blocks ALL interaction (mouse,
   keyboard, focus traversal), so Cmd+K shortcuts and any pre-bound
   keydown handlers in the topbar stay quiet while the gate is up. */
function setAppInert(locked) {
  for (const el of document.body.children) {
    if (el.id === 'access-gate') continue;
    el.inert = locked;
  }
}

function bindAccessGate(onUnlock) {
  // Already authenticated this tab — gate is already hidden by the inline
  // <head> script; just fire the post-unlock callback and bail.
  if (isUnlocked()) { onUnlock?.(); return; }

  // Lock the rest of the app behind the gate (clicks, shortcuts, focus).
  setAppInert(true);

  const form  = document.getElementById('access-form');     // the form *is* the .access-card
  const input = document.getElementById('access-password');
  const error = document.getElementById('access-error');
  if (!form) return;

  // Focus the password field as soon as the gate is visible.
  requestAnimationFrame(() => input?.focus());

  const expected = import.meta.env.VITE_ACCESS_PASSWORD || 'orbis-demo';
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (input.value === expected) {
      markUnlocked();
      setAppInert(false);
      onUnlock?.();
    } else {
      error.hidden = false;
      form.classList.add('is-error');
      input.value = '';
      input.focus();
      setTimeout(() => form.classList.remove('is-error'), 400);
    }
  });
}

function readTheme() {
  try {
    const saved = localStorage.getItem('orbis-theme');
    if (saved) return saved;
  } catch {}
  return 'dark';
}

/* Inline the attribution SVG so its `currentColor` glyphs and
   `var(--s0)` knockout strokes resolve against the active theme. */
async function injectAttribLogo() {
  const slot = document.getElementById('attr-logo');
  if (!slot) return;
  try {
    // BASE_URL keeps this working under a sub-path deploy (e.g. GH Pages).
    const res = await fetch(`${import.meta.env.BASE_URL}img/tt_orbis.svg`);
    if (res.ok) slot.innerHTML = await res.text();
  } catch { /* attribution stays empty — non-blocking */ }
}

async function boot() {
  const theme = readTheme();
  document.documentElement.setAttribute('data-theme', theme);

  const provider = new MapProvider({ container: 'map-canvas', theme });
  injectAttribLogo();

  bindList({ onSelect: id => { closeMegaMenu(); selectCase(provider, id); } });
  bindTopbar({ onThemeChange: t => provider.setTheme(t).then(refreshDetailLiveTokens) });
  bindMapControls(provider);
  bindPanel({
    onDismiss: () => {
      state.selectedId = null;
      writeCaseSlug(null);
      renderCaseList();
      renderDetail();
      provider.clearScene();
    },
  });
  bindDebug(provider);
  bindDetail({
    provider,
    // A snippet input changed — re-run the active scene with the new params.
    onParamChange: uc => provider.setScene(getScene(uc.mapType), uc),
  });

  /* The snippet's center/zoom track the live camera — refresh tokens
     as the user pans or zooms. moveend fires once per gesture, so
     no debounce needed. */
  provider.mapLibreMap?.on('moveend', refreshDetailLiveTokens);

  // Entering the app: either a `?case=<mapType>` deep link or the picker.
  // Deferred behind the access gate — runs immediately if the gate is
  // already unlocked, otherwise fires when the user types the password.
  const enterApp = () => {
    const deepLinked = findCaseBySlug(readCaseSlug());
    if (deepLinked) selectCase(provider, deepLinked.id);
    else            openMegaMenu();
  };

  bindAccessGate(enterApp);
}

async function selectCase(provider, id) {
  if (id === state.selectedId) return;
  state.selectedId = id;
  renderCaseList();
  renderDetail();
  const uc = getSelected();
  if (uc) {
    writeCaseSlug(uc.mapType);
    await provider.setScene(getScene(uc.mapType), uc);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
