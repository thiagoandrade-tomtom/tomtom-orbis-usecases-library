/* Map control buttons (zoom in/out, recenter, compass) routed to the provider.
   Recenter re-frames the active use case; but on the default globe view
   (no case selected) it flies to the user's own location instead. */
import { state } from '../state.js';
import { ICO_3D, ICO_2D, ICO_NORTH } from './icons.js';

/* Globe view, no case selected → fly to the user's geolocation with a
   gentle camera trip, close enough to read the 3D buildings + landmarks.
   No continuous orbit on arrival — a persistent rotation can trigger
   motion sickness, and the fly-in is movement enough. */
function locateUser(provider) {
  const map = provider?.mapLibreMap;
  if (!map || !navigator.geolocation) return;
  const btn = document.getElementById('locate-btn');
  btn?.classList.add('is-locating');
  navigator.geolocation.getCurrentPosition(
    pos => {
      btn?.classList.remove('is-locating');
      map.flyTo({
        center: [pos.coords.longitude, pos.coords.latitude],
        zoom: 16,            // close enough for 3D buildings + landmarks
        pitch: 55,           // tilt so the 3D reads
        bearing: 0,
        duration: 3400,      // slow, gentle "trip" rather than a snap
        curve: 1.5,          // the fly-over arc
        essential: true,     // honour the gesture even under reduce-motion
      });
    },
    err => {
      btn?.classList.remove('is-locating');
      // Permission denied or unavailable — nothing to recenter on, so just
      // leave the globe where it is.
      console.warn('[locate] geolocation unavailable', err?.message || err);
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  );
}

/* The compass is normally a 2D ↔ 3D toggle (showing the *next* state
   so the user knows what the click does); when the user has rotated the
   map off north, the icon swaps to a needle so the click resets the
   bearing instead. Glyphs live in icons.js. */
const ICON = { to3D: ICO_3D, to2D: ICO_2D, northUp: ICO_NORTH };

/* Reflect the current pitch/bearing on the compass button: icon, tooltip,
   and rotation. Called on every camera move so the FAB stays in sync. */
function syncCompass(provider) {
  const btn = document.getElementById('compass');
  if (!btn) return;
  const m = provider?.mapLibreMap;
  if (!m) return;

  // Mid-animation, show what the next click will do from where the camera
  // is heading, the same view cycleCompass decides from.
  const { pitch, bearing } = provider.compassView?.() ?? { pitch: m.getPitch(), bearing: m.getBearing() };
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
  document.getElementById('locate-btn')?.addEventListener('click', () => {
    // No case loaded → the button means "take me to me"; otherwise it
    // re-frames the active scene.
    if (state.selectedId == null) locateUser(provider);
    else                         provider.recenter();
  });
  /* Compass cycles through tilted → flat → north-up on each click,
     responding to the current camera so the next click is always the
     obvious next move. Icon + tooltip update to reflect the current
     camera state (see syncCompass). */
  document.getElementById('compass')?.addEventListener('click', () => {
    provider.cycleCompass();
    syncCompass(provider);   // the icon answers the click at once
  });

  /* Keep the icon in sync with the camera. `pitchend`/`rotateend` fire
     once per gesture, `moveend` covers programmatic easeTo transitions
     (including our own cycleCompass animations). Not `idle`: a map with
     GLSurfaces on redraws every frame and never goes idle. */
  const ml = provider?.mapLibreMap;
  if (ml) {
    const tick = () => syncCompass(provider);
    ml.on('pitchend',  tick);
    ml.on('rotateend', tick);
    ml.on('moveend',   tick);
    /* Initial paint — the map may already be at its DEFAULT_VIEW pitch
       by the time we wire this up, so push the right glyph immediately
       instead of waiting for the first interaction. */
    tick();
  }
}
