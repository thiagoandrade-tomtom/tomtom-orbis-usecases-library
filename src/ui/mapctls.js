/* Map control buttons (zoom in/out, recenter, compass) routed to the provider.
   Recenter re-frames the active use case rather than chasing the user's
   browser geolocation — these are scripted scenarios, not navigation. */

/* Three glyphs the compass can show. The button is normally a 2D ↔ 3D
   toggle (showing the *next* state so the user knows what the click
   does); when the user has rotated the map off north, the icon swaps
   to a compass needle so the click resets the bearing instead. */
const ICON = {
  /* "3D" text — current camera is flat, click tilts to perspective.
     y=17 centres the cap-height inside the 24-unit viewBox; font-size
     15 + the 22×22 SVG render = ~14px on screen, comparable to the
     other FAB glyphs. */
  to3D:
    '<text x="12" y="17" text-anchor="middle" font-family="var(--f-title, Gilroy, sans-serif)" font-weight="800" font-size="15" letter-spacing="0.4" fill="currentColor">3D</text>',

  /* "2D" text — current camera is tilted, click flattens to top-down. */
  to2D:
    '<text x="12" y="17" text-anchor="middle" font-family="var(--f-title, Gilroy, sans-serif)" font-weight="800" font-size="15" letter-spacing="0.4" fill="currentColor">2D</text>',

  /* "↑N" needle — only appears when bearing ≠ 0. The whole SVG rotates
     by `-bearing` so the triangle keeps pointing at where true north is
     on the screen. Clicking resets the bearing.
     Path order on the N draws bottom-left → top-left → bottom-right
     (diagonal) → top-right; drawing in any other order flips the
     diagonal and the glyph reads as a Cyrillic "И". */
  northUp:
    '<path fill="currentColor" d="M12 4 L9.7 7.2 L14.3 7.2 Z"/>'
  + '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" d="M9 18 L9 10 L15 18 L15 10"/>',
};

/* Reflect the current pitch/bearing on the compass button: icon, tooltip,
   and rotation. Called on every camera move so the FAB stays in sync. */
function syncCompass(provider) {
  const btn = document.getElementById('compass');
  if (!btn) return;
  const m = provider?.mapLibreMap;
  if (!m) return;

  const pitch   = m.getPitch();
  const bearing = m.getBearing();
  const svg     = btn.querySelector('svg');
  if (!svg) return;

  /* Bearing reset wins when relevant — if the user has rotated the
     map, the immediate next action they probably want is "get me back
     to north." The 2D/3D toggle only shows when bearing is already
     resolved. */
  if (Math.abs(bearing) > 1) {
    svg.innerHTML = ICON.northUp;
    svg.style.transform = `rotate(${-bearing}deg)`;
    btn.title = 'Reset to north';
    btn.setAttribute('aria-label', 'Rotate map to north up');
    btn.dataset.mode = 'rotated';
  } else if (pitch > 1) {
    svg.innerHTML = ICON.to2D;
    svg.style.transform = 'none';
    btn.title = 'Switch to 2D';
    btn.setAttribute('aria-label', 'Switch to 2D top-down view');
    btn.dataset.mode = 'tilted';
  } else {
    svg.innerHTML = ICON.to3D;
    svg.style.transform = 'none';
    btn.title = 'Switch to 3D';
    btn.setAttribute('aria-label', 'Switch to 3D tilted view');
    btn.dataset.mode = 'flat';
  }
}

export function bindMapControls(provider) {
  document.getElementById('zoom-in').addEventListener('click', () => provider.zoomIn());
  document.getElementById('zoom-out').addEventListener('click', () => provider.zoomOut());
  document.getElementById('locate-btn')?.addEventListener('click', () => provider.recenter());
  /* Compass cycles through tilted → flat → north-up on each click,
     responding to the current camera so the next click is always the
     obvious next move. Icon + tooltip update to reflect the current
     camera state (see syncCompass). */
  document.getElementById('compass')?.addEventListener('click', () => provider.cycleCompass());

  /* Keep the icon in sync with the camera. `pitchend`/`rotateend` fire
     once per gesture, `idle` covers programmatic easeTo transitions
     (including our own cycleCompass animations). */
  const ml = provider?.mapLibreMap;
  if (ml) {
    const tick = () => syncCompass(provider);
    ml.on('pitchend',  tick);
    ml.on('rotateend', tick);
    ml.on('idle',      tick);
    /* Initial paint — the map may already be at its DEFAULT_VIEW pitch
       by the time we wire this up, so push the right glyph immediately
       instead of waiting for the first interaction. */
    tick();
  }
}
