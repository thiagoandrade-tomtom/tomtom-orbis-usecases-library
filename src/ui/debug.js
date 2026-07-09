/* Hidden debug overlay — toggle with the backtick (`) key.

   Surfaces the live state a developer typically wants while iterating
   on a scene: current map zoom / bearing / pitch / centre, active
   style family, theme, and the running tally of TomTom API calls
   (with the last error). The last bit catches credit / 403 problems
   instantly — when overlays "disappear", a glance at the panel shows
   "api fail: 12" instead of you wondering whether your code broke. */

let panel;
let visible = false;
let provider;
let landmarkMode = 'flat';   // EXPERIMENT — 'flat' | 'textured', toggled with `L`
const stats = { ok: 0, fail: 0, lastError: null };

export function bindDebug(p) {
  provider = p;
  ensurePanel();
  ensureStyles();
  wrapFetch();
  hookMap();
  document.addEventListener('keydown', (e) => {
    if (e.target.matches?.('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === '`' || e.key === '~') {
      e.preventDefault();
      toggle();
    }
    /* EXPERIMENT: `L` flips the 3D landmarks between the plugin's flat
       monochrome shading and their real baked GLB textures, for eyeballing
       whether the richer look is worth pursuing. */
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      const on = provider?.toggleLandmarkTextures?.();
      landmarkMode = on ? 'textured' : 'flat';
      if (visible) render();
    }
  });
}

function ensurePanel() {
  if (panel) return;
  panel = document.createElement('div');
  panel.className = 'debug-panel';
  panel.setAttribute('aria-hidden', 'true');
  panel.hidden = true;
  document.body.appendChild(panel);
}

function ensureStyles() {
  if (document.getElementById('debug-panel-styles')) return;
  const s = document.createElement('style');
  s.id = 'debug-panel-styles';
  s.textContent = `
    .debug-panel {
      position: fixed;
      bottom: 16px; left: 16px; z-index: 100;
      background: rgba(8, 12, 20, 0.86);
      color: #cfe0ff;
      font-family: var(--f-code, 'Fira Code', ui-monospace, monospace);
      font-size: 11px; line-height: 1.45;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.08);
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      pointer-events: none;
      min-width: 200px;
      user-select: none;
      backdrop-filter: blur(6px);
    }
    .debug-panel .dbg-head {
      font-family: var(--f-title, sans-serif); font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase;
      font-size: 9px; color: #7fa0d6;
      margin-bottom: 6px;
      display: flex; justify-content: space-between;
    }
    .debug-panel .dbg-row {
      display: flex; justify-content: space-between; gap: 14px;
    }
    .debug-panel .dbg-row > span:first-child {
      color: #8fa2c4; text-transform: uppercase;
      font-size: 9px; letter-spacing: 0.05em;
    }
    .debug-panel .dbg-row > span:last-child {
      color: #f0f4ff; font-weight: 600;
    }
    .debug-panel .dbg-row--err > span:last-child {
      color: #f06450;
    }
    .debug-panel .dbg-row--ok > span:last-child {
      color: #5bc977;
    }
  `;
  document.head.appendChild(s);
}

function toggle() {
  visible = !visible;
  if (!panel) return;
  panel.hidden = !visible;
  panel.setAttribute('aria-hidden', String(!visible));
  if (visible) render();
}

function hookMap() {
  const ml = provider?.mapLibreMap;
  if (!ml) return;
  ['move', 'zoom', 'rotate', 'pitch', 'idle'].forEach(ev => ml.on(ev, render));
}

function wrapFetch() {
  if (window.__debugFetchWrapped) return;
  window.__debugFetchWrapped = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const isTomTom = url.includes('api.tomtom.com');
    try {
      const res = await orig(...args);
      if (isTomTom) {
        if (res.ok) {
          stats.ok++;
        } else {
          stats.fail++;
          const path = url.split('?')[0].split('/').slice(-3).join('/');
          stats.lastError = `${res.status} · ${path}`;
        }
        render();
      }
      return res;
    } catch (err) {
      if (isTomTom) {
        stats.fail++;
        stats.lastError = `network · ${err.message || 'failed'}`;
        render();
      }
      throw err;
    }
  };
}

function activeCaseLabel() {
  // Read the live selection straight off the DOM so the debug panel
  // doesn't have to import state.js (keeps it standalone).
  const active = document.querySelector('.case-row.is-active');
  const id = active?.dataset?.id;
  const title = active?.querySelector('.case-title')?.textContent?.trim();
  return id ? `#${id} · ${title || '—'}` : '—';
}

function render() {
  if (!visible || !panel) return;
  const ml = provider?.mapLibreMap;
  const c = ml?.getCenter?.();
  const z = ml?.getZoom?.();
  const b = ml?.getBearing?.();
  const p = ml?.getPitch?.();
  const family = document.documentElement.getAttribute('data-map-family') || '—';
  const theme  = document.documentElement.getAttribute('data-theme') || '—';

  panel.innerHTML = `
    <div class="dbg-head"><span>debug</span><span>~ toggle</span></div>
    <div class="dbg-row"><span>case</span><span>${activeCaseLabel()}</span></div>
    <div class="dbg-row"><span>zoom</span><span>${z != null ? z.toFixed(2) : '—'}</span></div>
    <div class="dbg-row"><span>center</span><span>${c ? `${c.lng.toFixed(4)}, ${c.lat.toFixed(4)}` : '—'}</span></div>
    <div class="dbg-row"><span>bearing</span><span>${b != null ? `${b.toFixed(0)}°` : '—'}</span></div>
    <div class="dbg-row"><span>pitch</span><span>${p != null ? `${p.toFixed(0)}°` : '—'}</span></div>
    <div class="dbg-row"><span>style</span><span>${family}</span></div>
    <div class="dbg-row"><span>theme</span><span>${theme}</span></div>
    <div class="dbg-row"><span>landmarks (L)</span><span>${landmarkMode}</span></div>
    <div class="dbg-row dbg-row--ok"><span>api ok</span><span>${stats.ok}</span></div>
    <div class="dbg-row ${stats.fail ? 'dbg-row--err' : ''}"><span>api fail</span><span>${stats.fail}</span></div>
    ${stats.lastError ? `<div class="dbg-row dbg-row--err"><span>last err</span><span>${stats.lastError}</span></div>` : ''}
  `;
}
