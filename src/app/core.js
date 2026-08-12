/* Layout-agnostic boot helpers, shared by every screen shell:
   Full map (main.js), Split (layouts/split.js), and any future embed.
   Nothing here knows about the surrounding chrome — it only owns the
   pieces every shell needs identically: the MapLibre worker wiring, the
   `?case=` / `?theme=` URL plumbing, the restricted-entry gate, and the
   themed attribution logo. Keeping it in one place means a fix (or a new
   URL flag) lands in every layout at once. */

import maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker?url';
import { USE_CASES } from '../data/use-cases.js';

/* MapLibre ships its worker as a UMD blob-string that's wired up only in
   the global-init path. When rolldown bundles maplibre-gl as ESM, the
   global init can be skipped, leaving `WORKER_URL: ""` and `new Worker("")`
   silently producing a no-op worker — geojson features never get processed,
   so custom layers (route polylines, etc) never render. Import maplibre's
   dedicated worker entry as a URL asset and feed it back via setWorkerUrl
   before any Map is constructed. Runs once, at first import of this module. */
maplibregl.setWorkerUrl(workerUrl);

/* ─────────────────────────────────────────────────────────────
   Deep link — `?case=<mapType>` opens that demo directly and stays
   in sync as the user navigates. Using `mapType` as the slug keeps
   URLs human-readable (e.g. `/?case=multistop`) without a separate
   `slug` field on each use case.
   ───────────────────────────────────────────────────────────── */
const CASE_PARAM = 'case';
export function readCaseSlug() {
  return new URLSearchParams(window.location.search).get(CASE_PARAM);
}
export function findCaseBySlug(slug) {
  return slug ? USE_CASES.find(u => u.mapType === slug) : null;
}
export function writeCaseSlug(slug) {
  const url = new URL(window.location.href);
  if (slug) url.searchParams.set(CASE_PARAM, slug);
  else      url.searchParams.delete(CASE_PARAM);
  history.replaceState(null, '', url);
}

/* ─────────────────────────────────────────────────────────────
   Restricted-entry gate — soft client-side lock. Compares the typed
   password to `VITE_ACCESS_PASSWORD` (set in `.env` locally and as a
   repo secret in CI). On success we flip `<html>` into the unlocked
   state and remember it for the rest of the tab via sessionStorage.

   NOTE: any client-side check is bypassable by inspecting the bundle.
   This is a casual deterrent for sharing links, not real security.

   Layouts that want no gate at all (e.g. an iframe embed) simply skip
   calling `bindAccessGate` and never render an `#access-gate` element.
   ───────────────────────────────────────────────────────────── */
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
   keydown handlers stay quiet while the gate is up. */
function setAppInert(locked) {
  for (const el of document.body.children) {
    if (el.id === 'access-gate') continue;
    el.inert = locked;
  }
}

export function bindAccessGate(onUnlock) {
  // No gate markup on this page (e.g. embed shell) → nothing to lock,
  // enter straight away.
  if (!document.getElementById('access-gate')) { onUnlock?.(); return; }

  // Already authenticated this tab — gate is already hidden by the inline
  // <head> script; just fire the post-unlock callback and bail.
  if (isUnlocked()) { onUnlock?.(); return; }

  // Lock the rest of the app behind the gate (clicks, shortcuts, focus).
  setAppInert(true);

  const form  = document.getElementById('access-form');     // the form *is* the .access-card
  const input = document.getElementById('access-password');
  const error = document.getElementById('access-error');
  if (!form) { onUnlock?.(); return; }

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

/* ─────────────────────────────────────────────────────────────
   Embed mode — the page is running inside someone else's scroll.
   When it is, the map must not own the wheel: the host (a Framer page
   listing other demos, say) needs the scroll to keep moving the page,
   and on touch a one-finger swipe has to scroll past the iframe instead
   of panning the map. MapLibre's `cooperativeGestures` does exactly
   that split — see MapProvider.

   Resolution order:
   1. `?embed=1` / `?embed=0` on the URL — explicit wins either way,
      so a host can force it on, or a full-bleed embed with no page
      scroll behind it can force it off.
   2. Auto: we're in a frame we didn't create. Covers the common case
      (someone pastes the URL into an <iframe>) with no extra config.
   3. Standalone page — the map owns the viewport, keep native gestures.
   ───────────────────────────────────────────────────────────── */
export function isEmbedded() {
  const flag = new URLSearchParams(window.location.search).get('embed');
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  try { return window.self !== window.top; } catch { return true; }  // cross-origin frame → throws
}

/* ─────────────────────────────────────────────────────────────
   Theme resolution order:
   1. `?theme=light|dark|auto` on the URL — wins, and overwrites the
      stored preference (so an embed host like Framer can pin the theme).
      `auto` clears the stored preference and falls through to the device.
   2. `localStorage.orbis-theme` — the user has clicked the toggle before.
   3. `prefers-color-scheme` — follow the device.
   4. `dark` — final fallback.
   ───────────────────────────────────────────────────────────── */
export function deviceTheme() {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
export function readTheme() {
  try {
    const url = new URLSearchParams(window.location.search).get('theme');
    if (url === 'light' || url === 'dark') {
      try { localStorage.setItem('orbis-theme', url); } catch {}
      return url;
    }
    if (url === 'auto') {
      try { localStorage.removeItem('orbis-theme'); } catch {}
      return deviceTheme();
    }
    const saved = localStorage.getItem('orbis-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return deviceTheme();
}

/* When the user hasn't expressed a preference (no stored value), keep
   tracking the device — flipping the OS between light/dark updates the
   app live. As soon as the toggle is clicked or `?theme=` pins a value,
   localStorage is set and this listener becomes a no-op. */
export function watchDeviceTheme(apply) {
  const mql = window.matchMedia?.('(prefers-color-scheme: light)');
  mql?.addEventListener?.('change', () => {
    try { if (localStorage.getItem('orbis-theme')) return; } catch {}
    apply(deviceTheme());
  });
}

/* ─────────────────────────────────────────────────────────────
   Attribution — inline the SVG so its `currentColor` glyphs and
   `var(--s0)` knockout strokes resolve against the active theme.
   No-op when the page has no `#attr-logo` slot.
   ───────────────────────────────────────────────────────────── */
export async function injectAttribLogo() {
  const slot = document.getElementById('attr-logo');
  if (!slot) return;
  try {
    // BASE_URL keeps this working under a sub-path deploy (e.g. GH Pages).
    const res = await fetch(`${import.meta.env.BASE_URL}img/tt_orbis.svg`);
    if (res.ok) slot.innerHTML = await res.text();
  } catch { /* attribution stays empty — non-blocking */ }
}
