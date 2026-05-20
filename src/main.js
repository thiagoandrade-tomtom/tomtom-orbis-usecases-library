/* App entry. Boots the map provider, wires the UI, and opens the
   unified mega-menu on first load — that menu is both the intro and
   the use-case picker, so we only ever show one overlay. */

import './styles/index.css';
import './map/config.js';
import { MapProvider } from './map/provider.js';
import { getScene } from './scenes/index.js';
import { state, getSelected } from './state.js';
import { bindList, renderCaseList } from './ui/list.js';
import { bindDetail, renderDetail, refreshDetailLiveTokens } from './ui/detail.js';
import { bindTopbar, closeMegaMenu, openMegaMenu } from './ui/topbar.js';
import { bindMapControls } from './ui/mapctls.js';
import { bindPanel } from './ui/panel.js';
import { bindDebug } from './ui/debug.js';

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
    const res = await fetch('/img/tt_orbis.svg');
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

  // Open the unified picker on first load — no separate intro modal.
  openMegaMenu();
}

async function selectCase(provider, id) {
  if (id === state.selectedId) return;
  state.selectedId = id;
  renderCaseList();
  renderDetail();
  const uc = getSelected();
  if (uc) await provider.setScene(getScene(uc.mapType), uc);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
