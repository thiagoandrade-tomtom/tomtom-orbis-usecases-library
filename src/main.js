/* App entry. Boots the map provider, wires the UI, and opens the
   unified mega-menu on first load — that menu is both the intro and
   the use-case picker, so we only ever show one overlay. */

import './styles/index.css';
import './map/config.js';

/* Layout-agnostic boot (MapLibre worker wiring, `?case=`/`?theme=` URL
   plumbing, the access gate, themed attribution) lives in app/core so
   every screen shell — Full map here, Split, future embed — shares it. */
import {
  readTheme, watchDeviceTheme, injectAttribLogo, bindAccessGate,
  readCaseSlug, findCaseBySlug, writeCaseSlug,
} from './app/core.js';

import { MapProvider } from './map/provider.js';
import { getScene } from './scenes/index.js';
import { state, getSelected, setBasemapOverride } from './state.js';
import { bindList, renderCaseList } from './ui/list.js';
import { bindDetail, renderDetail, refreshDetailLiveTokens } from './ui/detail.js';
import { bindTopbar, closeMegaMenu, openMegaMenu } from './ui/topbar.js';
import { bindMapControls } from './ui/mapctls.js';
import { bindPanel } from './ui/panel.js';
import { bindDebug } from './ui/debug.js';

async function boot() {
  const theme = readTheme();
  document.documentElement.setAttribute('data-theme', theme);

  const provider = new MapProvider({ container: 'map-canvas', theme });
  injectAttribLogo();

  bindList({ onSelect: id => { closeMegaMenu(); selectCase(provider, id); } });
  /* Satellite imagery is theme-agnostic — surface that on the theme
     button so users don't expect the map itself to change when they
     flip while on satellite. UI chrome still themes. */
  const syncThemeButtonHint = () => {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    if (provider.activeFamily === 'satellite') {
      btn.title = "Imagery doesn't theme — only the UI will switch.";
    } else {
      btn.removeAttribute('title');
    }
  };
  bindTopbar({ onThemeChange: t => provider.setTheme(t).then(refreshDetailLiveTokens) });
  watchDeviceTheme(t => {
    document.documentElement.setAttribute('data-theme', t);
    provider.setTheme(t).then(refreshDetailLiveTokens);
  });
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
    // User picked a different basemap family — record the per-case
    // override so we restore it next time they revisit this case, then
    // swap the style under the live scene (camera + overlays preserved).
    onBasemapChange: (uc, family) => {
      setBasemapOverride(uc, family);
      provider.setStyleFamily(family).then(() => {
        refreshDetailLiveTokens();
        syncThemeButtonHint();
      });
    },
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
    /* Refresh the theme-button title for the freshly-loaded case —
       satellite gets a "UI-only" hint, every other family clears it. */
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
      if (provider.activeFamily === 'satellite') themeBtn.title = "Imagery doesn't theme — only the UI will switch.";
      else                                       themeBtn.removeAttribute('title');
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
